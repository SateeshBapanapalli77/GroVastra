import { CustomerModel } from '../../crm/models/Customer.model';
import { CampaignDryRunModel, ICampaignDryRun } from '../models/CampaignDryRun.model';
import { ICampaignVersion } from '../models/CampaignVersion.model';
import { getApprovedTemplate } from '../adapters/templateCatalogue';
import { evaluateAudienceWithExplanation } from './audienceEngine';
import {
  resolveNextAnnualOccurrence,
  calculateDueInstant,
  IClock,
  defaultClock,
  LeapDayPolicy
} from '../../../shared/utils/clock';
import { sha256 } from '../../../shared/utils/crypto';
import { generateId } from '../../../shared/utils/id';
import { DateTime } from 'luxon';
import { resolveShopDisplayName } from '../services/shopResolver';

export interface DryRunEvaluationResult {
  dryRunId: string;
  draftFingerprint: string;
  evaluatedAt: Date;
  summary: {
    totalEvaluated: number;
    eligibleCount: number;
    excludedCount: number;
  };
  reasonBreakdown: Record<string, number>;
  samplePlans: Array<{
    customerId: string;
    customerName: string;
    occasionDate: string;
    steps: Array<{
      stepId: string;
      dueAtUtc: Date;
      localTime: string;
      renderedPreview: string;
    }>;
  }>;
}

/**
 * Evaluates a draft campaign version against actual store customers in the database.
 * Does NOT create live executions or message sends.
 * Generates an immutable review fingerprint required for activation.
 */
