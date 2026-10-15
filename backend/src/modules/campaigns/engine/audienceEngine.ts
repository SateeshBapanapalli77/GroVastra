import { ICustomer } from '../../crm/models/Customer.model';

export type RuleOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'not_contains';

export interface RulePredicate {
  field: string;
  op: RuleOperator;
  value: any;
}

export interface AudienceConfig {
  mode: 'ALL_ELIGIBLE' | 'RULE_BASED';
  requiredTags?: string[];
  excludedTags?: string[];
  minSpendPaise?: number;
  rules?: {
    all?: RulePredicate[];
    any?: RulePredicate[];
    none?: RulePredicate[];
  };
}

export const ALLOWLISTED_FIELDS = new Set([
  'customer.status',
  'status',
  'tags',
  'customer.tags',
  'totalSpendPaise',
  'customer.totalSpendPaise',
  'preferences.weave',
  'customer.preferences.weave',
  'preferences.budgetMaxPaise',
  'customer.preferences.budgetMaxPaise',
  'preferences.preferredLanguage',
  'customer.preferences.preferredLanguage',
  'channelSuppressed',
  'optedInMarketing',
  'serviceIssueOpen',
  'city',
  'customer.city'
]);

export const ALLOWLISTED_OPERATORS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'not_contains'
]);

/**
 * Validates audience configuration, rejecting unsupported fields or operators (Spec p.10)
 */
export function validateAudienceConfig(audience?: any): { valid: boolean; errors: string[] } {
  if (!audience) return { valid: true, errors: [] };
  const errors: string[] = [];

  const mode = audience.mode || 'RULE_BASED';
  if (mode !== 'ALL_ELIGIBLE' && mode !== 'RULE_BASED') {
    errors.push(`Invalid audience mode: ${mode}`);
  }

  const checkPredicate = (p: any, section: string, idx: number) => {
    if (!p || typeof p !== 'object') {
      errors.push(`Invalid predicate at ${section}[${idx}]`);
      return;
    }
    if (!ALLOWLISTED_FIELDS.has(p.field)) {
      errors.push(`Unsupported audience field: "${p.field}" at ${section}[${idx}]`);
    }
    if (!ALLOWLISTED_OPERATORS.has(p.op)) {
      errors.push(`Unsupported audience operator: "${p.op}" at ${section}[${idx}]`);
    }
  };

  if (audience.rules) {
    if (Array.isArray(audience.rules.all)) {
      audience.rules.all.forEach((p: any, i: number) => checkPredicate(p, 'rules.all', i));
    }
    if (Array.isArray(audience.rules.any)) {
      audience.rules.any.forEach((p: any, i: number) => checkPredicate(p, 'rules.any', i));
    }
    if (Array.isArray(audience.rules.none)) {
      audience.rules.none.forEach((p: any, i: number) => checkPredicate(p, 'rules.none', i));
    }
  }

  // Spec p.10: An entirely empty audience is invalid unless the owner explicitly selects ALL_ELIGIBLE
  const hasPredicates =
    (audience.rules?.all?.length || 0) > 0 ||
    (audience.rules?.any?.length || 0) > 0 ||
    (audience.rules?.none?.length || 0) > 0 ||
    (audience.requiredTags?.length || 0) > 0 ||
    (audience.excludedTags?.length || 0) > 0 ||
    typeof audience.minSpendPaise === 'number';

  if (!hasPredicates && mode !== 'ALL_ELIGIBLE') {
    errors.push('Empty audience configuration requires explicit mode ALL_ELIGIBLE');
  }

  return { valid: errors.length === 0, errors };
}

