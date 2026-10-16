export type ReasonCodeCategory = 'SKIP' | 'DEFER' | 'BLOCK' | 'FAIL';

export type ResolutionOwner =
  | 'BOUTIQUE_OWNER'
  | 'STORE_MANAGER'
  | 'STAFF'
  | 'SYSTEM'
  | 'EXTERNAL_PROVIDER';

export interface ReasonCodeDefinition {
  code: string;
  category: ReasonCodeCategory;
  ownerMessage: string;
  resolutionOwner: ResolutionOwner;
}

export const CAMPAIGN_REASON_CODES: ReasonCodeDefinition[] = [
  // --- SKIP CATEGORY ---
  {
    code: 'SKIPPED_MARKETING_OPT_OUT',
    category: 'SKIP',
    ownerMessage: 'Patron has opted out of marketing communications.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_CHANNEL_SUPPRESSED',
    category: 'SKIP',
    ownerMessage: 'Patron WhatsApp delivery channel is suppressed or inactive.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_CUSTOMER_DELETED',
    category: 'SKIP',
    ownerMessage: 'Customer record was deleted or marked inactive in CRM.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_GOAL_REACHED',
    category: 'SKIP',
    ownerMessage: 'Qualifying occasion purchase or goal was completed, halting further automated messages.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_REPLY_HOLD',
    category: 'SKIP',
    ownerMessage: 'Customer replied to a previous message; automated sequence held for staff conversation.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_STEP_EXPIRED',
    category: 'SKIP',
    ownerMessage: 'Campaign step passed its useful deadline or allowed delivery window.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_PREREQUISITE_NOT_MET',
    category: 'SKIP',
    ownerMessage: 'Prerequisite prior step was not accepted or failed delivery.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_MISSING_VARIABLE',
    category: 'SKIP',
    ownerMessage: 'Required patron or instance variable was missing or blank at evaluation time.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_CUSTOMER_DATE_REMOVED',
    category: 'SKIP',
    ownerMessage: 'Occasion date was removed from customer profile after initial enrollment.',
    resolutionOwner: 'STAFF'
  },
  {
    code: 'SKIPPED_ALREADY_ACCEPTED',
    category: 'SKIP',
    ownerMessage: 'Step was already delivered or accepted under an earlier occasion plan.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_ELAPSED',
    category: 'SKIP',
    ownerMessage: 'Step date already elapsed prior to campaign activation (future-only policy).',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_BLACKOUT_EXPIRED',
    category: 'SKIP',
    ownerMessage: 'Scheduled dispatch fell into a blackout window and expired before the window opened.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'SKIPPED_CONTACT_CAP',
    category: 'SKIP',
    ownerMessage: 'Patron reached daily or weekly marketing message limit and message cannot be deferred.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_STOCK_DEPLETED',
    category: 'SKIP',
    ownerMessage: 'Target merchandise is out of stock or marked unsellable at send time.',
    resolutionOwner: 'STORE_MANAGER'
  },
  {
    code: 'SKIPPED_CAMPAIGN_ARCHIVED',
    category: 'SKIP',
    ownerMessage: 'Campaign was archived; pending executions were cancelled.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'SKIPPED_CAMPAIGN_NOT_FOUND',
    category: 'SKIP',
    ownerMessage: 'Campaign definition could not be resolved in tenant repository.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'SKIPPED_ENROLLMENT_INACTIVE',
    category: 'SKIP',
    ownerMessage: 'Customer campaign enrollment is no longer active.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_VERSION_NOT_FOUND',
    category: 'SKIP',
    ownerMessage: 'Published campaign version definition was not found.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_STEP_NOT_FOUND',
    category: 'SKIP',
    ownerMessage: 'Step definition was not found in campaign version.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'SKIPPED_CAMPAIGN_PAUSED',
    category: 'SKIP',
    ownerMessage: 'Execution skipped because campaign is paused or archived.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'CAMPAIGN_OR_GLOBAL_PAUSED',
    category: 'SKIP',
    ownerMessage: 'Store messaging is globally paused across all automated campaigns.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'SKIPPED_NOT_DUE',
    category: 'SKIP',
    ownerMessage: 'Scheduled scan checkpoint is not yet due.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'SKIPPED_ALREADY_LEASED',
    category: 'SKIP',
    ownerMessage: 'Scan checkpoint is currently leased by another active worker instance.',
    resolutionOwner: 'SYSTEM'
  },

  // --- DEFER CATEGORY ---
  {
    code: 'DEFERRED_GLOBAL_PAUSED',
    category: 'DEFER',
    ownerMessage: 'Message dispatch deferred while store-wide messaging is globally paused.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'DEFERRED_CAMPAIGN_PAUSED',
    category: 'DEFER',
    ownerMessage: 'Message dispatch deferred while campaign is paused.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'DEFERRED_OUTSIDE_ALLOWED_HOURS',
    category: 'DEFER',
    ownerMessage: 'Delivery deferred to the next allowed delivery window (10:00 to 19:00).',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'DEFERRED_ALLOWED_HOURS',
    category: 'DEFER',
    ownerMessage: 'Delivery deferred to the next allowed delivery window (10:00 to 19:00).',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'DEFERRED_HOLIDAY',
    category: 'DEFER',
    ownerMessage: 'Scheduled send falls on a configured store holiday; deferred to following business day.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'DEFERRED_BLACKOUT',
    category: 'DEFER',
    ownerMessage: 'Scheduled send falls within an active blackout window; deferred to window close.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'DEFERRED_CONTACT_CAP',
    category: 'DEFER',
    ownerMessage: 'Deferred to next available contact window to respect daily marketing cap.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'DEFERRED_PAUSE_GENERATION_MISMATCH',
    category: 'DEFER',
    ownerMessage: 'Execution pause generation out of sync with campaign gate; deferred to resynchronize.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'WAITING_PREREQUISITE',
    category: 'DEFER',
    ownerMessage: 'Awaiting completion of earlier sequence step before delivering follow-up.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'RETRY_WAIT',
    category: 'DEFER',
    ownerMessage: 'WhatsApp provider rate limit encountered; scheduled for safe exponential retry.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  },

  // --- BLOCK CATEGORY ---
  {
    code: 'BLOCKED_MISSING_VARIABLE_BINDING',
    category: 'BLOCK',
    ownerMessage: 'Template parameter is not bound to a valid customer or boutique property.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'BLOCKED_TEMPLATE_UNUSABLE',
    category: 'BLOCK',
    ownerMessage: 'WhatsApp message template is unapproved, paused by Meta, or missing from catalogue.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'CONTENT_OR_TEMPLATE_BLOCKED',
    category: 'BLOCK',
    ownerMessage: 'Message template resolution failed or template is in paused status.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'BLOCKED_TEMPLATE_PURPOSE_MISMATCH',
    category: 'BLOCK',
    ownerMessage: 'Marketing template cannot be sent under an operational order-service campaign.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'BLOCKED_SHOP_NAME_NOT_CONFIGURED',
    category: 'BLOCK',
    ownerMessage: 'Boutique display name is required for template personalization but not configured.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'BLOCKED_NO_TENANT_CONNECTION',
    category: 'BLOCK',
    ownerMessage: 'No active WhatsApp Cloud API connection is provisioned for this boutique.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },
  {
    code: 'BLOCKED_STALE_INTENT',
    category: 'BLOCK',
    ownerMessage: 'Customer phone or payload changed while frozen delivery was pending.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'BLOCKED_BY_POLICY',
    category: 'BLOCK',
    ownerMessage: 'Delivery blocked by store safety or compliance policy.',
    resolutionOwner: 'BOUTIQUE_OWNER'
  },

  // --- FAIL CATEGORY ---
  {
    code: 'FAILED_DISPATCH_TIMEOUT',
    category: 'FAIL',
    ownerMessage: 'WhatsApp provider network request timed out during delivery dispatch.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  },
  {
    code: 'FAILED_PROVIDER_REJECTED',
    category: 'FAIL',
    ownerMessage: 'WhatsApp Cloud API rejected the message delivery payload.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  },
  {
    code: 'FAILED_DELIVERY_UNDELIVERED',
    category: 'FAIL',
    ownerMessage: 'WhatsApp delivery receipt reported message undelivered to recipient device.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  },
  {
    code: 'FAILED_DELIVERY_FAILED',
    category: 'FAIL',
    ownerMessage: 'Provider reported terminal delivery failure.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  },
  {
    code: 'FAILED_UNKNOWN',
    category: 'FAIL',
    ownerMessage: 'Unexpected delivery error occurred during execution dispatch.',
    resolutionOwner: 'SYSTEM'
  },
  {
    code: 'PROVIDER_DELIVERY_FAILED',
    category: 'FAIL',
    ownerMessage: 'Delivery status webhook reported message delivery failed.',
    resolutionOwner: 'EXTERNAL_PROVIDER'
  }
];

export const REASON_CODE_MAP = new Map<string, ReasonCodeDefinition>(
  CAMPAIGN_REASON_CODES.map((item) => [item.code, item])
);

export function getReasonCodeDefinition(code: string): ReasonCodeDefinition | undefined {
  return REASON_CODE_MAP.get(code);
}
