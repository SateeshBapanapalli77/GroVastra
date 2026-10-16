import { isKnownEventType, getEventDefinition } from '../../../shared/events/registry';
import { runIndexedInactivityScan } from '../engine/lifecycleStrategy';
import { planAnnualOccasions } from '../engine/annualDateStrategy';

export interface CampaignPreset {
  id: string;
  name: string;
  category: 'OCCASION' | 'MERCHANDISE' | 'LIFECYCLE' | 'SERVICE';
  purpose: 'MARKETING' | 'ORDER_SERVICE';
  description: string;
  defaultPriority: number;
  trigger: {
    type: 'ANNUAL_DATE' | 'EVENT_DRIVEN' | 'INACTIVITY_SCAN';
    field?: string;
    eventType?: string;
    inactivityDays?: number;
    leapDayPolicy?: 'FEB_28' | 'MAR_01' | 'LEAP_ONLY';
  };
  defaultSteps: Array<{
    stepId: string;
    name: string;
    offsetDays: number;
    localTime: string;
    prerequisite: 'NONE' | 'PREVIOUS_ACCEPTED';
    templateId: string;
    templateRevision: number;
    bindings: Record<string, string>;
    stopOnReply: boolean;
    stopOnGoal: boolean;
    maxLatenessMinutes: number;
  }>;
  requiredEvents: string[];
  requiredData: string[];
  readonly implemented: boolean;
}

/**
 * Checks if inactivity scanner worker evaluator is implemented
 */
export function isScannerImplemented(): boolean {
  return typeof runIndexedInactivityScan === 'function';
}

/**
 * Checks if annual calendar date planner strategy is implemented for field
 */
export function isAnnualPlannerImplemented(field?: string): boolean {
  if (typeof planAnnualOccasions !== 'function') return false;
  if (!field) return false;
  return ['customer.birthday', 'customer.anniversary'].includes(field);
}

/**
 * Dynamically computes whether a preset has a real registered consumer (event evaluator,
 * scanner worker, or calendar planner) so the capability flag cannot drift from reality.
 */
export function isPresetImplemented(preset: {
  trigger: {
    type: 'ANNUAL_DATE' | 'EVENT_DRIVEN' | 'INACTIVITY_SCAN';
    field?: string;
    eventType?: string;
    inactivityDays?: number;
  };
  requiredEvents?: string[];
}): boolean {
  if (preset.trigger.type === 'EVENT_DRIVEN') {
    const events =
      preset.requiredEvents && preset.requiredEvents.length > 0
        ? preset.requiredEvents
        : preset.trigger.eventType
          ? [preset.trigger.eventType]
          : [];

    if (events.length === 0) return false;

    return events.every((evt) => {
      const def = getEventDefinition(evt);
      return !!def && typeof def.evaluator === 'function';
    });
  }

  if (preset.trigger.type === 'INACTIVITY_SCAN') {
    return isScannerImplemented();
  }

  if (preset.trigger.type === 'ANNUAL_DATE') {
    return isAnnualPlannerImplemented(preset.trigger.field);
  }

  return false;
}

function definePreset(raw: Omit<CampaignPreset, 'implemented'>): CampaignPreset {
  return {
    ...raw,
    get implemented(): boolean {
      return isPresetImplemented(raw);
    }
  };
}

