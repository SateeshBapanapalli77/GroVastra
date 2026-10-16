import { z } from 'zod';
import { ICampaignEventInbox } from '../../modules/campaigns/models/CampaignEventInbox.model';
import { CampaignModel } from '../../modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../../modules/campaigns/models/CampaignVersion.model';
import { CampaignDeliveryIntentModel } from '../../modules/campaigns/models/CampaignDeliveryIntent.model';
import { evaluateInventoryArrivalEvent, evaluateFestivalEvent, evaluateCollectionReleaseEvent, evaluateSelectedStockOfferEvent } from '../../modules/campaigns/engine/merchandiseStrategy';
import { updateCustomerPurchaseFact, handleOrderRefundFact, evaluateCompleteTheOutfitEvent, evaluateFirstToSecondPurchaseEvent } from '../../modules/campaigns/engine/lifecycleStrategy';
import { evaluateOrderCompletedGoal } from '../../modules/campaigns/engine/orderGoalEvaluator';
import { evaluateVipMilestoneEvent, evaluateCreditExpiryEvent, evaluateExhibitionInviteEvent } from '../../modules/campaigns/engine/retentionStrategy';
import { evaluateAlterationReadyEvent, evaluateFittingAppointmentEvent, evaluateDeliveryUpdateEvent } from '../../modules/campaigns/engine/boutiqueServiceStrategy';
import { evaluateRestockEvent } from '../../modules/campaigns/engine/restockStrategy';
import { evaluateEnquiryEvent } from '../../modules/campaigns/engine/enquiryStrategy';
import { reconcileDeliveryStatus } from '../../modules/campaigns/services/deliveryStatusReconciliation';
import { logger } from '../../config/logger';

export interface EventTypeDefinition {
  type: string;
  family: 'merchandise' | 'lifecycle' | 'retention' | 'boutique_service' | 'status';
  description: string;
  dataSchema: z.ZodType<any>;
  evaluator: (event: ICampaignEventInbox) => Promise<any>;
}

/**
 * Resolves active campaign ID by trigger type or keyword search
 */
export async function findActiveCampaignForTrigger(
  tenantId: string,
  triggerType: string,
  keywords: string[] = []
): Promise<{ id: string; activeVersionId?: string | null } | null> {
  const campaigns = await CampaignModel.find({ tenantId, status: 'ACTIVE' }).lean();

  for (const c of campaigns) {
    if (!c.activeVersionId) continue;
    const v = await CampaignVersionModel.findOne({ id: c.activeVersionId, tenantId }).lean();
    if (!v) continue;

    const trig = v.trigger as any;
    const matchesTrigger =
      trig?.type === triggerType ||
      trig?.eventType === triggerType ||
      trig?.type === 'EVENT_DRIVEN' ||
      (trig?.eventType && trig.eventType.includes(triggerType.toLowerCase()));

    if (matchesTrigger) {
      if (keywords.length === 0) return { id: c.id, activeVersionId: c.activeVersionId };
      const combined = `${c.id} ${(c as any).presetId || ''} ${c.name || ''} ${v.name || ''}`.toLowerCase();
      if (keywords.some((k) => combined.includes(k.toLowerCase()))) {
        return { id: c.id, activeVersionId: c.activeVersionId };
      }
    }
  }

  // Fallback: check keywords directly against campaign presetId/name
  for (const c of campaigns) {
    const combined = `${c.id} ${(c as any).presetId || ''} ${c.name || ''}`.toLowerCase();
    if (keywords.some((k) => combined.includes(k.toLowerCase()))) {
      return { id: c.id, activeVersionId: c.activeVersionId };
    }
  }

  return campaigns[0] ? { id: campaigns[0].id, activeVersionId: campaigns[0].activeVersionId } : null;
}

