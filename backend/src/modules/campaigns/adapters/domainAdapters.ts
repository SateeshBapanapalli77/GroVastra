import { z } from 'zod';
import { DomainEvent } from '../../../shared/events/types';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

/**
 * Domain Event Schemas with explicit schema versioning (Spec p.24)
 */

export const CustomerEventSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.string(),
  eventId: z.string(),
  tenantId: z.string(),
  type: z.enum(['customer.created', 'customer.updated', 'customer.opted_out', 'customer.vip_promoted']),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  data: z.object({
    phone: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    birthday: z.string().optional(),
    vipTier: z.string().optional()
  })
});

export const OrderEventSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.string(),
  eventId: z.string(),
  tenantId: z.string(),
  type: z.enum(['order.completed', 'order.refunded', 'order.cancelled']),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  data: z.object({
    orderId: z.string(),
    customerId: z.string(),
    netPaise: z.number().int().nonnegative(),
    occasionRef: z.string().optional(),
    items: z.array(z.object({ sku: z.string(), title: z.string() })).optional()
  })
});

export const InventoryEventSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.string(),
  eventId: z.string(),
  tenantId: z.string(),
  type: z.enum(['inventory.available', 'stock.published', 'inventory.recount']),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  data: z.object({
    sku: z.string(),
    stockCount: z.number().int().nonnegative(),
    title: z.string().optional(),
    isStockRecount: z.boolean().optional(),
    arrivalEventId: z.string().optional()
  })
});

export const AppointmentEventSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.string(),
  eventId: z.string(),
  tenantId: z.string(),
  type: z.enum(['appointment.scheduled', 'appointment.completed', 'alteration.completed', 'delivery.updated']),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  data: z.object({
    appointmentId: z.string().optional(),
    jobId: z.string().optional(),
    orderId: z.string().optional(),
    customerId: z.string(),
    itemTitle: z.string().optional(),
    deliveryStatus: z.string().optional()
  })
});

export const ReplyEventSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.literal('meta.whatsapp'),
  eventId: z.string(),
  tenantId: z.string(),
  type: z.literal('customer.replied'),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  occurredAt: z.coerce.date(),
  data: z.object({
    fromPhone: z.string(),
    messageText: z.string().optional()
  })
});

export type IngestResult =
  | { success: true; status: 'PERSISTED'; eventInboxId: string }
  | { success: false; status: 'QUARANTINE'; reason: string }
  | { success: false; status: 'REJECTED_STALE_VERSION'; reason: string };

/**
 * Universal Source Event Ingress Adapter (Spec p.24, p.26)
 * Validates schema, checks entity version against current state, and quarantines invalid payloads.
 */
export async function ingestDomainEvent(rawEvent: any): Promise<IngestResult> {
  // 1. Identify schema by event type
  const eventType = rawEvent?.type;
  let validationResult: any;

  if (eventType?.startsWith('customer.')) {
    validationResult = CustomerEventSchema.safeParse(rawEvent);
  } else if (eventType?.startsWith('order.')) {
    validationResult = OrderEventSchema.safeParse(rawEvent);
  } else if (eventType?.startsWith('inventory.') || eventType?.startsWith('stock.')) {
    validationResult = InventoryEventSchema.safeParse(rawEvent);
  } else if (eventType?.startsWith('appointment.') || eventType?.startsWith('alteration.') || eventType?.startsWith('delivery.')) {
    validationResult = AppointmentEventSchema.safeParse(rawEvent);
  } else if (eventType === 'customer.replied') {
    validationResult = ReplyEventSchema.safeParse(rawEvent);
  } else {
    // Unknown schema -> Visible QUARANTINE
    const quarantineId = generateId('quar');
    await CampaignEventInboxModel.create({
      id: quarantineId,
      tenantId: rawEvent?.tenantId || 'UNKNOWN',
      producer: rawEvent?.producer || 'UNKNOWN',
      eventId: rawEvent?.eventId || generateId('evt'),
      type: eventType || 'UNKNOWN',
      entityId: rawEvent?.entityId || 'UNKNOWN',
      entityVersion: rawEvent?.entityVersion || 1,
      occurredAt: rawEvent?.occurredAt ? new Date(rawEvent.occurredAt) : new Date(),
      status: 'QUARANTINE',
      data: rawEvent?.data || rawEvent || {},
      errorMessage: `Unknown schema family for event type: ${eventType}`
    });
    return { success: false, status: 'QUARANTINE', reason: `Unknown schema family for event type: ${eventType}` };
  }

  if (!validationResult.success) {
    const quarantineId = generateId('quar');
    await CampaignEventInboxModel.create({
      id: quarantineId,
      tenantId: rawEvent?.tenantId || 'UNKNOWN',
      producer: rawEvent?.producer || 'UNKNOWN',
      eventId: rawEvent?.eventId || generateId('evt'),
      type: eventType || 'UNKNOWN',
      entityId: rawEvent?.entityId || 'UNKNOWN',
      entityVersion: rawEvent?.entityVersion || 1,
      occurredAt: rawEvent?.occurredAt ? new Date(rawEvent.occurredAt) : new Date(),
      status: 'QUARANTINE',
      data: rawEvent?.data || rawEvent || {},
      errorMessage: validationResult.error.message
    });
    return { success: false, status: 'QUARANTINE', reason: validationResult.error.message };
  }

  const validEvent = validationResult.data as DomainEvent<any>;

  // 2. Reject stale entity versions (Spec p.24)
  const priorProcessed = await CampaignEventInboxModel.findOne({
    tenantId: validEvent.tenantId,
    entityId: validEvent.entityId
  }).sort({ entityVersion: -1 });

  if (priorProcessed && validEvent.entityVersion <= priorProcessed.entityVersion) {
    logger.warn(
      { entityId: validEvent.entityId, received: validEvent.entityVersion, existing: priorProcessed.entityVersion },
      'Stale entity version rejected'
    );
    return {
      success: false,
      status: 'REJECTED_STALE_VERSION',
      reason: `Received version ${validEvent.entityVersion} <= current version ${priorProcessed.entityVersion}`
    };
  }

  // 3. Persist valid event
  const inboxId = generateId('inbox');
  await CampaignEventInboxModel.create({
    id: inboxId,
    tenantId: validEvent.tenantId,
    producer: validEvent.producer,
    eventId: validEvent.eventId,
    type: validEvent.type,
    entityId: validEvent.entityId,
    entityVersion: validEvent.entityVersion,
    occurredAt: validEvent.occurredAt,
    status: 'RECEIVED',
    data: validEvent.data || {}
  });

  return { success: true, status: 'PERSISTED', eventInboxId: inboxId };
}
