import { ICustomer } from '../../crm/models/Customer.model';

export interface AudienceConfig {
  mode: 'ALL_ELIGIBLE' | 'RULE_BASED';
  requiredTags?: string[];
  excludedTags?: string[];
  minSpendPaise?: number;
  rules?: {
    all?: Array<{ field: string; op: string; value: any }>;
    any?: Array<{ field: string; op: string; value: any }>;
    none?: Array<{ field: string; op: string; value: any }>;
  };
}

/**
 * Evaluates whether a customer satisfies the campaign version's audience filter rules
 */
export function matchesAudienceRules(customer: ICustomer, audience?: AudienceConfig | null): boolean {
  if (!audience) return true;
  if (audience.mode === 'ALL_ELIGIBLE' && !audience.requiredTags?.length && !audience.excludedTags?.length && !audience.minSpendPaise) {
    return true;
  }

  // Required Tags check
  if (Array.isArray(audience.requiredTags) && audience.requiredTags.length > 0) {
    const hasAll = audience.requiredTags.every((t) => (customer.tags || []).includes(t));
    if (!hasAll) return false;
  }

  // Excluded Tags check
  if (Array.isArray(audience.excludedTags) && audience.excludedTags.length > 0) {
    const hasExcluded = audience.excludedTags.some((t) => (customer.tags || []).includes(t));
    if (hasExcluded) return false;
  }

  // Min Spend check
  if (typeof audience.minSpendPaise === 'number' && audience.minSpendPaise > 0) {
    const spend = customer.preferences?.budgetMaxPaise || (customer as any).totalSpendPaise || 0;
    if (spend < audience.minSpendPaise) return false;
  }

  // Complex rule predicates
  if (audience.mode === 'RULE_BASED' && audience.rules) {
    const allRules = audience.rules.all || [];
    for (const rule of allRules) {
      if (rule.field === 'preferences.weave' && (rule.op === 'in' || rule.op === 'contains')) {
        const hasWeave = (customer.preferences?.weave || []).some((w) =>
          Array.isArray(rule.value) ? rule.value.includes(w) : w === rule.value
        );
        if (!hasWeave) return false;
      }
      if (rule.field === 'tags' && (rule.op === 'contains' || rule.op === 'in')) {
        const hasTag = (customer.tags || []).some((t) =>
          Array.isArray(rule.value) ? rule.value.includes(t) : t === rule.value
        );
        if (!hasTag) return false;
      }
    }
  }

  return true;
}