export const EVENT_REGISTRY: Record<string, EventTypeDefinition> = {
  // 1. Merchandise Family
  'inventory.arrival': {
    type: 'inventory.arrival',
    family: 'merchandise',
    description: 'New inventory or restock shipment arrived at boutique',
    dataSchema: z.object({
      sku: z.string().min(1),
      stockCount: z.number().nonnegative(),
      title: z.string().optional(),
      isStockRecount: z.boolean().optional(),
      arrivalEventId: z.string().optional(),
      pricePaise: z.number().optional()
    }),
    evaluator: async (event) => {
      return evaluateInventoryArrivalEvent(event as any);
    }
  },

  'inventory.available': {
    type: 'inventory.available',
    family: 'merchandise',
    description: 'Sellable stock became available for SKU',
    dataSchema: z.object({
      sku: z.string().min(1),
      stockCount: z.number().nonnegative(),
      title: z.string().optional(),
      isStockRecount: z.boolean().optional(),
      arrivalEventId: z.string().optional()
    }),
    evaluator: async (event) => {
      return evaluateInventoryArrivalEvent(event as any);
    }
  },

  'stock.published': {
    type: 'stock.published',
    family: 'merchandise',
    description: 'Product restocked or published to catalog',
    dataSchema: z.object({
      sku: z.string().optional(),
      stockCount: z.number().optional(),
      title: z.string().optional()
    }),
    evaluator: async (event) => {
      const plain = typeof (event as any).toObject === 'function' ? (event as any).toObject() : event;
      return evaluateRestockEvent({
        ...plain,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt,
        entityVersion: event.entityVersion,
        data: {
          ...plain.data,
          sku: event.data?.sku || event.entityId
        }
      } as any);
    }
  },

  'festival.launch': {
    type: 'festival.launch',
    family: 'merchandise',
    description: 'Seasonal or festival campaign collection launch',
    dataSchema: z.object({
      seasonId: z.string().min(1),
      campaignId: z.string().optional(),
      title: z.string().optional()
    }),
    evaluator: async (event) => {
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'festival', ['festival', 'diwali', 'deepavali', 'festive']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for festival.launch');
        return { enrolledCount: 0 };
      }
      return evaluateFestivalEvent(event.tenantId, campaignId, event.data.seasonId);
    }
  },

  'collection.released': {
    type: 'collection.released',
    family: 'merchandise',
    description: 'New weave or collection release announcement',
    dataSchema: z.object({
      releaseId: z.string().min(1),
      campaignId: z.string().optional(),
      title: z.string().optional()
    }),
    evaluator: async (event) => {
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'collection', ['collection', 'release', 'launch']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for collection.released');
        return { enrolledCount: 0 };
      }
      return evaluateCollectionReleaseEvent(event.tenantId, campaignId, event.data.releaseId);
    }
  },

  'stockoffer.active': {
    type: 'stockoffer.active',
    family: 'merchandise',
    description: 'Special stock promotion or private discount activation',
    dataSchema: z.object({
      offerId: z.string().min(1),
      campaignId: z.string().optional(),
      discountPercent: z.number().optional()
    }),
    evaluator: async (event) => {
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'stockoffer', ['stockoffer', 'stock_offer', 'offer']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for stockoffer.active');
        return { enrolledCount: 0 };
      }
      return evaluateSelectedStockOfferEvent(event.tenantId, campaignId, event.data.offerId);
    }
  },

  // 2. Customer Lifecycle Family
  'order.completed': {
    type: 'order.completed',
    family: 'lifecycle',
    description: 'Customer completed purchase at billing register or online POS',
    dataSchema: z.object({
      orderId: z.string().min(1),
      customerId: z.string().min(1),
      netPaise: z.number().nonnegative().optional(),
      occasionRef: z.string().optional(),
      items: z.array(z.any()).optional()
    }),
    evaluator: async (event) => {
      const tenantId = event.tenantId;
      const customerId = event.customerId || event.data?.customerId;
      const orderId = event.entityId || event.data?.orderId;
      const occasionRef = event.data?.occasionRef;
      const netPaise = typeof event.data?.netPaise === 'number' ? event.data.netPaise : 0;

      // 1. Order goal evaluator
      await evaluateOrderCompletedGoal({
        tenantId,
        customerId,
        orderId,
        occasionRef,
        netPaise
      });

      // 2. Update Customer Purchase Fact
      await updateCustomerPurchaseFact({
        tenantId,
        customerId,
        orderId,
        purchaseAt: event.occurredAt || new Date(),
        netPaise
      });

      // 3. Complete the outfit trigger
      let outfitCampaignId = event.data?.outfitCampaignId;
      if (!outfitCampaignId) {
        const found = await findActiveCampaignForTrigger(tenantId, 'ORDER_EVENT', ['outfit', 'complete_outfit', 'blouse']);
        outfitCampaignId = found?.id;
      }
      if (outfitCampaignId) {
        await evaluateCompleteTheOutfitEvent(
          tenantId,
          outfitCampaignId,
          customerId,
          orderId,
          event.data?.ruleId || 'blouse_match'
        );
      }

      // 4. First to second purchase nurture trigger
      let nurtureCampaignId = event.data?.nurtureCampaignId;
      if (!nurtureCampaignId) {
        const found = await findActiveCampaignForTrigger(tenantId, 'ORDER_EVENT', ['nurture', 'first_second', 'repeat']);
        nurtureCampaignId = found?.id;
      }
      if (nurtureCampaignId) {
        await evaluateFirstToSecondPurchaseEvent(
          tenantId,
          nurtureCampaignId,
          customerId,
          orderId
        );
      }

      return { processed: true, orderId, customerId };
    }
  },

  'order.refunded': {
    type: 'order.refunded',
    family: 'lifecycle',
    description: 'Customer order refunded or returned',
    dataSchema: z.object({
      orderId: z.string().min(1),
      customerId: z.string().min(1),
      netPaise: z.number().optional(),
      remainingOrders: z.array(z.object({ orderId: z.string(), purchaseAt: z.coerce.date() })).optional()
    }),
    evaluator: async (event) => {
      const tenantId = event.tenantId;
      const customerId = event.customerId || event.data?.customerId;
      const refundedOrderId = event.entityId || event.data?.orderId;
      const remainingOrders = event.data?.remainingOrders || [];
      return handleOrderRefundFact(tenantId, customerId, refundedOrderId, remainingOrders);
    }
  },

  // 3. Retention Family
  'customer.vip_milestone': {
    type: 'customer.vip_milestone',
    family: 'retention',
    description: 'Customer crossed VIP tier threshold',
    dataSchema: z.object({
      customerId: z.string().optional(),
      vipTier: z.string().min(1),
      campaignId: z.string().optional()
    }),
    evaluator: async (event) => {
      const customerId = event.customerId || event.data?.customerId || event.entityId;
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'vip', ['vip', 'milestone', 'tier']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for customer.vip_milestone');
        return { enrolled: false };
      }
      return evaluateVipMilestoneEvent(event.tenantId, campaignId, customerId, event.data.vipTier);
    }
  },

  'credit.expiring': {
    type: 'credit.expiring',
    family: 'retention',
    description: 'Customer boutique store credit expiring soon',
    dataSchema: z.object({
      customerId: z.string().min(1),
      creditId: z.string().optional(),
      expiryDate: z.coerce.date().optional(),
      amountPaise: z.number().optional(),
      campaignId: z.string().optional()
    }),
    evaluator: async (event) => {
      const customerId = event.customerId || event.data.customerId;
      const creditId = event.data?.creditId || event.entityId;
      const expiryDate = event.data?.expiryDate ? new Date(event.data.expiryDate) : new Date(Date.now() + 7 * 86400000);
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'credit', ['credit', 'expiry', 'expiring']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for credit.expiring');
        return { enrolled: false };
      }
      return evaluateCreditExpiryEvent(event.tenantId, campaignId, customerId, creditId, expiryDate);
    }
  },

  'exhibition.announced': {
    type: 'exhibition.announced',
    family: 'retention',
    description: 'Boutique trunk show or private exhibition announced',
    dataSchema: z.object({
      showId: z.string().optional(),
      title: z.string().optional(),
      city: z.string().optional(),
      campaignId: z.string().optional()
    }),
    evaluator: async (event) => {
      const showId = event.data?.showId || event.entityId;
      let campaignId = event.data?.campaignId;
      if (!campaignId) {
        const found = await findActiveCampaignForTrigger(event.tenantId, 'exhibition', ['exhibition', 'trunk_show', 'show']);
        campaignId = found?.id;
      }
      if (!campaignId) {
        logger.warn({ eventId: event.eventId, tenantId: event.tenantId }, 'No active campaign found for exhibition.announced');
        return { enrolledCount: 0 };
      }
      return evaluateExhibitionInviteEvent(event.tenantId, campaignId, showId);
    }
  },

  // 4. Boutique Service Family
  'appointment.scheduled': {
    type: 'appointment.scheduled',
    family: 'boutique_service',
    description: 'Boutique bridal or styling fitting appointment booked',
    dataSchema: z.object({
      appointmentId: z.string().optional(),
      customerId: z.string().min(1),
      serviceType: z.string().optional(),
      time: z.string().optional()
    }),
    evaluator: async (event) => {
      const plain = typeof (event as any).toObject === 'function' ? (event as any).toObject() : event;
      return evaluateFittingAppointmentEvent({
        ...plain,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt,
        entityVersion: event.entityVersion,
        data: {
          ...plain.data,
          appointmentId: event.data?.appointmentId || event.entityId,
          customerId: event.customerId || event.data?.customerId
        }
      } as any);
    }
  },

  'delivery.updated': {
    type: 'delivery.updated',
    family: 'boutique_service',
    description: 'Courier package status update (e.g. out for delivery)',
    dataSchema: z.object({
      orderId: z.string().optional(),
      customerId: z.string().min(1),
      deliveryStatus: z.string().min(1)
    }),
    evaluator: async (event) => {
      const plain = typeof (event as any).toObject === 'function' ? (event as any).toObject() : event;
      return evaluateDeliveryUpdateEvent({
        ...plain,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt,
        entityVersion: event.entityVersion,
        data: {
          ...plain.data,
          orderId: event.data?.orderId || event.entityId,
          customerId: event.customerId || event.data?.customerId,
          deliveryStatus: event.data?.deliveryStatus
        }
      } as any);
    }
  },

  'alteration.completed': {
    type: 'alteration.completed',
    family: 'boutique_service',
    description: 'Blouse stitching or saree falls/pico alteration finished',
    dataSchema: z.object({
      jobId: z.string().optional(),
      customerId: z.string().min(1),
      itemTitle: z.string().optional()
    }),
    evaluator: async (event) => {
      const plain = typeof (event as any).toObject === 'function' ? (event as any).toObject() : event;
      return evaluateAlterationReadyEvent({
        ...plain,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt,
        entityVersion: event.entityVersion,
        data: {
          ...plain.data,
          jobId: event.data?.jobId || event.entityId,
          customerId: event.customerId || event.data?.customerId,
          itemTitle: event.data?.itemTitle
        }
      } as any);
    }
  },

  'enquiry.received': {
    type: 'enquiry.received',
    family: 'boutique_service',
    description: 'Patron submitted product enquiry or wedding consultation request',
    dataSchema: z.object({
      customerId: z.string().min(1),
      enquiryId: z.string().optional(),
      channel: z.string().optional(),
      message: z.string().optional()
    }),
    evaluator: async (event) => {
      return evaluateEnquiryEvent(event as any);
    }
  },

  // 5. WhatsApp Status Family
  'whatsapp.status': {
    type: 'whatsapp.status',
    family: 'status',
    description: 'Meta WhatsApp message delivery receipts and read confirmations',
    dataSchema: z.object({
      providerMessageId: z.string().min(1),
      status: z.string().min(1),
      errorCode: z.string().optional(),
      errorReason: z.string().optional()
    }),
    evaluator: async (event) => {
      const { providerMessageId, status, errorCode, errorReason } = event.data || {};
      if (!providerMessageId || !status) return;

      const intent = await CampaignDeliveryIntentModel.findOne({
        providerMessageId,
        tenantId: event.tenantId
      });

      if (intent) {
        const reconResult = await reconcileDeliveryStatus({
          tenantId: event.tenantId,
          providerMessageId,
          status,
          providerTimestamp: event.occurredAt || new Date(),
          errorCode: errorCode || 'PROVIDER_DELIVERY_FAILED',
          errorReason: errorReason || 'PROVIDER_DELIVERY_FAILED',
          inboxEventId: event.id
        });
        if (!reconResult.reconciled) {
          event.status = 'FAILED';
          event.errorMessage = reconResult.details;
          event.retryCount = (event.retryCount || 0) + 1;
          event.nextAttemptAt = null;
          await event.save();
          return event;
        }
        event.entityId = intent.executionId;
      }
    }
  }
};

