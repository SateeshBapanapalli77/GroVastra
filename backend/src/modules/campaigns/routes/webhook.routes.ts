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
              if (intent) {
                // Per-event deduplication via CampaignEventInboxModel compound unique index
                const statusEventKey = `${providerMessageId}_${status}_${statusObj.timestamp || ''}`;
                try {
                  await CampaignEventInboxModel.create({
                    id: generateId('evt'),
                    tenantId: intent.tenantId,
                    producer: 'whatsapp_status_webhook',
                    eventId: statusEventKey,
                    type: `whatsapp.status.${status}`,
                    entityId: intent.executionId,
                    entityVersion: 1,
                    occurredAt: providerTimestamp,
                    receivedAt: new Date(),
                    data: { providerMessageId, status, timestamp: statusObj.timestamp },
                    status: 'PROCESSED',
                    processedAt: new Date()
                  });
                } catch (err: any) {
                  if (err.code === 11000) {
                    logger.info({ statusEventKey }, 'Duplicate WhatsApp status webhook receipt ignored');
                    continue;
                  }
                  throw err;
                }

                if (status === 'delivered') {
                  intent.deliveredAt = providerTimestamp;
                  await intent.save();

                  // State monotonic progression: delivered cannot overwrite read, failed, or skipped
                  await CampaignExecutionModel.updateOne(
                    {
                      id: intent.executionId,
                      tenantId: intent.tenantId,
                      state: { $in: ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED'] }
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

                  // Read can transition from PROVIDER_ACCEPTED or DELIVERED
                  await CampaignExecutionModel.updateOne(
                    {
                      id: intent.executionId,
                      tenantId: intent.tenantId,
                      state: { $in: ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED', 'DELIVERED'] }
                    },
                    {
                      $set: {
                        state: 'READ',
                        readAt: providerTimestamp
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
              }
            }
          }

          // Process Inbound Customer Replies -> Triggers stopOnReply weaver hold!
          if (Array.isArray(value.messages)) {
            const tenantId = (req as any).tenantId || env.DEFAULT_TENANT_ID;
            for (const msg of value.messages) {
              const rawFrom = msg.from; // e.g. '919876543210'
              const textBody = msg.text?.body || msg.button?.text || '';
              const normalizedPhone = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`;

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
                  { customerId: customer.id, tenantId, phone: normalizedPhone },
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
      const normalizedPhone = customerPhone.startsWith('+') ? customerPhone : `+${customerPhone}`;
      const tenantId = (req as any).tenantId || env.DEFAULT_TENANT_ID;
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
 * Authenticated internal ingestion endpoint writing durably to campaignEventInbox and publishing to eventBus
 */
webhookRouter.post('/internal/campaign-events', async (req: Request, res: Response) => {
  try {
    // 1. Authenticate Internal Service Key (fail closed & constant-time)
    const internalKey =
      (req.headers['x-internal-api-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '');

    const configuredKey = env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;

    if (!internalKey || !configuredKey || !timingSafeCompare(internalKey, configuredKey)) {
      logger.warn({ ip: req.ip, path: req.path }, 'Unauthorized attempt to access /internal/campaign-events');
      return res.status(401).json({ success: false, error: 'Unauthorized internal service call' });
    }

    // 2. Resolve Tenant Identity from Authenticated Context
    const tenantId = (req.headers['x-tenant-id'] as string) || req.body.tenantId;
    const { eventId, type, producer, entityId, entityVersion, occurredAt, customerId, data } = req.body;

    if (!type || !tenantId) {
      return res.status(400).json({ success: false, error: 'type and tenantId are required' });
    }

    const id = eventId || generateId('evt');
    const producerName = producer || 'internal';
    const parsedOccurredAt = occurredAt ? new Date(occurredAt) : new Date();
    const parsedEntityVersion = typeof entityVersion === 'number' ? entityVersion : 1;

    // 3. Durable & Atomic Ingestion via Compound Unique Index { tenantId, producer, eventId }
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
        // Atomic duplicate catch: check existing processing state
        const existing = await CampaignEventInboxModel.findOne({ tenantId, producer: producerName, eventId: id });
        if (existing && existing.status === 'PROCESSED') {
          return res.status(200).json({
            success: true,
            message: 'Event already ingested and processed (idempotent duplicate)',
            eventId: id,
            status: 'PROCESSED'
          });
        }
        // If existing is still RECEIVED or FAILED, continue to durable dispatch below
        inboxEvent = existing;
      } else {
        throw err;
      }
    }

    // 4. Durable Event Bus Dispatch (only marks PROCESSED after dispatch)
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

    res.status(201).json({ success: true, eventId: id, status: 'PROCESSED' });
  } catch (err: any) {
    logger.error({ err }, 'Error ingesting internal campaign event');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/webhooks/orders
 * Ingests completed order event -> triggers stopOnGoal completion!
 */
webhookRouter.post('/webhooks/orders', async (req: Request, res: Response) => {
  try {
    const { orderId, customerId, tenantId, netPaise } = req.body;

    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customerId is required' });
    }

    const updated = await CampaignEnrollmentModel.updateMany(
      { customerId, status: 'ACTIVE' },
      {
        $set: {
          goalReachedAt: new Date(),
          goalOrderRef: orderId || 'ord_direct'
        }
      }
    );

    logger.info(
      { customerId, orderId, modifiedCount: updated.modifiedCount },
      'Order completed; recorded goal reached on active enrollments'
    );

    await eventBus.publish({
      schemaVersion: 1,
      producer: 'orders',
      eventId: generateId('evt'),
      tenantId: tenantId || 'shop_padmavati_handlooms',
      type: 'order.completed',
      entityId: orderId || 'ord_001',
      entityVersion: 1,
      occurredAt: new Date(),
      receivedAt: new Date(),
      customerId,
      data: { netPaise: netPaise || 3850000, orderId }
    });

    res.json({ success: true, updatedEnrollments: updated.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
