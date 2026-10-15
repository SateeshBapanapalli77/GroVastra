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
}

export const BOUTIQUE_CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
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
    ]
  },
  {
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
    ]
  },
  {
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
    ]
  },
  {
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
    ]
  },
  {
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
    ]
  },
  {
    id: 'preset_festival_launch',
    name: 'Festival Collection Launch',
    category: 'MERCHANDISE',
    purpose: 'MARKETING',
    description: 'Celebrate festive seasons with exclusive private preview invitations for store patrons.',
    defaultPriority: 50,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'festival.announced'
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
    ]
  },
  {
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
    ]
  },
  {
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
    ]
  },
  {
    id: 'preset_vip_milestone',
    name: 'VIP Patron Milestone',
    category: 'LIFECYCLE',
    purpose: 'MARKETING',
    description: 'Recognize high-value patrons when they cross milestone boutique spend thresholds.',
    defaultPriority: 60,
    trigger: {
      type: 'EVENT_DRIVEN',
      eventType: 'customer.vip_promoted'
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
    ]
  },
  {
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
    ]
  },
  {
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
    ]
  }
];

export function getCampaignPreset(presetId: string): CampaignPreset | null {
  return BOUTIQUE_CAMPAIGN_PRESETS.find((p) => p.id === presetId) || null;
}
