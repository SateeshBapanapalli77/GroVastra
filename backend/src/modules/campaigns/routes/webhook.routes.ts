import { Router, Request, Response } from 'express';
import { CampaignDeliveryIntentModel } from '../models/CampaignDeliveryIntent.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { eventBus } from '../../../shared/events/eventBus';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import { normalizeE164 } from '../../../shared/utils/phone';
import { resolveTenantForConnection } from '../services/connectionRegistry';
import { requireInternalAuth } from '../../../shared/middleware/internalAuth.middleware';
import { evaluateOrderCompletedGoal } from '../engine/orderGoalEvaluator';
import crypto from 'crypto';

export const webhookRouter = Router();

/**
 * GET /api/v1/webhooks/whatsapp
 * Meta WhatsApp Cloud API Webhook Verification Challenge (Page 26)
 */
webhookRouter.get('/webhooks/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const given = Buffer.from(String(token ?? ''));
  const expected = Buffer.from(expectedToken);
  const tokenOk = given.length === expected.length && crypto.timingSafeEqual(given, expected);

  if (mode === 'subscribe' && tokenOk) {
    logger.info('WhatsApp webhook challenge verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('WhatsApp webhook challenge verification failed');
  return res.sendStatus(403);
});

/**
 * Verifies HMAC SHA-256 signature from Meta
 */
export function verifyMetaSignature(
  signatureHeader: string | undefined,
  rawBody: Buffer | string,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison preventing timing side-channel attacks
 */
export function timingSafeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * POST /api/v1/webhooks/whatsapp
 * Ingests Meta WhatsApp Cloud API delivery receipts, read statuses, and customer replies
 */
webhookRouter.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
  try {
    // 1. Verify HMAC Signature (Fail-closed: requires secret and valid signature)
    const secret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      logger.error('WhatsApp webhook secret is not configured; rejecting request (fail-closed)');
      return res.status(500).json({ success: false, error: 'Webhook secret is not configured' });
    }

    const signatureHeader = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = verifyMetaSignature(signatureHeader, rawBody, secret);
    if (!isValid) {
      logger.warn('WhatsApp webhook signature verification failed (forged or unsigned payload)');
      return res.status(401).json({ success: false, error: 'Invalid or missing webhook signature' });
    }

    const body = req.body;
    logger.info({ body }, 'Processing WhatsApp webhook notification');

    // 2. Parse Meta Standard Cloud API Payload Structure: entry[].changes[].value
    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          const value = change.value;
          if (!value) continue;

          // Process Status Updates (delivered, read, failed)
          if (Array.isArray(value.statuses)) {
            for (const statusObj of value.statuses) {
              const providerMessageId = statusObj.id;
              const status = statusObj.status; // 'delivered' | 'read' | 'failed'
              const providerTimestamp = statusObj.timestamp
                ? new Date(Number(statusObj.timestamp) * 1000)
                : new Date();

              const intent = await CampaignDeliveryIntentModel.findOne({ providerMessageId });
              const phoneNumberId = value.metadata?.phone_number_id;
              const tenantId = intent ? intent.tenantId : await resolveTenantForConnection(phoneNumberId);
              if (!tenantId) {
                logger.warn({ providerMessageId, phoneNumberId }, 'Status event dropped: unable to resolve tenant');
                continue;
              }

              // Per-event deduplication via CampaignEventInboxModel compound unique index
              const statusEventKey = `${providerMessageId}_${status}_${statusObj.timestamp || ''}`;
              try {
                await CampaignEventInboxModel.create({
                  id: generateId('evt'),
                  tenantId,
                  producer: 'whatsapp_status_webhook',
                  eventId: statusEventKey,
                  type: `whatsapp.status.${status}`,
                  entityId: intent ? intent.executionId : providerMessageId,
                  entityVersion: 1,
                  occurredAt: providerTimestamp,
                  receivedAt: new Date(),
                  data: { providerMessageId, status, timestamp: statusObj.timestamp },
                  status: intent ? 'PROCESSED' : 'RECEIVED',
                  processedAt: intent ? new Date() : undefined
                });
              } catch (err: any) {
                if (err.code === 11000) {
                  logger.info({ statusEventKey }, 'Duplicate WhatsApp status webhook receipt ignored');
                  continue;
                }
                throw err;
              }

              if (intent) {
                if (status === 'delivered') {
                  intent.deliveredAt = providerTimestamp;
                  await intent.save();

                  // State monotonic progression: delivered cannot overwrite read, failed, or skipped
                  await CampaignExecutionModel.updateOne(
                    {
                      id: intent.executionId,
                      tenantId: intent.tenantId,
                      state: { $in: ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED', 'OUTCOME_UNKNOWN'] }
                    },
                    {
                      $set: {
                        state: 'DELIVERED',
                        deliveredAt: providerTimestamp
                      }
                    }
                  );
                } else if (status === 'read') {
                  intent.readAt = providerTimestamp;
                  if (!intent.deliveredAt) intent.deliveredAt = providerTimestamp;
                  await intent.save();

                  // Read can transition from PROVIDER_ACCEPTED, DELIVERED, or OUTCOME_UNKNOWN
                  await CampaignExecutionModel.updateOne(
                    {
                      id: intent.executionId,
                      tenantId: intent.tenantId,
                      state: { $in: ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'OUTCOME_UNKNOWN'] }
                    },
                    {
                      $set: {
                        state: 'READ',
                        readAt: providerTimestamp,
                        deliveredAt: intent.deliveredAt
                      }
                    }
                  );
                } else if (status === 'failed') {
                  intent.state = 'REJECTED';
                  intent.errorCode = statusObj.errors?.[0]?.code?.toString() || 'PROVIDER_DELIVERY_FAILED';
                  await intent.save();

                  await CampaignExecutionModel.updateOne(
                    {
                      id: intent.executionId,
                      tenantId: intent.tenantId,
                      state: { $nin: ['READ', 'DELIVERED'] }
                    },
                    {
                      $set: {
                        state: 'FAILED',
                        outcomeReason: intent.errorCode
                      }
                    }
                  );
                }

                logger.info({ providerMessageId, status, tenantId: intent.tenantId }, 'Updated execution & intent states from Meta status receipt');
              } else {
                logger.info({ providerMessageId, status, tenantId }, 'Durably retained status receipt before send response persistence (C12)');
              }
            }
          }

          // Process Inbound Customer Replies -> Triggers stopOnReply weaver hold!
          if (Array.isArray(value.messages)) {
            const phoneNumberId = value.metadata?.phone_number_id;
            const tenantId = await resolveTenantForConnection(phoneNumberId);
            if (!tenantId) {
              logger.warn({ phoneNumberId }, 'Inbound WhatsApp reply rejected: no tenant mapped to connection');
              continue;
            }

            for (const msg of value.messages) {
              const rawFrom = msg.from; // e.g. '919876543210'
              const textBody = msg.text?.body || msg.button?.text || '';
              let normalizedPhone: string;
              try {
                normalizedPhone = normalizeE164(rawFrom);
              } catch {
                logger.warn('Invalid phone format received in WhatsApp message');
                continue;
              }

              // Strictly tenant-scoped customer lookup by E.164 phone
              const customer = await CustomerModel.findOne({
                tenantId,
                phone: normalizedPhone
              });

              if (customer) {
                await CampaignEnrollmentModel.updateMany(
                  { customerId: customer.id, tenantId, status: 'ACTIVE' },
                  { $set: { replyHoldAt: new Date() } }
                );

                logger.info(
                  { customerId: customer.id, tenantId },
                  'Inbound WhatsApp message received: activated human weaver hold on enrollments'
                );

                await eventBus.publish({
                  schemaVersion: 1,
                  producer: 'whatsapp',
                  eventId: generateId('evt'),
                  tenantId,
                  type: 'customer.replied',
                  entityId: customer.id,
                  entityVersion: 1,
                  occurredAt: new Date(),
                  receivedAt: new Date(),
                  customerId: customer.id,
                  data: { phone: normalizedPhone, text: textBody, wamid: msg.id }
                });
              }
            }
          }
        }
      }

      return res.status(200).json({ success: true, processed: true });
    }

    // 3. Flat Payload Support (Direct test scripts & backwards compatibility)
    const { providerMessageId, status, customerPhone, messageText } = body;

    if (providerMessageId && status) {
      const intent = await CampaignDeliveryIntentModel.findOne({ providerMessageId });
      if (intent) {
        if (status === 'delivered') {
          intent.deliveredAt = new Date();
          await intent.save();

          await CampaignExecutionModel.updateOne(
            { id: intent.executionId, tenantId: intent.tenantId },
            { $set: { state: 'DELIVERED', deliveredAt: new Date() } }
          );
        } else if (status === 'read') {
          intent.readAt = new Date();
          if (!intent.deliveredAt) intent.deliveredAt = new Date();
          await intent.save();

          await CampaignExecutionModel.updateOne(
            { id: intent.executionId, tenantId: intent.tenantId },
            { $set: { state: 'READ', readAt: new Date() } }
          );
        }
        logger.info({ providerMessageId, status }, 'Updated flat delivery intent & execution status');
      }
    }

    if (customerPhone && messageText) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeE164(customerPhone);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid customer phone number' });
      }

      const connectionId = body.connectionId;
      const tenantId = (req as any).tenantId || (connectionId ? await resolveTenantForConnection(connectionId) : null);
      if (!tenantId) {
        logger.warn('Flat customer reply rejected: missing or unmapped tenant context');
        return res.status(400).json({ success: false, error: 'Tenant context could not be resolved from connection' });
      }

      const customer = await CustomerModel.findOne({
        tenantId,
        phone: normalizedPhone
      });

      if (customer) {
        await CampaignEnrollmentModel.updateMany(
          { customerId: customer.id, tenantId, status: 'ACTIVE' },
          { $set: { replyHoldAt: new Date() } }
        );

        logger.info(
          { customerId: customer.id, tenantId },
          'Customer replied via flat test payload; set replyHoldAt on active enrollments'
        );

        await eventBus.publish({
          schemaVersion: 1,
          producer: 'whatsapp',
          eventId: generateId('evt'),
          tenantId,
          type: 'customer.replied',
          entityId: customer.id,
          entityVersion: 1,
          occurredAt: new Date(),
          receivedAt: new Date(),
          customerId: customer.id,
          data: { phone: normalizedPhone, text: messageText }
        });
      }
    }

    return res.status(200).json({ success: true, received: true });
  } catch (err: any) {
    logger.error({ err }, 'Error handling WhatsApp webhook');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/internal/campaign-events
 * Authenticated domain-event ingestion with per-producer, per-tenant credentials (spec p.24, p.26)
 * - Scope: scoped strictly by tenant and event family
 * - Tenant: taken from verified credential, never from header/body
 * - Quarantine: invalid schemas and stale entity versions rejected to QUARANTINE
 * - Durability: persisted before ACK, PROCESSED marked only after durable processing (B03)
 */
webhookRouter.post('/internal/campaign-events', requireInternalAuth('campaign-events'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { schemaVersion, eventId, type, producer, entityId, entityVersion, occurredAt, customerId, data } = req.body;

    const id = eventId || generateId('evt');
    const producerName = producer || 'internal';
    const parsedOccurredAt = occurredAt ? new Date(occurredAt) : new Date();
    const parsedEntityVersion = typeof entityVersion === 'number' ? entityVersion : 1;

    // 1. Schema Validation (Spec p.24: "incompatible schema produces a visible quarantine state")
    const isValidSchema =
      (schemaVersion === 1 || schemaVersion === undefined) &&
      typeof type === 'string' &&
      !isNaN(parsedOccurredAt.getTime()) &&
      typeof entityId === 'string';

    if (!isValidSchema) {
      logger.warn({ id, tenantId, type }, 'Incompatible event schema sent to QUARANTINE');
      await CampaignEventInboxModel.create({
        id,
        tenantId,
        producer: producerName,
        eventId: id,
        type: type || 'unknown.schema',
        entityId: entityId || id,
        entityVersion: parsedEntityVersion,
        occurredAt: isNaN(parsedOccurredAt.getTime()) ? new Date() : parsedOccurredAt,
        receivedAt: new Date(),
        customerId: customerId || undefined,
        data: data || {},
        status: 'QUARANTINE',
        errorMessage: 'INCOMPATIBLE_SCHEMA: Invalid or unrecognized event schema structure'
      });
      return res.status(422).json({
        success: false,
        status: 'QUARANTINE',
        error: 'Event sent to quarantine: incompatible or unknown event schema'
      });
    }

    // 2. Reject Stale Entity Versions (Spec p.24: "An older event cannot restore a state superseded by a newer entity version")
    const latestEvent = await CampaignEventInboxModel.findOne({
      tenantId,
      producer: producerName,
      entityId: entityId || id
    }).sort({ entityVersion: -1 });

    if (latestEvent && latestEvent.entityVersion > parsedEntityVersion) {
      logger.warn({ entityId, version: parsedEntityVersion, latest: latestEvent.entityVersion }, 'Stale entity version rejected to QUARANTINE');
      await CampaignEventInboxModel.create({
        id,
        tenantId,
        producer: producerName,
        eventId: id,
        type,
        entityId: entityId || id,
        entityVersion: parsedEntityVersion,
        occurredAt: parsedOccurredAt,
        receivedAt: new Date(),
        customerId: customerId || undefined,
        data: data || {},
        status: 'QUARANTINE',
        errorMessage: `STALE_ENTITY_VERSION: Incoming version ${parsedEntityVersion} is older than processed version ${latestEvent.entityVersion}`
      });
      return res.status(409).json({
        success: false,
        status: 'QUARANTINE',
        error: `Stale entity version ${parsedEntityVersion} superseded by ${latestEvent.entityVersion}`
      });
    }

    // 3. Durable & Atomic Ingestion (Persist as RECEIVED before ACK)
    let inboxEvent;
    try {
      inboxEvent = await CampaignEventInboxModel.create({
        id,
        tenantId,
        producer: producerName,
        eventId: id,
        type,
        entityId: entityId || id,
        entityVersion: parsedEntityVersion,
        occurredAt: parsedOccurredAt,
        receivedAt: new Date(),
        customerId: customerId || undefined,
        data: data || {},
        status: 'RECEIVED'
      });
    } catch (err: any) {
      if (err.code === 11000) {
        // Atomic duplicate catch: return existing state idempotently
        const existing = await CampaignEventInboxModel.findOne({ tenantId, producer: producerName, eventId: id });
        return res.status(200).json({
          success: true,
          message: 'Event already ingested (idempotent duplicate)',
          eventId: id,
          status: existing?.status || 'PROCESSED'
        });
      }
      throw err;
    }

    // Acknowledge receipt durably stored
    res.status(201).json({ success: true, eventId: id, status: 'RECEIVED' });

    // 4. Asynchronous durable processing (publish to eventBus, mark PROCESSED after completion)
    try {
      await eventBus.publish({
        schemaVersion: 1,
        producer: producerName,
        eventId: id,
        tenantId,
        type,
        entityId: entityId || id,
        entityVersion: parsedEntityVersion,
        occurredAt: parsedOccurredAt,
        receivedAt: new Date(),
        customerId: customerId || undefined,
        data: data || {}
      });

      if (inboxEvent) {
        inboxEvent.status = 'PROCESSED';
        inboxEvent.processedAt = new Date();
        await inboxEvent.save();
      }
    } catch (publishErr: any) {
      logger.error({ publishErr, eventId: id }, 'Event dispatch error; remains RECEIVED for worker rescan');
      // Intentionally keep as RECEIVED so worker rescans and processes it (Crash safety B03)
    }
  } catch (err: any) {
    logger.error({ err }, 'Error ingesting internal campaign event');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/webhooks/orders
 * Authenticated order webhook triggering stopOnGoal completion strictly per spec p.11, p.16 (A12, C17, C18)
 * - Authentication: Internal credential required; tenantId taken from credential
 * - Scope: All queries scoped strictly by tenantId
 * - No invented defaults: netPaise is never defaulted to a made-up price
 * - Occasion matching: only sets goal on enrollments whose occasion matches order's occasionRef
 * - Step stopOnGoal: does NOT skip steps that have stopOnGoal=false
 */
webhookRouter.post('/webhooks/orders', requireInternalAuth('orders'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!; // Strictly from verified internal credential
    const { orderId, customerId, occasionRef, netPaise } = req.body;

    if (!orderId || !customerId) {
      return res.status(400).json({ success: false, error: 'orderId and customerId are required' });
    }

    // 1. Evaluate goal attribution strictly per spec p.11, p.16
    const { matchedCount, updatedEnrollments } = await evaluateOrderCompletedGoal({
      tenantId,
      customerId,
      orderId,
      occasionRef,
      netPaise: typeof netPaise === 'number' ? netPaise : undefined
    });

    // 2. Publish order.completed event with deterministic eventId and actual netPaise (no fabricated default)
    await eventBus.publish({
      schemaVersion: 1,
      producer: 'orders',
      eventId: `evt_order_${orderId}`,
      tenantId,
      type: 'order.completed',
      entityId: orderId,
      entityVersion: 1,
      occurredAt: new Date(),
      receivedAt: new Date(),
      customerId,
      data: {
        orderId,
        occasionRef,
        ...(typeof netPaise === 'number' ? { netPaise } : {})
      }
    });

    res.json({
      success: true,
      updatedEnrollments: matchedCount,
      enrollmentIds: updatedEnrollments
    });
  } catch (err: any) {
    logger.error({ err }, 'Error processing orders webhook');
    res.status(500).json({ success: false, error: err.message });
  }
});