export const BOUTIQUE_CAMPAIGN_PRESETS: CampaignPreset[] = [
  definePreset({
    id: 'preset_birthday_shopping',
    name: 'Birthday Boutique Shopping',
    category: 'OCCASION',
    purpose: 'MARKETING',
    description: 'Engage customers ahead of their birthday with styling invitations and reminders.',
    defaultPriority: 80,
    trigger: {
      type: 'ANNUAL_DATE',
      field: 'customer.birthday',
      leapDayPolicy: 'FEB_28'
    },
    defaultSteps: [
      {
        stepId: 'invitation',
        name: 'Early Invitation (D-14)',
        offsetDays: -14,
        localTime: '10:00',
        prerequisite: 'NONE',
        templateId: 'tpl_birthday_invite',
        templateRevision: 3,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 120
      },
      {
        stepId: 'followup',
        name: 'Follow-up Reminder (D-7)',
        offsetDays: -7,
        localTime: '10:00',
        prerequisite: 'PREVIOUS_ACCEPTED',
        templateId: 'tpl_birthday_followup',
        templateRevision: 1,
        bindings: { name: 'customer.firstName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 120
      },
      {
        stepId: 'greeting',
        name: 'Birthday Greeting (D0)',
        offsetDays: 0,
        localTime: '10:00',
        prerequisite: 'NONE',
        templateId: 'tpl_birthday_greeting',
        templateRevision: 1,
        bindings: { name: 'customer.firstName' },
        stopOnReply: false,
        stopOnGoal: false,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: [],
    requiredData: ['customer.birthday', 'customer.firstName', 'shop.displayName']
  }),
  definePreset({
    id: 'preset_anniversary_shopping',
    name: 'Wedding Anniversary Celebration',
    category: 'OCCASION',
    purpose: 'MARKETING',
    description: 'Celebrate customer anniversaries with exclusive private preview invitations.',
    defaultPriority: 80,
    trigger: {
      type: 'ANNUAL_DATE',
      field: 'customer.anniversary',
      leapDayPolicy: 'FEB_28'
    },
    defaultSteps: [
      {
        stepId: 'invitation',
        name: 'Anniversary Preview (D-21)',
        offsetDays: -21,
        localTime: '10:00',
        prerequisite: 'NONE',
        templateId: 'tpl_anniversary_invite',
        templateRevision: 2,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 120
      }
    ],
    requiredEvents: [],
    requiredData: ['customer.anniversary', 'customer.firstName', 'shop.displayName']
  }),
  definePreset({
    id: 'preset_restock_alert',
    name: 'Requested Saree Restock Alert',
    category: 'MERCHANDISE',
    purpose: 'MARKETING',
    description: 'Instantly notify customers when a requested handloom weave or color arrives in stock.',
    defaultPriority: 60,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'stock.published'
    },
    defaultSteps: [
      {
        stepId: 'restock_notification',
        name: 'Immediate Restock Alert',
        offsetDays: 0,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_stock_restock',
        templateRevision: 2,
        bindings: { name: 'customer.firstName', item: 'product.title' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 180
      }
    ],
    requiredEvents: ['stock.published'],
    requiredData: ['customer.firstName', 'product.title']
  }),
  definePreset({
    id: 'preset_alteration_ready',
    name: 'Boutique Alteration Ready',
    category: 'SERVICE',
    purpose: 'ORDER_SERVICE',
    description: 'Notify boutique clients when custom blouse stitching or alteration is completed.',
    defaultPriority: 90,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'alteration.completed'
    },
    defaultSteps: [
      {
        stepId: 'ready_for_pickup',
        name: 'Pickup Notification',
        offsetDays: 0,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_alteration_ready',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', outfit: 'order.itemTitle', store: 'shop.displayName' },
        stopOnReply: false,
        stopOnGoal: false,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['alteration.completed'],
    requiredData: ['customer.firstName', 'order.itemTitle', 'shop.displayName']
  }),
  definePreset({
    id: 'preset_winback_inactive',
    name: 'Customer Win-Back (90 Days)',
    category: 'LIFECYCLE',
    purpose: 'MARKETING',
    description: 'Invite past clients back to the boutique with personalized weave suggestions.',
    defaultPriority: 30,
    trigger: {
      type: 'INACTIVITY_SCAN',
      inactivityDays: 90
    },
    defaultSteps: [
      {
        stepId: 'winback_nudge',
        name: 'We Miss You In Store',
        offsetDays: 0,
        localTime: '11:30',
        prerequisite: 'NONE',
        templateId: 'tpl_winback_offer',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', offer: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 180
      }
    ],
    requiredEvents: [],
    requiredData: ['customer.firstName', 'shop.displayName', 'customer.lastPurchaseDate']
  }),
  definePreset({
    id: 'preset_festival_launch',
    name: 'Festival Collection Launch',
    category: 'MERCHANDISE',
    purpose: 'MARKETING',
    description: 'Celebrate festive seasons with exclusive private preview invitations for store patrons.',
    defaultPriority: 50,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'festival.launch'
    },
    defaultSteps: [
      {
        stepId: 'festival_greeting',
        name: 'Festive Preview Announcement',
        offsetDays: 0,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_festival_launch',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['festival.launch'],
    requiredData: ['customer.firstName', 'shop.displayName', 'event.seasonId']
  }),
  definePreset({
    id: 'preset_collection_release',
    name: 'New Collection Release',
    category: 'MERCHANDISE',
    purpose: 'MARKETING',
    description: 'Invite VIP patrons to view newly arrived seasonal collection releases.',
    defaultPriority: 50,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'collection.released'
    },
    defaultSteps: [
      {
        stepId: 'collection_preview',
        name: 'Collection Preview Invitation',
        offsetDays: 0,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_collection_launch',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['collection.released'],
    requiredData: ['customer.firstName', 'shop.displayName', 'event.releaseId']
  }),
  definePreset({
    id: 'preset_unresolved_enquiry',
    name: 'Unresolved Boutique Enquiry',
    category: 'LIFECYCLE',
    purpose: 'MARKETING',
    description: 'Promptly follow up on boutique styling and saree inquiries before patron interest fades.',
    defaultPriority: 70,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'enquiry.received'
    },
    defaultSteps: [
      {
        stepId: 'enquiry_nudge_24h',
        name: 'First Follow-Up (+24h)',
        offsetDays: 1,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_enquiry_followup',
        templateRevision: 1,
        bindings: { name: 'customer.firstName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 180
      }
    ],
    requiredEvents: ['enquiry.received'],
    requiredData: ['customer.firstName']
  }),
  definePreset({
    id: 'preset_vip_milestone',
    name: 'VIP Patron Milestone',
    category: 'LIFECYCLE',
    purpose: 'MARKETING',
    description: 'Recognize high-value patrons when they cross milestone boutique spend thresholds.',
    defaultPriority: 60,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'customer.vip_milestone'
    },
    defaultSteps: [
      {
        stepId: 'vip_congratulations',
        name: 'VIP Privileged Status Notice',
        offsetDays: 0,
        localTime: '12:00',
        prerequisite: 'NONE',
        templateId: 'tpl_vip_milestone',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['customer.vip_milestone'],
    requiredData: ['customer.firstName', 'shop.displayName', 'customer.vipTier']
  }),
  definePreset({
    id: 'preset_fitting_appointment',
    name: 'Fitting Appointment Reminder',
    category: 'SERVICE',
    purpose: 'ORDER_SERVICE',
    description: 'Operational appointment notice for bridal and blouse custom measurements.',
    defaultPriority: 90,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'appointment.scheduled'
    },
    defaultSteps: [
      {
        stepId: 'fitting_reminder',
        name: 'Fitting Time Confirmation',
        offsetDays: 0,
        localTime: '10:00',
        prerequisite: 'NONE',
        templateId: 'tpl_fitting_appointment',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', store: 'shop.displayName' },
        stopOnReply: false,
        stopOnGoal: false,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['appointment.scheduled'],
    requiredData: ['customer.firstName', 'shop.displayName']
  }),
  definePreset({
    id: 'preset_delivery_update',
    name: 'Order Courier Delivery Update',
    category: 'SERVICE',
    purpose: 'ORDER_SERVICE',
    description: 'Real-time order delivery dispatched notice with out-for-delivery tracking.',
    defaultPriority: 90,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'delivery.updated'
    },
    defaultSteps: [
      {
        stepId: 'out_for_delivery',
        name: 'Out For Delivery Notice',
        offsetDays: 0,
        localTime: '10:30',
        prerequisite: 'NONE',
        templateId: 'tpl_delivery_update',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', outfit: 'order.itemTitle', store: 'shop.displayName' },
        stopOnReply: false,
        stopOnGoal: false,
        maxLatenessMinutes: 240
      }
    ],
    requiredEvents: ['delivery.updated'],
    requiredData: ['customer.firstName', 'order.itemTitle', 'shop.displayName']
  }),
  // Unimplemented presets for capability discovery and future milestone guard testing
  definePreset({
    id: 'preset_abandoned_browse',
    name: 'Abandoned Browse Saree Nudge',
    category: 'MERCHANDISE',
    purpose: 'MARKETING',
    description: 'Re-engage patrons who browsed sarees in the catalog but left without booking a trial.',
    defaultPriority: 40,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'catalog.browse_abandoned'
    },
    defaultSteps: [
      {
        stepId: 'browse_reminder',
        name: 'Handloom Saree Still Waiting',
        offsetDays: 1,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_browse_reminder',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 180
      }
    ],
    requiredEvents: ['catalog.browse_abandoned'],
    requiredData: ['customer.firstName', 'catalog.viewedItems']
  }),
  definePreset({
    id: 'preset_care_renewal',
    name: 'Heirloom Zari Care & Polishing',
    category: 'SERVICE',
    purpose: 'ORDER_SERVICE',
    description: 'Offer bespoke saree dry-cleaning and zari preservation 6 months after silk purchase.',
    defaultPriority: 40,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'wardrobe.care_due'
    },
    defaultSteps: [
      {
        stepId: 'zari_care_nudge',
        name: 'Zari Maintenance Reminder',
        offsetDays: 0,
        localTime: '11:00',
        prerequisite: 'NONE',
        templateId: 'tpl_zari_care',
        templateRevision: 1,
        bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
        stopOnReply: true,
        stopOnGoal: true,
        maxLatenessMinutes: 180
      }
    ],
    requiredEvents: ['wardrobe.care_due'],
    requiredData: ['customer.firstName', 'order.itemTitle']
  })
];

export function getCampaignPreset(presetId: string): CampaignPreset | null {
  return BOUTIQUE_CAMPAIGN_PRESETS.find((p) => p.id === presetId) || null;
}
