import { z } from 'zod';
import { IANAZone } from 'luxon';

// Allowlisted audience fields from backend/src/modules/campaigns/engine/audienceEngine.ts
export const ALLOWLISTED_AUDIENCE_FIELDS = [
  { value: 'customer.status', label: 'Patron Account Status (ACTIVE / INACTIVE)' },
  { value: 'customer.tags', label: 'Patron Tags (VIP, Bridal, Festive)' },
  { value: 'customer.totalSpendPaise', label: 'Total Historical Spend in Paise' },
  { value: 'customer.preferences.weave', label: 'Weave Preference (Kanchipuram, Banarasi, Chanderi)' },
  { value: 'customer.preferences.budgetMaxPaise', label: 'Maximum Budget in Paise' },
  { value: 'customer.preferences.preferredLanguage', label: 'Preferred Language (en, te, ta, hi)' },
  { value: 'channelSuppressed', label: 'WhatsApp Channel Suppressed (true/false)' },
  { value: 'optedInMarketing', label: 'Promotional Marketing Opt-In (true/false)' },
  { value: 'serviceIssueOpen', label: 'Open Service Issue Flag (true/false)' },
  { value: 'customer.city', label: 'City / Geographical Region' }
] as const;

// Allowlisted operators from backend/src/modules/campaigns/engine/audienceEngine.ts
export const ALLOWLISTED_AUDIENCE_OPERATORS = [
  { value: 'eq', label: 'equals (=)' },
  { value: 'neq', label: 'does not equal (!=)' },
  { value: 'gt', label: 'greater than (>)' },
  { value: 'gte', label: 'greater than or equal (>=)' },
  { value: 'lt', label: 'less than (<)' },
  { value: 'lte', label: 'less than or equal (<=)' },
  { value: 'in', label: 'in list (comma-separated)' },
  { value: 'nin', label: 'not in list' },
  { value: 'contains', label: 'contains substring' },
  { value: 'not_contains', label: 'does not contain' }
] as const;

// Allowlisted binding source expressions for message variables
export const ALLOWLISTED_BINDING_SOURCES = [
  { value: 'customer.firstName', label: 'Patron First Name (e.g. Lakshmi)' },
  { value: 'customer.lastName', label: 'Patron Last Name (e.g. Devi)' },
  { value: 'customer.fullName', label: 'Patron Full Name (e.g. Lakshmi Devi)' },
  { value: 'shop.displayName', label: 'Store Display Name (e.g. Padmavati Silks)' },
  { value: 'order.itemTitle', label: 'Order / Outfit Title (e.g. Kanchipuram Bridal Saree)' },
  { value: 'product.title', label: 'Product Name (e.g. Royal Brocade Saree)' },
  { value: 'product.price', label: 'Product Price in ₹ (e.g. ₹24,500)' },
  { value: 'order.id', label: 'Order Identification Number' },
  { value: 'order.amount', label: 'Order Total Net Amount in ₹' },
  { value: 'event.date', label: 'Occasion Local Calendar Date' },
  { value: 'offer.code', label: 'Voucher Discount Code (e.g. BDAY15)' }
] as const;

export const PredicateSchema = z.object({
  field: z.string().min(1, 'Field is required'),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'not_contains']),
  value: z.string().min(1, 'Value is required')
});

export type RulePredicate = z.infer<typeof PredicateSchema>;

export const TriggerConfigSchema = z.object({
  type: z.enum(['ANNUAL_DATE', 'EVENT_DRIVEN', 'INACTIVITY_SCAN']),
  field: z.string().optional(),
  advanceDays: z.number().default(0),
  leapDayPolicy: z.enum(['FEB_28', 'MAR_01', 'LEAP_ONLY']).default('FEB_28'),
  eventType: z.string().optional(),
  inactivityDays: z.number().optional(),
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), {
    message: 'Must be a valid IANA timezone (e.g. Asia/Kolkata)'
  }).default('Asia/Kolkata'),
  localTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:mm format').default('10:00')
});

export const AudienceConfigSchema = z.object({
  mode: z.enum(['ALL_ELIGIBLE', 'RULE_BASED']),
  rules: z.object({
    all: z.array(PredicateSchema).default([]),
    any: z.array(PredicateSchema).default([]),
    none: z.array(PredicateSchema).default([])
  }).default({ all: [], any: [], none: [] })
}).refine(
  (data) => {
    if (data.mode === 'ALL_ELIGIBLE') return true;
    const allCount = data.rules.all?.length || 0;
    const anyCount = data.rules.any?.length || 0;
    const noneCount = data.rules.none?.length || 0;
    return allCount + anyCount + noneCount > 0;
  },
  {
    message: 'Empty audience configuration requires explicit mode ALL_ELIGIBLE, or at least one rule predicate.',
    path: ['mode']
  }
);

export const StepConfigSchema = z.object({
  stepId: z.string().min(1, 'Step ID is required'),
  offsetDays: z.number(),
  localTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:mm format').default('10:00'),
  prerequisite: z.enum(['NONE', 'PREVIOUS_ACCEPTED']).default('NONE'),
  templateRef: z.object({
    id: z.string().min(1, 'Template selection is required'),
    revision: z.number().default(1),
    language: z.string().default('en')
  }),
  bindings: z.record(z.string(), z.string()).default({}),
  stopOnReply: z.boolean().default(true),
  stopOnGoal: z.boolean().default(true),
  maxLatenessMinutes: z.number().min(15, 'Minimum 15 minutes').default(120)
});

export const MessagesConfigSchema = z.object({
  steps: z.array(StepConfigSchema).min(1, 'At least one step is required').max(3, 'Maximum 3 steps allowed')
}).refine(
  (data) => {
    // Spec & Prompt requirement: offsets that must strictly increase across steps
    for (let i = 1; i < data.steps.length; i++) {
      if (data.steps[i].offsetDays <= data.steps[i - 1].offsetDays) {
        return false;
      }
    }
    return true;
  },
  {
    message: 'Step day offsets must strictly increase in chronological sequence.',
    path: ['steps']
  }
);

export const SendingRulesConfigSchema = z.object({
  priority: z.number().min(1, 'Minimum priority is 1').max(100, 'Maximum priority is 100').default(50),
  resumePolicy: z.enum(['FUTURE_ONLY', 'REPLAY_RECENT']).default('FUTURE_ONLY'),
  goal: z.object({
    type: z.enum(['OCCASION_TAGGED_OR_STAFF_COMPLETED', 'ORDER_COMPLETED', 'APPOINTMENT_ATTENDED']).default('OCCASION_TAGGED_OR_STAFF_COMPLETED'),
    windowDays: z.number().min(1).max(90).default(14)
  }).default({ type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED', windowDays: 14 })
});

export const CampaignDraftFormSchema = z.object({
  name: z.string().min(3, 'Campaign name must be at least 3 characters'),
  trigger: TriggerConfigSchema,
  audience: AudienceConfigSchema,
  steps: z.array(StepConfigSchema).min(1).max(3),
  sendingRules: SendingRulesConfigSchema
});

export type CampaignDraftFormData = z.infer<typeof CampaignDraftFormSchema>;
