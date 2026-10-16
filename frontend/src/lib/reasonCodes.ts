/**
 * Central Reason Code Dictionary for GroVastra Auto Campaigns (Phase 0, Non-negotiable 8)
 * Maps backend reason codes to owner-friendly sentences, categories, and fix owners.
 * Unknown codes fall back to a humanized string without crashing.
 */

export type ReasonCategory = 'skipped' | 'deferred' | 'blocked' | 'expired' | 'failed';
export type FixOwner = 'owner' | 'integration' | 'none';

export interface ReasonDefinition {
  code: string;
  sentence: string;
  category: ReasonCategory;
  fixOwner: FixOwner;
}

export const REASON_DICTIONARY: Record<string, ReasonDefinition> = {
  // --- DRY RUN & EVALUATION CODES ---
  ELIGIBLE: {
    code: 'ELIGIBLE',
    sentence: 'Patron qualifies for occasion timing and audience eligibility criteria.',
    category: 'deferred',
    fixOwner: 'none'
  },
  CHANNEL_SUPPRESSED: {
    code: 'CHANNEL_SUPPRESSED',
    sentence: 'Patron WhatsApp delivery channel is suppressed or inactive.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  MARKETING_OPTED_OUT: {
    code: 'MARKETING_OPTED_OUT',
    sentence: 'Patron has opted out of marketing communications.',
    category: 'skipped',
    fixOwner: 'none'
  },
  NO_OCCASION_DATE: {
    code: 'NO_OCCASION_DATE',
    sentence: 'No occasion date (birthday or anniversary) recorded on patron profile.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  OCCASION_OUTSIDE_WINDOW: {
    code: 'OCCASION_OUTSIDE_WINDOW',
    sentence: 'Next occasion date falls outside the upcoming 30-day scheduling horizon.',
    category: 'skipped',
    fixOwner: 'none'
  },
  AUDIENCE_RULE_MISMATCH: {
    code: 'AUDIENCE_RULE_MISMATCH',
    sentence: 'Patron does not match custom audience targeting conditions.',
    category: 'skipped',
    fixOwner: 'owner'
  },

  // --- SKIPPED CATEGORY ---
  SKIPPED_MARKETING_OPT_OUT: {
    code: 'SKIPPED_MARKETING_OPT_OUT',
    sentence: 'Patron has opted out of marketing communications.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_CHANNEL_SUPPRESSED: {
    code: 'SKIPPED_CHANNEL_SUPPRESSED',
    sentence: 'Patron WhatsApp delivery channel is suppressed or inactive.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_CUSTOMER_DELETED: {
    code: 'SKIPPED_CUSTOMER_DELETED',
    sentence: 'Customer profile was removed or deleted from store records.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_GOAL_REACHED: {
    code: 'SKIPPED_GOAL_REACHED',
    sentence: 'Qualifying occasion purchase or goal was completed, halting further messages.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_REPLY_HOLD: {
    code: 'SKIPPED_REPLY_HOLD',
    sentence: 'Patron replied to previous message; automation held for personal boutique staff conversation.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_STEP_EXPIRED: {
    code: 'SKIPPED_STEP_EXPIRED',
    sentence: 'Campaign step passed its useful expiry deadline.',
    category: 'expired',
    fixOwner: 'none'
  },
  SKIPPED_PREREQUISITE_NOT_MET: {
    code: 'SKIPPED_PREREQUISITE_NOT_MET',
    sentence: 'Prerequisite prior message was not delivered or accepted.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_MISSING_VARIABLE: {
    code: 'SKIPPED_MISSING_VARIABLE',
    sentence: 'Required patron variable (e.g. name or occasion date) was missing at evaluation.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_CUSTOMER_DATE_REMOVED: {
    code: 'SKIPPED_CUSTOMER_DATE_REMOVED',
    sentence: 'Occasion date was removed from customer profile after initial enrollment.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_ALREADY_ACCEPTED: {
    code: 'SKIPPED_ALREADY_ACCEPTED',
    sentence: 'Message was already delivered or accepted under an earlier occasion plan.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_ELAPSED: {
    code: 'SKIPPED_ELAPSED',
    sentence: 'Step date already elapsed prior to campaign activation (future-only policy).',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_BLACKOUT_EXPIRED: {
    code: 'SKIPPED_BLACKOUT_EXPIRED',
    sentence: 'Send fell into a blackout window and expired before the window closed.',
    category: 'expired',
    fixOwner: 'owner'
  },
  SKIPPED_CONTACT_CAP: {
    code: 'SKIPPED_CONTACT_CAP',
    sentence: 'Patron reached daily or weekly marketing contact limit and message cannot be deferred.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_STOCK_DEPLETED: {
    code: 'SKIPPED_STOCK_DEPLETED',
    sentence: 'Target handloom merchandise is out of stock or marked unsellable at send time.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_CAMPAIGN_ARCHIVED: {
    code: 'SKIPPED_CAMPAIGN_ARCHIVED',
    sentence: 'Campaign was archived; pending dispatches were cancelled.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_CAMPAIGN_NOT_FOUND: {
    code: 'SKIPPED_CAMPAIGN_NOT_FOUND',
    sentence: 'Campaign definition could not be resolved.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_ENROLLMENT_INACTIVE: {
    code: 'SKIPPED_ENROLLMENT_INACTIVE',
    sentence: 'Customer campaign enrollment is no longer active.',
    category: 'skipped',
    fixOwner: 'none'
  },
  SKIPPED_VERSION_NOT_FOUND: {
    code: 'SKIPPED_VERSION_NOT_FOUND',
    sentence: 'Published campaign version definition was not found.',
    category: 'skipped',
    fixOwner: 'integration'
  },
  SKIPPED_STEP_NOT_FOUND: {
    code: 'SKIPPED_STEP_NOT_FOUND',
    sentence: 'Step definition was not found in campaign sequence.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  SKIPPED_CAMPAIGN_PAUSED: {
    code: 'SKIPPED_CAMPAIGN_PAUSED',
    sentence: 'Execution skipped because campaign is paused.',
    category: 'skipped',
    fixOwner: 'owner'
  },
  CAMPAIGN_OR_GLOBAL_PAUSED: {
    code: 'CAMPAIGN_OR_GLOBAL_PAUSED',
    sentence: 'Store messaging is globally paused across all automated campaigns.',
    category: 'skipped',
    fixOwner: 'owner'
  },

  // --- DEFERRED CATEGORY ---
  DEFERRED_GLOBAL_PAUSED: {
    code: 'DEFERRED_GLOBAL_PAUSED',
    sentence: 'Message deferred while store-wide messaging is globally paused.',
    category: 'deferred',
    fixOwner: 'owner'
  },
  DEFERRED_CAMPAIGN_PAUSED: {
    code: 'DEFERRED_CAMPAIGN_PAUSED',
    sentence: 'Message deferred while campaign is paused.',
    category: 'deferred',
    fixOwner: 'owner'
  },
  DEFERRED_OUTSIDE_ALLOWED_HOURS: {
    code: 'DEFERRED_OUTSIDE_ALLOWED_HOURS',
    sentence: 'Delivery deferred to the next allowed delivery window (10:00 to 19:00).',
    category: 'deferred',
    fixOwner: 'none'
  },
  DEFERRED_ALLOWED_HOURS: {
    code: 'DEFERRED_ALLOWED_HOURS',
    sentence: 'Delivery deferred to the next allowed delivery window (10:00 to 19:00).',
    category: 'deferred',
    fixOwner: 'none'
  },
  DEFERRED_HOLIDAY: {
    code: 'DEFERRED_HOLIDAY',
    sentence: 'Scheduled send falls on a configured store holiday; deferred to following business day.',
    category: 'deferred',
    fixOwner: 'owner'
  },
  DEFERRED_BLACKOUT: {
    code: 'DEFERRED_BLACKOUT',
    sentence: 'Scheduled send falls within an active blackout window; deferred to window close.',
    category: 'deferred',
    fixOwner: 'owner'
  },
  DEFERRED_CONTACT_CAP: {
    code: 'DEFERRED_CONTACT_CAP',
    sentence: 'Deferred to next available contact window to respect daily marketing cap.',
    category: 'deferred',
    fixOwner: 'none'
  },
  DEFERRED_PAUSE_GENERATION_MISMATCH: {
    code: 'DEFERRED_PAUSE_GENERATION_MISMATCH',
    sentence: 'Execution pause generation out of sync with campaign gate; deferred to resynchronize.',
    category: 'deferred',
    fixOwner: 'none'
  },
  WAITING_PREREQUISITE: {
    code: 'WAITING_PREREQUISITE',
    sentence: 'Awaiting completion of earlier sequence step before delivering follow-up.',
    category: 'deferred',
    fixOwner: 'none'
  },
  RETRY_WAIT: {
    code: 'RETRY_WAIT',
    sentence: 'WhatsApp provider rate limit encountered; scheduled for safe exponential retry.',
    category: 'deferred',
    fixOwner: 'integration'
  },

  // --- BLOCKED CATEGORY ---
  BLOCKED_MISSING_VARIABLE_BINDING: {
    code: 'BLOCKED_MISSING_VARIABLE_BINDING',
    sentence: 'Template parameter is not bound to a valid customer or boutique property.',
    category: 'blocked',
    fixOwner: 'owner'
  },
  BLOCKED_TEMPLATE_UNUSABLE: {
    code: 'BLOCKED_TEMPLATE_UNUSABLE',
    sentence: 'WhatsApp message template is unapproved, paused by Meta, or missing from catalogue.',
    category: 'blocked',
    fixOwner: 'integration'
  },
  CONTENT_OR_TEMPLATE_BLOCKED: {
    code: 'CONTENT_OR_TEMPLATE_BLOCKED',
    sentence: 'Message template resolution failed or template is in paused status.',
    category: 'blocked',
    fixOwner: 'integration'
  },
  BLOCKED_TEMPLATE_PURPOSE_MISMATCH: {
    code: 'BLOCKED_TEMPLATE_PURPOSE_MISMATCH',
    sentence: 'Marketing template cannot be sent under an operational order-service campaign.',
    category: 'blocked',
    fixOwner: 'owner'
  },
  BLOCKED_SHOP_NAME_NOT_CONFIGURED: {
    code: 'BLOCKED_SHOP_NAME_NOT_CONFIGURED',
    sentence: 'Boutique display name is required for template personalization but not configured.',
    category: 'blocked',
    fixOwner: 'owner'
  },
  BLOCKED_NO_TENANT_CONNECTION: {
    code: 'BLOCKED_NO_TENANT_CONNECTION',
    sentence: 'No active WhatsApp Cloud API connection is provisioned for this boutique.',
    category: 'blocked',
    fixOwner: 'integration'
  },
  BLOCKED_STALE_INTENT: {
    code: 'BLOCKED_STALE_INTENT',
    sentence: 'Customer phone or payload changed while frozen delivery was pending.',
    category: 'blocked',
    fixOwner: 'none'
  },
  BLOCKED_BY_POLICY: {
    code: 'BLOCKED_BY_POLICY',
    sentence: 'Delivery blocked by store safety or compliance policy.',
    category: 'blocked',
    fixOwner: 'owner'
  },

  // --- FAILED CATEGORY ---
  FAILED_DISPATCH_TIMEOUT: {
    code: 'FAILED_DISPATCH_TIMEOUT',
    sentence: 'WhatsApp provider network request timed out during delivery dispatch.',
    category: 'failed',
    fixOwner: 'integration'
  },
  FAILED_PROVIDER_REJECTED: {
    code: 'FAILED_PROVIDER_REJECTED',
    sentence: 'WhatsApp Cloud API rejected the message delivery payload.',
    category: 'failed',
    fixOwner: 'integration'
  },
  FAILED_DELIVERY_UNDELIVERED: {
    code: 'FAILED_DELIVERY_UNDELIVERED',
    sentence: 'WhatsApp delivery receipt reported message undelivered to recipient device.',
    category: 'failed',
    fixOwner: 'integration'
  },
  FAILED_DELIVERY_FAILED: {
    code: 'FAILED_DELIVERY_FAILED',
    sentence: 'WhatsApp Cloud API reported terminal delivery failure.',
    category: 'failed',
    fixOwner: 'integration'
  },
  FAILED_UNKNOWN: {
    code: 'FAILED_UNKNOWN',
    sentence: 'Unexpected delivery error occurred during execution dispatch.',
    category: 'failed',
    fixOwner: 'integration'
  },
  PROVIDER_DELIVERY_FAILED: {
    code: 'PROVIDER_DELIVERY_FAILED',
    sentence: 'Delivery status webhook reported message delivery failed.',
    category: 'failed',
    fixOwner: 'integration'
  }
};

/**
 * Derives category from reason code prefix if not explicitly present in dictionary.
 */
function inferCategory(code: string): ReasonCategory {
  const upper = code.toUpperCase();
  if (upper.includes('EXPIRE')) return 'expired';
  if (upper.startsWith('SKIPPED') || upper.includes('SKIP')) return 'skipped';
  if (upper.startsWith('DEFERRED') || upper.includes('DEFER') || upper.startsWith('WAIT')) return 'deferred';
  if (upper.startsWith('BLOCKED') || upper.includes('BLOCK')) return 'blocked';
  if (upper.startsWith('FAILED') || upper.includes('FAIL')) return 'failed';
  return 'skipped';
}

/**
 * Formats an unknown code into a readable humanized sentence.
 */
function humanizeCode(code: string): string {
  const clean = code.replace(/^(SKIPPED_|DEFERRED_|BLOCKED_|FAILED_)/i, '').replace(/_/g, ' ').toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1) + '.';
}

/**
 * Resolves any reason code safely without throwing.
 */
export function resolveReasonCode(code?: string | null): ReasonDefinition {
  if (!code) {
    return {
      code: 'UNKNOWN',
      sentence: 'Pending evaluation.',
      category: 'deferred',
      fixOwner: 'none'
    };
  }

  const existing = REASON_DICTIONARY[code];
  if (existing) {
    return existing;
  }

  const category = inferCategory(code);
  return {
    code,
    sentence: humanizeCode(code),
    category,
    fixOwner: category === 'blocked' ? 'owner' : 'none'
  };
}
