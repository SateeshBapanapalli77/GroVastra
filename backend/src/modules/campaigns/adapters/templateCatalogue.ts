export interface ApprovedTemplate {
  id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY';
  revision: number;
  language: string;
  status: 'APPROVED' | 'PAUSED';
  bodyTemplate: string;
  variableKeys: string[]; // e.g. ['name', 'shop', 'offer']
  render(vars: Record<string, string>): string;
}

export const APPROVED_TEMPLATES: Record<string, ApprovedTemplate> = {
  tpl_birthday_invite: {
    id: 'tpl_birthday_invite',
    name: 'Birthday Boutique Invitation',
    category: 'MARKETING',
    revision: 3,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, celebrate your special month with us at {{shop}}! Enjoy an exclusive birthday treat on our handcrafted silk collection.',
    variableKeys: ['name', 'shop'],
    render(vars) {
      return `Dear ${vars.name || ''}, celebrate your special month with us at ${vars.shop || ''}! Enjoy an exclusive birthday treat on our handcrafted silk collection.`;
    }
  },
  tpl_birthday_followup: {
    id: 'tpl_birthday_followup',
    name: 'Birthday Reminder',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Hi {{name}}, just a reminder that your birthday boutique gift voucher is waiting for you this week.',
    variableKeys: ['name'],
    render(vars) {
      return `Hi ${vars.name || ''}, just a reminder that your birthday boutique gift voucher is waiting for you this week.`;
    }
  },
  tpl_birthday_greeting: {
    id: 'tpl_birthday_greeting',
    name: 'Birthday Greeting',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Wishing you a very Happy Birthday, {{name}}! May your year be filled with elegance and joy.',
    variableKeys: ['name'],
    render(vars) {
      return `Wishing you a very Happy Birthday, ${vars.name || ''}! May your year be filled with elegance and joy.`;
    }
  },
  tpl_anniversary_invite: {
    id: 'tpl_anniversary_invite',
    name: 'Anniversary Celebration',
    category: 'MARKETING',
    revision: 2,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, Happy Anniversary! To make your celebration memorable, enjoy a personalized styling session and private preview at {{shop}}.',
    variableKeys: ['name', 'shop'],
    render(vars) {
      return `Dear ${vars.name || ''}, Happy Anniversary! To make your celebration memorable, enjoy a personalized styling session and private preview at ${vars.shop || ''}!`;
    }
  },
  tpl_stock_restock: {
    id: 'tpl_stock_restock',
    name: 'Requested Saree Restocked',
    category: 'MARKETING',
    revision: 2,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Good news {{name}}! The {{item}} you requested is now back in our boutique. Only limited pieces woven.',
    variableKeys: ['name', 'item'],
    render(vars) {
      return `Good news ${vars.name || ''}! The ${vars.item || ''} you requested is now back in our boutique. Only limited pieces woven.`;
    }
  },
  tpl_alteration_ready: {
    id: 'tpl_alteration_ready',
    name: 'Outfit Ready For Pickup',
    category: 'UTILITY',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, your outfit {{outfit}} is tailored and ready for collection at {{store}}.',
    variableKeys: ['name', 'outfit', 'store'],
    render(vars) {
      return `Dear ${vars.name || ''}, your outfit ${vars.outfit || ''} is tailored and ready for collection at ${vars.store || ''}.`;
    }
  },
  tpl_winback_offer: {
    id: 'tpl_winback_offer',
    name: 'We Miss You In Store',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Hello {{name}}, we have missed your visits! Explore our new seasonal festive weave arrivals with {{offer}} on your next visit.',
    variableKeys: ['name', 'offer'],
    render(vars) {
      return `Hello ${vars.name || ''}, we have missed your visits! Explore our new seasonal festive weave arrivals with ${vars.offer || ''} on your next visit.`;
    }
  },
  tpl_festival_launch: {
    id: 'tpl_festival_launch',
    name: 'Festival Collection Launch',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, celebrate the upcoming festivities with our exclusive festive weaves at {{shop}}.',
    variableKeys: ['name', 'shop'],
    render(vars) {
      return `Dear ${vars.name || ''}, celebrate the upcoming festivities with our exclusive festive weaves at ${vars.shop || ''}.`;
    }
  },
  tpl_collection_launch: {
    id: 'tpl_collection_launch',
    name: 'New Collection Release',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, our newest seasonal collection has just arrived at {{shop}}! Discover handcrafted silk masterpieces.',
    variableKeys: ['name', 'shop'],
    render(vars) {
      return `Dear ${vars.name || ''}, our newest seasonal collection has just arrived at ${vars.shop || ''}! Discover handcrafted silk masterpieces.`;
    }
  },
  tpl_enquiry_followup: {
    id: 'tpl_enquiry_followup',
    name: 'Boutique Enquiry Follow-Up',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Hi {{name}}, we noticed you inquired about our sarees. Let us know if we can reserve a styling session for you.',
    variableKeys: ['name'],
    render(vars) {
      return `Hi ${vars.name || ''}, we noticed you inquired about our sarees. Let us know if we can reserve a styling session for you.`;
    }
  },
  tpl_fitting_appointment: {
    id: 'tpl_fitting_appointment',
    name: 'Fitting Appointment Reminder',
    category: 'UTILITY',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, your bespoke bridal fitting appointment is scheduled at {{store}}.',
    variableKeys: ['name', 'store'],
    render(vars) {
      return `Dear ${vars.name || ''}, your bespoke bridal fitting appointment is scheduled at ${vars.store || ''}.`;
    }
  },
  tpl_delivery_update: {
    id: 'tpl_delivery_update',
    name: 'Order Delivery Update',
    category: 'UTILITY',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, your boutique order {{outfit}} is out for delivery from {{store}}.',
    variableKeys: ['name', 'outfit', 'store'],
    render(vars) {
      return `Dear ${vars.name || ''}, your boutique order ${vars.outfit || ''} is out for delivery from ${vars.store || ''}.`;
    }
  },
  tpl_vip_milestone: {
    id: 'tpl_vip_milestone',
    name: 'VIP Patron Milestone Celebration',
    category: 'MARKETING',
    revision: 1,
    language: 'en',
    status: 'APPROVED',
    bodyTemplate: 'Dear {{name}}, thank you for being a cherished patron at {{shop}}! You have unlocked our VIP Privileged Styling Circle.',
    variableKeys: ['name', 'shop'],
    render(vars) {
      return `Dear ${vars.name || ''}, thank you for being a cherished patron at ${vars.shop || ''}! You have unlocked our VIP Privileged Styling Circle.`;
    }
  }
};

export function getApprovedTemplate(templateId: string): ApprovedTemplate | null {
  return APPROVED_TEMPLATES[templateId] || null;
}
