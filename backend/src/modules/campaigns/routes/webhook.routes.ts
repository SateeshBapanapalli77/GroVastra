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
import { reconcileDeliveryStatus } from '../services/deliveryStatusReconciliation';
import * as deliveryRecon from '../services/deliveryStatusReconciliation';
import crypto from 'crypto';
import { validateEventPayload } from '../../../shared/events/registry';
import { formatErrorResponse } from '../../../shared/utils/errors';

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
      return res.status(500).json(
        formatErrorResponse('Webhook secret is not configured', 'WEBHOOK_SECRET_NOT_CONFIGURED')
      );
    }

    const signatureHeader = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = verifyMetaSignature(signatureHeader, rawBody, secret);
    if (!isValid) {
      logger.warn('WhatsApp webhook signature verification failed (forged or unsigned payload)');
      return res.status(401).json(
        formatErrorResponse('Invalid or missing webhook signature', 'INVALID_SIGNATURE')
      );
    }

    const body = req.body;
    const entryCount = Array.isArray(body?.entry) ? body.entry.length : 0;
    let statusCount = 0;
    let logProviderMessageId: string | undefined = body?.providerMessageId;

    if (Array.isArray(body?.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          if (Array.isArray(change.value?.statuses)) {
            statusCount += change.value.statuses.length;
            if (!logProviderMessageId && change.value.statuses[0]?.id) {
              logProviderMessageId = change.value.statuses[0].id;
            }
          }
        }
      }
    } else if (body?.status) {
      statusCount = 1;
    }

    logger.info(
      {
        entryCount,
        statusCount,
        ...(logProviderMessageId ? { providerMessageId: logProviderMessageId } : {})
      },
      'Processing WhatsApp webhook notification'
    );

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

              const phoneNumberId = value.metadata?.phone_number_id;
              const tenantId = await resolveTenantForConnection(phoneNumberId);
              if (!tenantId) {
                logger.warn({ providerMessageId, phoneNumberId }, 'Status event dropped: unable to resolve tenant from connection phone_number_id (fail-closed)');
                continue;
              }

              // Strictly tenant-scoped delivery intent lookup (no unscoped queries)
              const intent = await CampaignDeliveryIntentModel.findOne({
                providerMessageId,
                tenantId
              });

              // Per-event deduplication and durable inbox lifecycle via CampaignEventInboxModel
              const statusEventKey = `${providerMessageId}_${status}_${statusObj.timestamp || ''}`;
              let inboxDoc: any;
              let isAlreadyProcessed = false;

              try {
                inboxDoc = await CampaignEventInboxModel.create({
                  id: generateId('evt'),
                  tenantId,
                  producer: 'whatsapp_status_webhook',
                  eventId: statusEventKey,
                  type: `whatsapp.status.${status}`,
                  entityId: intent ? intent.executionId : providerMessageId,
                  entityVersion: 1,
                  occurredAt: providerTimestamp,
                  receivedAt: new Date(),
                  data: {
                    providerMessageId,
                    status,
                    timestamp: statusObj.timestamp,
                    errorCode: statusObj.errors?.[0]?.code?.toString(),
                    errorReason: statusObj.errors?.[0]?.title || statusObj.errors?.[0]?.message
                  },
                  status: 'RECEIVED',
                  nextAttemptAt: intent ? null : new Date(Date.now() + 5000),
                  processedAt: null,
                  errorMessage: intent ? null : 'Awaiting delivery intent association'
                });
              } catch (err: any) {
                if (err.code === 11000) {
                  inboxDoc = await CampaignEventInboxModel.findOne({
                    tenantId,
                    producer: 'whatsapp_status_webhook',
                    eventId: statusEventKey
                  });

                  if (inboxDoc && inboxDoc.status === 'PROCESSED') {
                    logger.info({ statusEventKey, inboxId: inboxDoc.id }, 'Duplicate WhatsApp status webhook receipt already PROCESSED; skipping');
                    isAlreadyProcessed = true;
                    continue;
                  }

                  if (inboxDoc) {
                    logger.info(
                      { statusEventKey, inboxId: inboxDoc.id, currentStatus: inboxDoc.status },
                      'Resuming reconciliation for previously unprocessed/failed WhatsApp status webhook event'
                    );
                    await CampaignEventInboxModel.updateOne(
                      { id: inboxDoc.id },
                      { $set: { status: 'PROCESSING', updatedAt: new Date() } }
                    );
                  } else {
                    continue;
                  }
                } else {
                  throw err;
                }
              }

              if (isAlreadyProcessed) {
                continue;
              }

              if (intent) {
                try {
                  const reconResult = await deliveryRecon.reconcileDeliveryStatus({
                    tenantId: intent.tenantId,
                    providerMessageId,
                    status: status as 'delivered' | 'read' | 'failed',
                    providerTimestamp,
                    errorCode: statusObj.errors?.[0]?.code?.toString() || 'PROVIDER_DELIVERY_FAILED',
                    errorReason: statusObj.errors?.[0]?.title || statusObj.errors?.[0]?.message || 'PROVIDER_DELIVERY_FAILED',
                    inboxEventId: inboxDoc.id
                  });

                  if (!reconResult.reconciled) {
                    await CampaignEventInboxModel.updateOne(
                      { id: inboxDoc.id },
                      {
                        $set: {
                          status: 'FAILED',
                          errorMessage: reconResult.details,
                          updatedAt: new Date()
                        },
                        $inc: { retryCount: 1 }
                      }
                    );
                  }

                  logger.info(
                    {
                      providerMessageId,
                      status,
                      tenantId: intent.tenantId,
                      inboxId: inboxDoc.id,
                      policyResult: reconResult.policyResult,
                      details: reconResult.details
                    },
                    'Reconciled delivery status via unified policy and marked inbox event PROCESSED'
                  );
                } catch (reconErr: any) {
                  await CampaignEventInboxModel.updateOne(
                    { id: inboxDoc.id },
                    {
                      $set: {
                        status: 'FAILED',
                        errorMessage: reconErr?.message || 'Reconciliation failed',
                        nextAttemptAt: null,
                        updatedAt: new Date()
                      },
                      $inc: { retryCount: 1 }
                    }
                  );
                  logger.error(
                    { err: reconErr, providerMessageId, status, inboxId: inboxDoc.id },
                    'Delivery status reconciliation failed; inbox event recorded as FAILED for retry'
                  );
                  throw reconErr;
                }
              } else {
                if (inboxDoc.status === 'PROCESSING') {
                  await CampaignEventInboxModel.updateOne(
                    { id: inboxDoc.id },
                    {
                      $set: {
                        status: 'RECEIVED',
                        nextAttemptAt: new Date(Date.now() + 5000),
                        updatedAt: new Date()
                      }
                    }
                  );
                } else if (!inboxDoc.nextAttemptAt) {
                  await CampaignEventInboxModel.updateOne(
                    { id: inboxDoc.id },
                    { $set: { nextAttemptAt: new Date(Date.now() + 5000) } }
                  );
                }
                logger.info({ providerMessageId, status, tenantId, inboxId: inboxDoc.id }, 'Durably retained status receipt before send response persistence (C12)');
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

    if (providerMessageId && status && ['delivered', 'read', 'failed'].includes(status)) {
      const connectionTenantId = body.connectionId ? await resolveTenantForConnection(body.connectionId) : null;
      const resolvedTenantId = (req as any).tenantId || connectionTenantId;
      if (!resolvedTenantId) {
        logger.warn({ providerMessageId }, 'Flat status webhook rejected: missing or unresolvable tenant context (fail-closed)');
        return res.status(401).json(
          formatErrorResponse('Unauthorized: missing or unmapped connection tenant context', 'UNAUTHORIZED_CONNECTION')
        );
      }

      // Strictly tenant-scoped delivery intent lookup (no cross-tenant intent matching)
      const intent = await CampaignDeliveryIntentModel.findOne({
        providerMessageId,
        tenantId: resolvedTenantId
      });

      if (!intent) {
        logger.warn({ providerMessageId, tenantId: resolvedTenantId }, 'Flat status webhook dropped: no delivery intent matching providerMessageId for connection tenant (fail-closed)');
        return res.status(404).json(
          formatErrorResponse('No delivery intent found for providerMessageId and connection tenant', 'DELIVERY_INTENT_NOT_FOUND')
        );
      }

      // Route through durable inbox lifecycle & unified transactional reconciliation
      const statusEventKey = `flat_${providerMessageId}_${status}_${Date.now()}`;
      const inboxDoc = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: resolvedTenantId,
        producer: 'whatsapp_status_webhook',
        eventId: statusEventKey,
        type: `whatsapp.status.${status}`,
        entityId: intent.executionId,
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          providerMessageId,
          status,
          errorCode: body.errorCode,
          errorReason: body.errorReason
        },
        status: 'RECEIVED',
        nextAttemptAt: null,
        processedAt: null,
        errorMessage: null
      });

      try {
        const reconResult = await deliveryRecon.reconcileDeliveryStatus({
          tenantId: resolvedTenantId,
          providerMessageId,
          status: status as 'delivered' | 'read' | 'failed',
          providerTimestamp: new Date(),
          errorCode: body.errorCode || 'PROVIDER_DELIVERY_FAILED',
          errorReason: body.errorReason || 'PROVIDER_DELIVERY_FAILED',
          inboxEventId: inboxDoc.id
        });

        if (!reconResult.reconciled) {
          await CampaignEventInboxModel.updateOne(
            { id: inboxDoc.id },
            {
              $set: {
                status: 'FAILED',
                errorMessage: reconResult.details,
                updatedAt: new Date()
              },
              $inc: { retryCount: 1 }
            }
          );
        }

        logger.info({ providerMessageId, status, tenantId: resolvedTenantId, inboxId: inboxDoc.id }, 'Reconciled flat delivery intent & execution status via unified policy');
      } catch (reconErr: any) {
        await CampaignEventInboxModel.updateOne(
          { id: inboxDoc.id },
          {
            $set: {
              status: 'FAILED',
              errorMessage: reconErr?.message || 'Reconciliation failed',
              nextAttemptAt: null,
              updatedAt: new Date()
            },
            $inc: { retryCount: 1 }
          }
        );
        throw reconErr;
      }
    }

    if (customerPhone && messageText) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeE164(customerPhone);
      } catch {
        return res.status(400).json(
          formatErrorResponse('Invalid customer phone number', 'INVALID_PHONE_NUMBER', 'customerPhone')
        );
      }

      const connectionId = body.connectionId;
      const tenantId = (req as any).tenantId || (connectionId ? await resolveTenantForConnection(connectionId) : null);
      if (!tenantId) {
        logger.warn('Flat customer reply rejected: missing or unmapped tenant context');
        return res.status(400).json(
          formatErrorResponse('Tenant context could not be resolved from connection', 'TENANT_RESOLUTION_FAILED', 'connectionId')
        );
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
    return res.status(500).json(
      formatErrorResponse(err.message || 'Internal server error', 'INTERNAL_ERROR')
    );
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

    // 1. Schema Validation via Event Registry (Spec p.24: "incompatible schema produces a visible quarantine state")
    const validation = validateEventPayload(req.body);
    if (!validation.success) {
      logger.warn({ id, tenantId, type, error: validation.error }, 'Event failed registry validation; sent to QUARANTINE');
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
        errorMessage: validation.error
      });
      return res.status(422).json(
        formatErrorResponse(validation.error, 'SCHEMA_VALIDATION_FAILED', undefined, 'QUARANTINE')
      );
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
      return res.status(409).json(
        formatErrorResponse(
          `Stale entity version ${parsedEntityVersion} superseded by ${latestEvent.entityVersion}`,
          'STALE_ENTITY_VERSION',
          undefined,
          'QUARANTINE'
        )
      );
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
    res.status(500).json(
      formatErrorResponse(err.message || 'Internal server error', 'INTERNAL_ERROR')
    );
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
      const fieldPath = !orderId ? 'orderId' : 'customerId';
      return res.status(400).json(
        formatErrorResponse('orderId and customerId are required', 'MISSING_REQUIRED_FIELDS', fieldPath)
      );
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
    res.status(500).json(
      formatErrorResponse(err.message || 'Internal server error', 'INTERNAL_ERROR')
    );
  }
});