export async function evaluateCampaignDryRun(
  version: ICampaignVersion,
  clock: IClock = defaultClock
): Promise<DryRunEvaluationResult> {
  const tenantId = version.tenantId;
  const campaignId = version.campaignId;
  const timezone = version.timezone || 'Asia/Kolkata';
  const leapPolicy: LeapDayPolicy = version.trigger.leapDayPolicy || 'FEB_28';
  const isBirthday = (version.trigger.field || 'customer.birthday').includes('birthday');

  // Compute canonical draft fingerprint
  const canonicalConfig = {
    campaignId,
    trigger: version.trigger,
    audience: version.audience,
    steps: version.steps.map((s) => ({
      stepId: s.stepId,
      offsetDays: s.offsetDays,
      localTime: s.localTime,
      templateId: s.templateRef.id,
      templateRevision: s.templateRef.revision,
      bindings: s.bindings,
      stopOnReply: s.stopOnReply,
      stopOnGoal: s.stopOnGoal
    })),
    priority: version.priority,
    timezone
  };
  const draftFingerprint = `fp_${sha256(canonicalConfig).slice(0, 16)}`;

  // Load all customers for this tenant
  const customers = await CustomerModel.find({ tenantId }).lean();

  const reasonBreakdown: Record<string, number> = {
    ELIGIBLE: 0,
    CHANNEL_SUPPRESSED: 0,
    MARKETING_OPTED_OUT: 0,
    NO_OCCASION_DATE: 0,
    OCCASION_OUTSIDE_WINDOW: 0,
    AUDIENCE_RULE_MISMATCH: 0
  };

  const samplePlans: DryRunEvaluationResult['samplePlans'] = [];
  const currentNow = clock.now().setZone(timezone);
  const horizonEnd = currentNow.plus({ days: 30 });
  const storeDisplayName = (await resolveShopDisplayName(tenantId, version)) || '';

  for (const customer of customers) {
    // 1. Channel suppression check
    if (customer.channelSuppressed || customer.status === 'DELETED') {
      reasonBreakdown.CHANNEL_SUPPRESSED = (reasonBreakdown.CHANNEL_SUPPRESSED || 0) + 1;
      continue;
    }

    // 2. Marketing permission check
    if (version.purpose === 'MARKETING' && !customer.optedInMarketing) {
      reasonBreakdown.MARKETING_OPTED_OUT = (reasonBreakdown.MARKETING_OPTED_OUT || 0) + 1;
      continue;
    }

    // 3. Occasion date check
    const month = isBirthday ? customer.birthdayMonth : customer.anniversaryMonth;
    const day = isBirthday ? customer.birthdayDay : customer.anniversaryDay;
    if (!month || !day) {
      reasonBreakdown.NO_OCCASION_DATE = (reasonBreakdown.NO_OCCASION_DATE || 0) + 1;
      continue;
    }

    // 4. Resolve occasion date
    const occurrence = resolveNextAnnualOccurrence(month, day, timezone, leapPolicy, clock);
    const occurrenceDt = DateTime.fromISO(occurrence.localDate, { zone: timezone });

    // Check 30-day window
    if (occurrenceDt > horizonEnd) {
      reasonBreakdown.OCCASION_OUTSIDE_WINDOW = (reasonBreakdown.OCCASION_OUTSIDE_WINDOW || 0) + 1;
      continue;
    }

    // 5. Evaluate full audience rules
    const audEval = evaluateAudienceWithExplanation(customer as any, version.audience as any);
    if (!audEval.matched) {
      reasonBreakdown.AUDIENCE_RULE_MISMATCH = (reasonBreakdown.AUDIENCE_RULE_MISMATCH || 0) + 1;
      continue;
    }

    // Customer is eligible!
    reasonBreakdown.ELIGIBLE = (reasonBreakdown.ELIGIBLE || 0) + 1;

    // Build sample plan preview
    if (samplePlans.length < 5) {
      const stepPreviews = version.steps.map((step) => {
        const timing = calculateDueInstant(occurrence.localDate, step.offsetDays, step.localTime, timezone);
        const template = getApprovedTemplate(step.templateRef.id);
        const rawBindings = step.bindings instanceof Map
          ? Object.fromEntries(step.bindings.entries())
          : (step.bindings || {});

        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawBindings)) {
          if (v === 'customer.firstName') vars[k] = customer.firstName || '';
          else if (v === 'customer.lastName') vars[k] = customer.lastName || '';
          else if (v === 'customer.fullName') vars[k] = `${customer.firstName} ${customer.lastName}`.trim();
          else if (v === 'shop.displayName' || v === 'shop.name' || v === 'shop' || v === 'store') vars[k] = storeDisplayName;
          else if (typeof v === 'string' && v.startsWith('literal:')) vars[k] = v.slice(8);
          else if (typeof v === 'string' && v in customer) vars[k] = String((customer as any)[v] || '');
          else vars[k] = String(v || '');
        }
        if (!vars.name && customer.firstName) vars.name = customer.firstName;
        if (!vars.shop && storeDisplayName) vars.shop = storeDisplayName;

        const rendered = template ? template.render(vars) : 'Template not found';

        return {
          stepId: step.stepId,
          dueAtUtc: timing.dueAtUtc,
          localTime: timing.localTime,
          renderedPreview: rendered
        };
      });

      samplePlans.push({
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        occasionDate: occurrence.localDate,
        steps: stepPreviews
      });
    }
  }

  const eligibleCount = reasonBreakdown.ELIGIBLE || 0;
  const excludedCount = customers.length - eligibleCount;

  // Persist dry run report in MongoDB
  const dryRunId = generateId('dr');
  await CampaignDryRunModel.create({
    id: dryRunId,
    tenantId,
    campaignId,
    draftVersion: version.version,
    draftFingerprint,
    evaluatedAt: new Date(),
    summary: {
      totalEvaluated: customers.length,
      eligibleCount,
      excludedCount
    },
    reasonBreakdown,
    samplePlans
  });

  return {
    dryRunId,
    draftFingerprint,
    evaluatedAt: new Date(),
    summary: {
      totalEvaluated: customers.length,
      eligibleCount,
      excludedCount
    },
    reasonBreakdown,
    samplePlans
  };
}