function resolveCustomerField(customer: ICustomer, field: string): any {
  const normalizedField = field.startsWith('customer.') ? field.slice(9) : field;
  if (normalizedField === 'totalSpendPaise') {
    // Spec p.10: totalSpendPaise is strictly actual spend; NO budgetMaxPaise fallback!
    return (customer as any).totalSpendPaise;
  }
  const parts = normalizedField.split('.');
  let current: any = customer;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function evaluatePredicate(customer: ICustomer, predicate: RulePredicate): boolean {
  const actualValue = resolveCustomerField(customer, predicate.field);
  const targetValue = predicate.value;

  // Spec p.10: Missing fields FAIL ordinary comparisons
  if (actualValue === undefined || actualValue === null) {
    if (predicate.op === 'neq') return true;
    return false;
  }

  switch (predicate.op) {
    case 'eq':
      return actualValue === targetValue;
    case 'neq':
      return actualValue !== targetValue;
    case 'gt':
      return typeof actualValue === 'number' && actualValue > targetValue;
    case 'gte':
      return typeof actualValue === 'number' && actualValue >= targetValue;
    case 'lt':
      return typeof actualValue === 'number' && actualValue < targetValue;
    case 'lte':
      return typeof actualValue === 'number' && actualValue <= targetValue;
    case 'in':
      if (Array.isArray(targetValue)) {
        if (Array.isArray(actualValue)) {
          return actualValue.some((v) => targetValue.includes(v));
        }
        return targetValue.includes(actualValue);
      }
      return false;
    case 'nin':
      if (Array.isArray(targetValue)) {
        if (Array.isArray(actualValue)) {
          return !actualValue.some((v) => targetValue.includes(v));
        }
        return !targetValue.includes(actualValue);
      }
      return true;
    case 'contains':
      if (Array.isArray(actualValue)) {
        return Array.isArray(targetValue)
          ? targetValue.every((t) => actualValue.includes(t))
          : actualValue.includes(targetValue);
      }
      if (typeof actualValue === 'string') {
        return actualValue.includes(String(targetValue));
      }
      return false;
    case 'not_contains':
      if (Array.isArray(actualValue)) {
        return Array.isArray(targetValue)
          ? !targetValue.some((t) => actualValue.includes(t))
          : !actualValue.includes(targetValue);
      }
      if (typeof actualValue === 'string') {
        return !actualValue.includes(String(targetValue));
      }
      return true;
    default:
      return false;
  }
}

/**
 * Evaluates whether a customer satisfies the audience rules and returns a concise match explanation (Spec p.10)
 */
export function evaluateAudienceWithExplanation(
  customer: ICustomer,
  audience?: AudienceConfig | null
): { matched: boolean; explanation: string } {
  if (!audience) return { matched: true, explanation: 'All eligible' };

  if (audience.mode === 'ALL_ELIGIBLE') {
    return { matched: true, explanation: 'All eligible' };
  }

  const explanations: string[] = [];

  // 1. Required Tags
  if (Array.isArray(audience.requiredTags) && audience.requiredTags.length > 0) {
    const hasAll = audience.requiredTags.every((t) => (customer.tags || []).includes(t));
    if (!hasAll) return { matched: false, explanation: 'Missing required tags' };
    explanations.push(`Tags: ${audience.requiredTags.join(', ')}`);
  }

  // 2. Excluded Tags
  if (Array.isArray(audience.excludedTags) && audience.excludedTags.length > 0) {
    const hasExcluded = audience.excludedTags.some((t) => (customer.tags || []).includes(t));
    if (hasExcluded) return { matched: false, explanation: 'Contains excluded tag' };
  }

  // 3. Min Spend check (actual spend only, no fallback)
  if (typeof audience.minSpendPaise === 'number' && audience.minSpendPaise > 0) {
    const actualSpend = (customer as any).totalSpendPaise;
    if (actualSpend === undefined || actualSpend === null || actualSpend < audience.minSpendPaise) {
      return { matched: false, explanation: 'Spend below minimum threshold' };
    }
    explanations.push(`Min spend ₹${audience.minSpendPaise / 100} met`);
  }

  // 4. Full rules language: all, any, none (Spec p.10)
  if (audience.rules) {
    // all: every predicate must pass
    if (Array.isArray(audience.rules.all) && audience.rules.all.length > 0) {
      for (const pred of audience.rules.all) {
        if (!evaluatePredicate(customer, pred)) {
          return { matched: false, explanation: `Failed rule: ${pred.field} ${pred.op} ${JSON.stringify(pred.value)}` };
        }
        explanations.push(`${pred.field}: matched`);
      }
    }

    // any: at least one predicate must pass
    if (Array.isArray(audience.rules.any) && audience.rules.any.length > 0) {
      const anyPassed = audience.rules.any.some((pred) => evaluatePredicate(customer, pred));
      if (!anyPassed) {
        return { matched: false, explanation: 'No conditions in "any" rule group met' };
      }
      explanations.push('Any-rule satisfied');
    }

    // none: all predicates must fail
    if (Array.isArray(audience.rules.none) && audience.rules.none.length > 0) {
      const anyViolated = audience.rules.none.some((pred) => evaluatePredicate(customer, pred));
      if (anyViolated) {
        return { matched: false, explanation: 'Excluded by "none" rule group' };
      }
    }
  }

  return {
    matched: true,
    explanation: explanations.length > 0 ? explanations.join('; ') : 'Audience matched'
  };
}

/**
 * Convenience boolean evaluator
 */
export function matchesAudienceRules(customer: ICustomer, audience?: AudienceConfig | null): boolean {
  return evaluateAudienceWithExplanation(customer, audience).matched;
}