/**
 * Returns definition for an event type (including wildcard prefix matching)
 */
export function getEventDefinition(type: string): EventTypeDefinition | undefined {
  if (!type || typeof type !== 'string') return undefined;

  if (EVENT_REGISTRY[type]) {
    return EVENT_REGISTRY[type];
  }

  if (type === 'festival.announced') {
    return EVENT_REGISTRY['festival.launch'];
  }

  if (type === 'customer.vip_promoted') {
    return EVENT_REGISTRY['customer.vip_milestone'];
  }

  if (type.startsWith('whatsapp.status.')) {
    return EVENT_REGISTRY['whatsapp.status'];
  }

  return undefined;
}

/**
 * Checks if an event type is recognized by the registry
 */
export function isKnownEventType(type: string): boolean {
  return !!getEventDefinition(type);
}

/**
 * Validates a raw event against universal envelope and registered type schema
 */
export function validateEventPayload(raw: any): { success: true; data: any } | { success: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'INCOMPATIBLE_SCHEMA: Payload must be a JSON object' };
  }

  const { schemaVersion, type, occurredAt, entityId, data } = raw;

  if (schemaVersion !== undefined && schemaVersion !== 1) {
    return { success: false, error: `INCOMPATIBLE_SCHEMA: Unsupported schemaVersion ${schemaVersion}` };
  }

  if (!type || typeof type !== 'string') {
    return { success: false, error: 'INCOMPATIBLE_SCHEMA: Missing or invalid event type' };
  }

  const eventDef = getEventDefinition(type);
  if (!eventDef) {
    return { success: false, error: `UNKNOWN_EVENT_TYPE: Unregistered domain event type '${type}'` };
  }

  if (!entityId || typeof entityId !== 'string') {
    return { success: false, error: 'INCOMPATIBLE_SCHEMA: Missing or invalid entityId' };
  }

  if (occurredAt) {
    const parsedDate = new Date(occurredAt);
    if (isNaN(parsedDate.getTime())) {
      return { success: false, error: 'INCOMPATIBLE_SCHEMA: Invalid occurredAt timestamp' };
    }
  }

  // Validate event.data against specific schema
  const dataResult = eventDef.dataSchema.safeParse(data || {});
  if (!dataResult.success) {
    const errorDetails = dataResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { success: false, error: `INCOMPATIBLE_SCHEMA: ${errorDetails}` };
  }

  return { success: true, data: { ...raw, data: dataResult.data } };
}
