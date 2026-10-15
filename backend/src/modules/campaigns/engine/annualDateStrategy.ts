import { DateTime } from 'luxon';
import { CustomerModel, ICustomer } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { evaluateAudienceWithExplanation } from './audienceEngine';
import { generateId } from '../../../shared/utils/id';
import { isEnrollmentReplayBlocked } from '../services/retentionService';
import {
  resolveNextAnnualOccurrence,
  calculateDueInstant,
  adjustForAllowedHoursAndBlackouts,
  IClock,
  defaultClock,
  SettableTestClock,
  LeapDayPolicy
} from '../../../shared/utils/clock';
import { logger } from '../../../config/logger';

export interface PlanOccasionResult {
  plannedEnrollments: number;
  createdEnrollments?: number;
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
 * Finds upcoming customer birthdays, anniversaries, and wedding events within the discovery window (Spec p.17, B19):
 * From (today minus largest positive step offset) to (today plus largest lead plus 30 days)
 * so D+offset steps for recently passed occasions are discovered.
 * Elapsed steps are recorded as SKIPPED under FUTURE_ONLY.
 */
export async function planAnnualOccasions(
  versionOrCampaignId: ICampaignVersion | string,
  clockOrTenantId: IClock | string = defaultClock,
  dateOrClock?: Date | IClock
): Promise<PlanOccasionResult> {
  let version: ICampaignVersion | null = null;
  let clock: IClock = defaultClock;

  if (typeof versionOrCampaignId === 'string') {
    const campaignId = versionOrCampaignId;
    const tenantId = typeof clockOrTenantId === 'string' ? clockOrTenantId : '';
    const camp = await CampaignModel.findOne({ id: campaignId, tenantId });
    if (camp && camp.activeVersionId) {
      version = await CampaignVersionModel.findOne({ id: camp.activeVersionId, tenantId });
    }
    if (dateOrClock) {
      if (dateOrClock instanceof Date) {
        clock = new SettableTestClock(dateOrClock.toISOString());
      } else {
        clock = dateOrClock;
      }
    }
  } else {
    version = versionOrCampaignId;
    if (clockOrTenantId && typeof clockOrTenantId !== 'string') {
      clock = clockOrTenantId;
    }
  }

  if (!version) {
    return {
      plannedEnrollments: 0,
      createdEnrollments: 0,
      plannedExecutions: 0,
      skippedCount: 0,
      details: []
    };
  }

  const tenantId = version.tenantId;
  const campaignId = version.campaignId;
  const leapPolicy: LeapDayPolicy = version.trigger?.leapDayPolicy || 'FEB_28';
  const timezone = version.timezone || 'Asia/Kolkata';

  const triggerField = version.trigger?.field || 'customer.birthday';
  const isBirthday = triggerField.includes('birthday');
  const isAnniversary = triggerField.includes('anniversary');
  const isWedding = triggerField.includes('wedding');

  logger.info(
    { tenantId, campaignId, version: version.version, triggerField },
    'Executing occasion planner'
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

  // Discovery window calculation (Spec p.17, test B19)
  const offsets = (version.steps || []).map((s) => s.offsetDays || 0);
  const maxPositiveOffset = Math.max(0, ...offsets.filter((d) => d > 0));
  const maxLeadDays = Math.max(0, ...offsets.filter((d) => d < 0).map((d) => Math.abs(d)));

  const horizonStart = currentNow.minus({ days: maxPositiveOffset }).startOf('day');
  const horizonEnd = currentNow.plus({ days: maxLeadDays + 30 }).endOf('day');

  for (const customer of customers) {
    // Evaluate Audience Rules (Handoff Page 10 & 15, P2.a)
    const audienceEval = evaluateAudienceWithExplanation(customer as any, version.audience as any);
    if (!audienceEval.matched) {
      skippedCount++;
      continue;
    }

    const occasionsToPlan: Array<{
      occurrenceId: string;
      localDate: string;
      latestUsefulAt?: Date;
      leadTimeDays?: number;
      isOneTimeWedding?: boolean;
    }> = [];

    // Check if customer has explicit savedOccasions (Spec p.12, A09, A10)
    const savedOccasions = (customer as any).savedOccasions || [];

    if (isWedding) {
      const weddingEvents = savedOccasions.filter((o: any) => o.type === 'WEDDING');
      for (const wed of weddingEvents) {
        if (!wed.active) continue;
        const leadDays = wed.leadTimeDays || 14;
        const wedDt = DateTime.fromISO(wed.date, { zone: timezone });
        const latestUsefulAt = wedDt.minus({ days: leadDays }).toJSDate();

        // Insufficient lead time skip (Spec p.12, A10)
        if (currentNow.toJSDate() > latestUsefulAt) {
          skippedCount++;
          continue;
        }

        occasionsToPlan.push({
          occurrenceId: `wedding:${wed.eventId}`,
          localDate: wed.date,
          latestUsefulAt,
          leadTimeDays: leadDays,
          isOneTimeWedding: true
        });
      }
    } else if (isAnniversary && savedOccasions.some((o: any) => o.type === 'ANNIVERSARY')) {
      const annivEvents = savedOccasions.filter((o: any) => o.type === 'ANNIVERSARY');
      for (const ann of annivEvents) {
        // Spec A09: If anniversary record removed or inactive, cancel all pending steps
        if (!ann.active) {
          const cancelledEnr = await CampaignEnrollmentModel.find({
            tenantId,
            campaignId,
            customerId: customer.id,
            occurrenceId: new RegExp(`^anniversary:${ann.eventId}:`)
          });
          for (const enr of cancelledEnr) {
            enr.status = 'CANCELLED';
            await enr.save();
            await CampaignExecutionModel.updateMany(
              { tenantId, enrollmentId: enr.id, state: { $in: ['SCHEDULED', 'DEFERRED'] } },
              { $set: { state: 'SKIPPED', outcomeReason: 'SKIPPED_CUSTOMER_DATE_REMOVED' } }
            );
          }
          continue;
        }

        const dateParts = ann.date.split('-');
        const month = parseInt(dateParts[1], 10);
        const day = parseInt(dateParts[2], 10);
        const occurrence = resolveNextAnnualOccurrence(month, day, timezone, leapPolicy, clock, maxPositiveOffset);
        occasionsToPlan.push({
          occurrenceId: `anniversary:${ann.eventId}:${occurrence.occurrenceId}`,
          localDate: occurrence.localDate
        });
      }
    } else {
      // Standard annual date resolution (Birthday or legacy Anniversary)
      const month = isBirthday ? customer.birthdayMonth : customer.anniversaryMonth;
      const day = isBirthday ? customer.birthdayDay : customer.anniversaryDay;

      if (!month || !day) {
        skippedCount++;
        continue;
      }

      const occurrence = resolveNextAnnualOccurrence(month, day, timezone, leapPolicy, clock, maxPositiveOffset);
      const occurrencePrefix = isBirthday ? 'birthday' : 'anniversary';
      occasionsToPlan.push({
        occurrenceId: `${occurrencePrefix}:${occurrence.occurrenceId}`,
        localDate: occurrence.localDate
      });
    }

    const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
    const correctionGroupId = `${tenantId}:${campaignId}:${customer.id}:${triggerField}`;

    for (const occasion of occasionsToPlan) {
      const occurrenceId = occasion.occurrenceId;
      const occurrenceDt = DateTime.fromISO(occasion.localDate, { zone: timezone });

      // Load existing enrollment if present
      let enrollment = await CampaignEnrollmentModel.findOne({
        tenantId,
        campaignId,
        customerId: customer.id,
        occurrenceId
      });

      // Discovery window applies to new occasions; existing enrollments are reconciled independently of the window (Spec p.17, B19)
      if (!enrollment && (occurrenceDt < horizonStart || occurrenceDt > horizonEnd)) {
        skippedCount++;
        continue;
      }

      const enrollmentKey = `${tenantId}:${campaignId}:${customer.id}:${occurrenceId}`;

      // Retention check (Spec p.25 & test B18): tombstone check prevents historical replay
      if (await isEnrollmentReplayBlocked(tenantId, enrollmentKey)) {
        skippedCount++;
        continue;
      }

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
            occasionLocalDate: occasion.localDate,
            planRevision: 1,
            status: 'ACTIVE',
            replyHoldAt: null,
            goalReachedAt: null,
            correctionGroupId,
            matchExplanation: audienceEval.explanation
          });
          isNewEnrollment = true;
          plannedEnrollments++;
        } catch (err: any) {
          if (err?.code !== 11000) throw err;
          enrollment = await CampaignEnrollmentModel.findOne({
            tenantId,
            campaignId,
            customerId: customer.id,
            occurrenceId
          });
          if (!enrollment) throw err;
        }
      } else if (occasion.isOneTimeWedding && enrollment.occasionLocalDate !== occasion.localDate) {
        // Spec A10: Wedding postponed under same event identity.
        // Recompute only unsubmitted steps, preserve accepted steps, log old/new dates
        logger.info(
          {
            enrollmentId: enrollment.id,
            oldDate: enrollment.occasionLocalDate,
            newDate: occasion.localDate
          },
          'Postponing wedding occasion under same event identity'
        );
        enrollment.occasionLocalDate = occasion.localDate;
        enrollment.planRevision += 1;
        await enrollment.save();

        // Replan unsubmitted executions
        const unsubmittedExecutions = await CampaignExecutionModel.find({
          tenantId,
          enrollmentId: enrollment.id,
          deliveryIntentId: null,
          state: { $in: ['SCHEDULED', 'DEFERRED'] }
        });

        for (const exe of unsubmittedExecutions) {
          const step = (version.steps || []).find((s) => s.stepId === exe.stepId);
          if (step) {
            const timing = calculateDueInstant(
              occasion.localDate,
              step.offsetDays,
              step.localTime,
              timezone
            );
            const latenessMinutes = step.maxLatenessMinutes || 120;
            const expiresAt = new Date(timing.dueAtUtc.getTime() + latenessMinutes * 60 * 1000);
            exe.dueAt = timing.dueAtUtc;
            exe.expiresAt = expiresAt;
            exe.localDate = timing.localDate;
            exe.localTime = timing.localTime;
            exe.planRevision = enrollment.planRevision;
            await exe.save();
          }
        }
      }

