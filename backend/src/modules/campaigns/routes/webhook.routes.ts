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

  if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook challenge verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn({ token, expected: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN }, 'WhatsApp webhook challenge verification failed');
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
 * POST /api/v1/webhooks/whatsapp
 * Ingests Meta WhatsApp Cloud API delivery receipts, read statuses, and customer replies
 */
webhookRouter.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
  try {
    // 1. Verify HMAC Signature
    if (env.WHATSAPP_APP_SECRET) {
      const signatureHeader = req.headers['x-hub-signature-256'] as string;
      const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
      const isValid = verifyMetaSignature(signatureHeader, rawBody, env.WHATSAPP_APP_SECRET);
      if (!isValid) {
        logger.warn('WhatsApp webhook signature verification failed (forged payload)');
        return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
      }
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

              const intent = await CampaignDeliveryIntentModel.findOne({ providerMessageId });
              if (intent) {
                if (status === 'delivered') {
                  intent.deliveredAt = new Date();
                  await intent.save();

                  await CampaignExecutionModel.updateOne(
                    { id: intent.executionId },
                    { $set: { state: 'DELIVERED', deliveredAt: new Date() } }
                  );
                } else if (status === 'read') {
                  intent.readAt = new Date();
                  if (!intent.deliveredAt) intent.deliveredAt = new Date();
                  await intent.save();

                  await CampaignExecutionModel.updateOne(
                    { id: intent.executionId },
                    { $set: { state: 'READ', readAt: new Date() } }
                  );
                } else if (status === 'failed') {
                  intent.state = 'REJECTED';
                  intent.errorCode = statusObj.errors?.[0]?.code?.toString() || 'PROVIDER_DELIVERY_FAILED';
                  await intent.save();

                  await CampaignExecutionModel.updateOne(
                    { id: intent.executionId },
                    { $set: { state: 'FAILED', outcomeReason: intent.errorCode } }
                  );
                }

                logger.info({ providerMessageId, status }, 'Updated execution & intent states from Meta status receipt');
              }
            }
          }

          // Process Inbound Customer Replies -> Triggers stopOnReply weaver hold!
          if (Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              const rawFrom = msg.from; // e.g. '919876543210'
              const textBody = msg.text?.body || msg.button?.text || '';
              const normalizedPhone = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`;

              // Find customer by phone or stripped phone
              const customer = await CustomerModel.findOne({
                $or: [{ phone: normalizedPhone }, { phone: rawFrom }, { phone: rawFrom.replace(/^91/, '') }]
              });

              if (customer) {
                await CampaignEnrollmentModel.updateMany(
                  { customerId: customer.id, status: 'ACTIVE' },
                  { $set: { replyHoldAt: new Date() } }
                );

                logger.info(
                  { customerId: customer.id, phone: normalizedPhone },
                  'Inbound WhatsApp message received: activated human weaver hold on enrollments'
                );

                await eventBus.publish({
                  schemaVersion: 1,
                  producer: 'whatsapp',
                  eventId: generateId('evt'),
                  tenantId: customer.tenantId,
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
            { id: intent.executionId },
            { $set: { state: 'DELIVERED', deliveredAt: new Date() } }
          );
        } else if (status === 'read') {
          intent.readAt = new Date();
          if (!intent.deliveredAt) intent.deliveredAt = new Date();
          await intent.save();

          await CampaignExecutionModel.updateOne(
            { id: intent.executionId },
            { $set: { state: 'READ', readAt: new Date() } }
          );
        }
        logger.info({ providerMessageId, status }, 'Updated flat delivery intent & execution status');
      }
    }

    if (customerPhone && messageText) {
      const customer = await CustomerModel.findOne({
        $or: [{ phone: customerPhone }, { phone: customerPhone.replace(/^\+/, '') }]
      });

      if (customer) {
        await CampaignEnrollmentModel.updateMany(
          { customerId: customer.id, status: 'ACTIVE' },
          { $set: { replyHoldAt: new Date() } }
        );

        logger.info(
          { customerId: customer.id },
          'Customer replied via flat test payload; set replyHoldAt on active enrollments'
        );

        await eventBus.publish({
          schemaVersion: 1,
          producer: 'whatsapp',
          eventId: generateId('evt'),
          tenantId: customer.tenantId,
          type: 'customer.replied',
          entityId: customer.id,
          entityVersion: 1,
          occurredAt: new Date(),
          receivedAt: new Date(),
          customerId: customer.id,
          data: { phone: customerPhone, text: messageText }
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
 * Internal ingestion endpoint writing to campaignEventInbox and publishing to eventBus
 */
webhookRouter.post('/internal/campaign-events', async (req: Request, res: Response) => {
  try {
    const { eventId, type, producer, tenantId, entityId, data } = req.body;

    if (!type || !tenantId) {
      return res.status(400).json({ success: false, error: 'type and tenantId are required' });
    }

    const id = eventId || generateId('evt');

    // Deduplication via unique inbox insertion
    const existing = await CampaignEventInboxModel.findOne({ id });
    if (existing) {
      return res.status(200).json({ success: true, message: 'Event already ingested', eventId: id });
    }

    const inboxEvent = await CampaignEventInboxModel.create({
      id,
      tenantId,
      eventType: type,
      source: producer || 'internal',
      payload: data || {},
      status: 'PENDING',
      attempts: 0,
      receivedAt: new Date()
    });

    // Publish to in-process bus for immediate consumer dispatch
    await eventBus.publish({
      schemaVersion: 1,
      producer: producer || 'internal',
      eventId: id,
      tenantId,
      type,
      entityId: entityId || id,
      entityVersion: 1,
      occurredAt: new Date(),
      receivedAt: new Date(),
      data: data || {}
    });

    inboxEvent.status = 'PROCESSED';
    inboxEvent.processedAt = new Date();
    await inboxEvent.save();

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
