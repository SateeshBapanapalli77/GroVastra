import { Router, Request, Response } from 'express';
import { CampaignDeliveryIntentModel } from '../models/CampaignDeliveryIntent.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { eventBus } from '../../../shared/events/eventBus';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

export const webhookRouter = Router();

/**
 * POST /api/v1/webhooks/whatsapp
 * Simulates or consumes WhatsApp Cloud API webhook notifications
 */
webhookRouter.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
  try {
    const { entry } = req.body;
    logger.info({ body: req.body }, 'Received WhatsApp webhook');

    // Status receipt simulation or Meta payload processing
    const { providerMessageId, status, customerPhone, messageText } = req.body;

    if (providerMessageId && status) {
      const intent = await CampaignDeliveryIntentModel.findOne({ providerMessageId });
      if (intent) {
        if (status === 'delivered') {
          intent.deliveredAt = new Date();
          await intent.save();
        } else if (status === 'read') {
          intent.readAt = new Date();
          if (!intent.deliveredAt) intent.deliveredAt = new Date();
          await intent.save();
        }
        logger.info({ providerMessageId, status }, 'Updated delivery intent status');
      }
    }

    // Inbound customer reply handling -> triggers stopOnReply hold!
    if (customerPhone && messageText) {
      const customer = await CustomerModel.findOne({ phone: customerPhone });
      if (customer) {
        // Flag reply hold on all active enrollments for this customer
        const updated = await CampaignEnrollmentModel.updateMany(
          { customerId: customer.id, status: 'ACTIVE' },
          { $set: { replyHoldAt: new Date() } }
        );

        logger.info(
          { customerId: customer.id, modifiedCount: updated.modifiedCount },
          'Customer replied; activated staff handling hold on enrollments'
        );

        // Publish domain event
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

    res.json({ success: true, received: true });
  } catch (err: any) {
    logger.error({ err }, 'Error handling WhatsApp webhook');
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

    // Flag goalReachedAt on active enrollments for this customer
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

    // Publish domain event
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