      // Version Pinning: Existing active enrollments stay pinned to their original campaignVersionId (B14)
      let effectiveVersion = version;
      if (!isNewEnrollment && enrollment.campaignVersionId !== version.id) {
        const pinned = await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId });
        if (pinned) effectiveVersion = pinned;
      }

      // Check Lineage / Date Correction across years (Spec p.20 & test B04)
      // "Across years use correctionGroupId lineage so accepted/unknown steps suppress replacement copies"
      const acceptedStepIdsInLineage = new Set<string>();
      const priorLineageEnrollments = await CampaignEnrollmentModel.find({
        tenantId,
        campaignId,
        correctionGroupId: enrollment.correctionGroupId || correctionGroupId,
        id: { $ne: enrollment.id }
      }).select('id').lean();

      if (priorLineageEnrollments.length > 0) {
        const priorEnrollmentIds = priorLineageEnrollments.map((e) => e.id);
        const priorAcceptedExecutions = await CampaignExecutionModel.find({
          tenantId,
          enrollmentId: { $in: priorEnrollmentIds },
          state: { $in: ['PROVIDER_ACCEPTED', 'DELIVERED', 'READ', 'OUTCOME_UNKNOWN'] }
        }).select('stepId').lean();

        for (const pae of priorAcceptedExecutions) {
          acceptedStepIdsInLineage.add(pae.stepId);
        }
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
            occasion.localDate,
            step.offsetDays,
            step.localTime,
            timezone
          );

          const latenessMinutes = step.maxLatenessMinutes || 120;
          const expiresAt = new Date(timing.dueAtUtc.getTime() + latenessMinutes * 60 * 1000);

          // FUTURE_ONLY & Outage Grace Policy (Spec p.17, B06, B19)
          const nowUtcMs = clock.now().toUTC().toMillis();
          const dueAtUtcMs = timing.dueAtUtc.getTime();
          let state: 'SCHEDULED' | 'SKIPPED' = 'SCHEDULED';
          let outcomeReason: string | undefined = undefined;

          // If step was already accepted under lineage correction, suppress repeat (B04)
          if (acceptedStepIdsInLineage.has(step.stepId)) {
            state = 'SKIPPED';
            outcomeReason = 'SKIPPED_ALREADY_ACCEPTED';
          } else if (dueAtUtcMs < nowUtcMs) {
            const elapsedHours = (nowUtcMs - dueAtUtcMs) / (3600 * 1000);
            if (elapsedHours > 2 || nowUtcMs >= expiresAt.getTime()) {
              // Elapsed step past 2-hour technical outage grace or past expiry
              state = 'SKIPPED';
              outcomeReason = 'SKIPPED_ELAPSED';
            }
          }

          let finalDueAt = timing.dueAtUtc;
          if (state === 'SCHEDULED') {
            // Adjust for allowed send hours and blackouts (B08)
            const adjustment = adjustForAllowedHoursAndBlackouts(timing.dueAtUtc, expiresAt, timezone);
            if (!adjustment.valid) {
              state = 'SKIPPED';
              outcomeReason = adjustment.reason || 'SKIPPED_BLACKOUT_EXPIRED';
            } else {
              finalDueAt = adjustment.adjustedDueAt;
            }
          }

          try {
            await CampaignExecutionModel.create({
              id: generateId('exe'),
              tenantId,
              enrollmentId: enrollment.id,
              campaignId,
              stepId: step.stepId,
              dueAt: finalDueAt,
              expiresAt,
              localDate: timing.localDate,
              localTime: timing.localTime,
              timezone,
              priority: version.priority || 50,
              planRevision: enrollment.planRevision,
              claimVersion: 0,
              pauseGeneration: campaign?.pauseGeneration ?? 0,
              state,
              outcomeReason,
              prerequisite: step.prerequisite,
              deliveryIntentId: null,
              lease: { token: null, until: null, claimedBy: null }
            });
            plannedExecutions++;
            stepsPlannedForCustomer++;
          } catch (err: any) {
            if (err?.code !== 11000) throw err;
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
  }

  logger.info(
    { plannedEnrollments, plannedExecutions, skippedCount },
    'Completed occasion planner pass'
  );

  return {
    plannedEnrollments,
    createdEnrollments: plannedEnrollments,
    plannedExecutions,
    skippedCount,
    details
  };
}
