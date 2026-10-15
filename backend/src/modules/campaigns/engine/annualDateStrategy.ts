import { DateTime } from 'luxon';
import { CustomerModel, ICustomer } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { matchesAudienceRules } from './audienceEngine';
import { generateId } from '../../../shared/utils/id';
import { isEnrollmentReplayBlocked } from '../services/retentionService';
import {
  resolveNextAnnualOccurrence,
  calculateDueInstant,
  IClock,
  defaultClock,
  LeapDayPolicy
} from '../../../shared/utils/clock';
import { logger } from '../../../config/logger';

export interface PlanOccasionResult {
  plannedEnrollments: number;
  plannedExecutions: number;
  skippedCount: number;
  details: Array<{
    customerId: string;
    customerName: string;
    occurrenceId: string;
    stepExecutions: number;
  }>;
}

/**
 * AnnualDateTriggerStrategy:
 * Finds upcoming customer birthdays/anniversaries within the planning horizon (now through now + 30 days)
 * and upserts durable campaignEnrollments and campaignExecutions.
 */
export async function planAnnualOccasions(
  version: ICampaignVersion,
  clock: IClock = defaultClock
): Promise<PlanOccasionResult> {
  const tenantId = version.tenantId;
  const campaignId = version.campaignId;
  const leapPolicy: LeapDayPolicy = version.trigger.leapDayPolicy || 'FEB_28';
  const timezone = version.timezone || 'Asia/Kolkata';

  const triggerField = version.trigger.field || 'customer.birthday';
  const isBirthday = triggerField.includes('birthday');

  logger.info(
    { tenantId, campaignId, version: version.version, triggerField },
    'Executing annual occasion planner'
  );

  // Load active, opted-in customers for this tenant
  const customers = await CustomerModel.find({
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false,
    optedInMarketing: true
  }).lean();

  let plannedEnrollments = 0;
  let plannedExecutions = 0;
  let skippedCount = 0;
  const details: PlanOccasionResult['details'] = [];

  const currentNow = clock.now().setZone(timezone);
  const horizonEnd = currentNow.plus({ days: 30 });

  for (const customer of customers) {
    const month = isBirthday ? customer.birthdayMonth : customer.anniversaryMonth;
    const day = isBirthday ? customer.birthdayDay : customer.anniversaryDay;

    if (!month || !day) {
      skippedCount++;
      continue;
    }

    // Resolve next annual occurrence
    const occurrence = resolveNextAnnualOccurrence(month, day, timezone, leapPolicy, clock);
    const occurrenceDt = DateTime.fromISO(occurrence.localDate, { zone: timezone });

    // Check if occurrence falls within discovery horizon (now through now + 30 days)
    if (occurrenceDt > horizonEnd) {
      skippedCount++;
      continue;
    }

    // Evaluate Audience Rules (Handoff Page 15)
    if (!matchesAudienceRules(customer as any, version.audience as any)) {
      skippedCount++;
      continue;
    }

    const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
    const occurrencePrefix = isBirthday ? 'birthday' : 'anniversary';
    const occurrenceId = `${occurrencePrefix}:${occurrence.occurrenceId}`;
    const enrollmentKey = `${tenantId}:${campaignId}:${customer.id}:${occurrenceId}`;

    // Retention check (Spec p.25 & test B18): tombstone check prevents historical replay
    if (await isEnrollmentReplayBlocked(tenantId, enrollmentKey)) {
      skippedCount++;
      continue;
    }

    // Upsert CampaignEnrollment (Idempotent: tenantId + campaignId + customerId + occurrenceId)
    let enrollment = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId,
      customerId: customer.id,
      occurrenceId
    });

    let isNewEnrollment = false;
    if (!enrollment) {
      try {
        enrollment = await CampaignEnrollmentModel.create({
          id: generateId('enr'),
          tenantId,
          campaignId,
          campaignVersionId: version.id,
          customerId: customer.id,
          occurrenceId,
          sourceRef: {
            type: 'CUSTOMER_DATE',
            id: customer.id,
            version: 1
          },
          occasionLocalDate: occurrence.localDate,
          planRevision: 1,
          status: 'ACTIVE',
          replyHoldAt: null,
          goalReachedAt: null
        });
        isNewEnrollment = true;
        plannedEnrollments++;
      } catch (err: any) {
        if (err?.code !== 11000) throw err; // another planner won the race: reuse its enrollment
        enrollment = await CampaignEnrollmentModel.findOne({
          tenantId,
          campaignId,
          customerId: customer.id,
          occurrenceId
        });
        if (!enrollment) throw err;
      }
    }

    // Version Pinning: Existing active enrollments stay pinned to their original campaignVersionId
    let effectiveVersion = version;
    if (!isNewEnrollment && enrollment.campaignVersionId !== version.id) {
      const pinned = await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId });
      if (pinned) effectiveVersion = pinned;
    }

    // Upsert CampaignExecutions for each step in this campaign version
    let stepsPlannedForCustomer = 0;
    for (const step of effectiveVersion.steps) {
      const existingExecution = await CampaignExecutionModel.findOne({
        tenantId,
        enrollmentId: enrollment.id,
        stepId: step.stepId
      });

      if (!existingExecution) {
        const timing = calculateDueInstant(
          occurrence.localDate,
          step.offsetDays,
          step.localTime,
          timezone
        );

        // Calculate expiresAt: dueAt + maxLatenessMinutes
        const expiresAt = new Date(timing.dueAtUtc.getTime() + step.maxLatenessMinutes * 60 * 1000);

        try {
          await CampaignExecutionModel.create({
            id: generateId('exe'),
            tenantId,
            enrollmentId: enrollment.id,
            campaignId,
            stepId: step.stepId,
            dueAt: timing.dueAtUtc,
            expiresAt,
            localDate: timing.localDate,
            localTime: timing.localTime,
            timezone,
            planRevision: 1,
            pauseGeneration: campaign?.pauseGeneration ?? 0,
            state: 'SCHEDULED',
            prerequisite: step.prerequisite,
            deliveryIntentId: null,
            lease: { token: null, until: null, claimedBy: null }
          });
          plannedExecutions++;
          stepsPlannedForCustomer++;
        } catch (err: any) {
          if (err?.code !== 11000) throw err; // stable step already planned by a concurrent planner
        }
      }
    }

    if (isNewEnrollment || stepsPlannedForCustomer > 0) {
      details.push({
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        occurrenceId,
        stepExecutions: stepsPlannedForCustomer
      });
    }
  }

  logger.info(
    { plannedEnrollments, plannedExecutions, skippedCount },
    'Completed annual occasion planner pass'
  );

  return {
    plannedEnrollments,
    plannedExecutions,
    skippedCount,
    details
  };
}
