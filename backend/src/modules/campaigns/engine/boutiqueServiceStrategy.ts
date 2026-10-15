import { CustomerModel } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { DomainEvent } from '../../../shared/events/types';
import { generateId } from '../../../shared/utils/id';
import { DateTime } from 'luxon';
import { adjustForAllowedHoursAndBlackouts } from '../../../shared/utils/clock';
import { logger } from '../../../config/logger';

export interface ServiceStrategyResult {
  referenceId: string;
  enrolled: boolean;
  executionId?: string;
}

/**
 * Boutique Service Family Evaluator (Spec p.15 & 27, tests B16, C14):
 * - Fitting appointments (fitting:appointmentId)
 * - Custom alterations (alteration:jobId)
 * - Out-for-delivery updates (delivery:orderId:status)
 * - Purpose is strictly ORDER_SERVICE (does not consume marketing contact cap)
 * - Per-order deduplication (rejects duplicate courier updates)
 * - Rejects stale entity versions
 */

async function findActiveCampaignForEventType(tenantId: string, eventType: string) {
  const campaigns = await CampaignModel.find({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  for (const c of campaigns) {
    if (!c.activeVersionId) continue;
    const v = await CampaignVersionModel.findOne({
      id: c.activeVersionId,
      tenantId
    }).lean();
    if (v && (v.trigger?.eventType === eventType || v.trigger?.type === eventType)) {
      return { campaign: c, version: v };
    }
  }
  return null;
}

export async function evaluateAlterationReadyEvent(
  event: DomainEvent<{ jobId: string; customerId: string; itemTitle: string }>
): Promise<ServiceStrategyResult> {
  const { tenantId, occurredAt, data, entityVersion } = event;
  const { jobId, customerId, itemTitle } = data;

  const match = await findActiveCampaignForEventType(tenantId, 'alteration.completed');
  if (!match) {
    return { referenceId: jobId, enrolled: false };
  }
  const { campaign: activeCampaign, version } = match;

  const customer = await CustomerModel.findOne({
    id: customerId,
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false
  });

  if (!customer) {
    return { referenceId: jobId, enrolled: false };
  }

  const occurrenceId = `alteration:${jobId}`;

  let enrollment = await CampaignEnrollmentModel.findOne({
    tenantId,
    campaignId: activeCampaign.id,
    customerId,
    occurrenceId
  });

  // Stale entity version check (Spec p.24)
  if (enrollment && enrollment.sourceRef && entityVersion && entityVersion < enrollment.sourceRef.version) {
    logger.info({ jobId, entityVersion, currentVersion: enrollment.sourceRef.version }, 'Stale entity version rejected');
    return { referenceId: jobId, enrolled: false };
  }

  let enrolled = false;
  if (!enrollment) {
    if (jobId && itemTitle) {
      const { BoutiqueJobModel } = await import('../../crm/models/BoutiqueJob.model');
      await BoutiqueJobModel.findOneAndUpdate(
        { id: jobId, tenantId },
        {
          $set: {
            id: jobId,
            tenantId,
            customerId,
            itemTitle,
            status: 'READY_FOR_PICKUP',
            readyAt: occurredAt || new Date()
          }
        },
        { upsert: true, new: true }
      );
    }

    enrollment = await CampaignEnrollmentModel.create({
      id: generateId('enr'),
      tenantId,
      campaignId: activeCampaign.id,
      campaignVersionId: version.id,
      customerId,
      occurrenceId,
      sourceRef: {
        type: 'ORDER_EVENT',
        id: jobId,
        version: entityVersion || 1
      },
      planRevision: 1,
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });
    enrolled = true;
  }

  const stepDef = version.steps[0] || {
    stepId: 'ready_for_pickup',
    templateRef: { id: 'tpl_alteration_ready', revision: 1, language: 'en' },
    maxLatenessMinutes: 240
  };

  const existingExecution = await CampaignExecutionModel.findOne({
    tenantId,
    enrollmentId: enrollment.id,
    stepId: stepDef.stepId
  });

  let executionId = existingExecution?.id;

  if (!existingExecution) {
    executionId = generateId('exe');
    const timezone = version.timezone || 'Asia/Kolkata';
    const dueAt = new Date();
    const expiresAt = new Date(dueAt.getTime() + (stepDef.maxLatenessMinutes || 240) * 60 * 1000);
    const localDt = DateTime.fromJSDate(dueAt, { zone: timezone });

    await CampaignExecutionModel.create({
      id: executionId,
      tenantId,
      enrollmentId: enrollment.id,
      campaignId: activeCampaign.id,
      stepId: stepDef.stepId,
      dueAt,
      expiresAt,
      localDate: localDt.toFormat('yyyy-MM-dd'),
      localTime: localDt.toFormat('HH:mm'),
      timezone,
      priority: version.priority || 70,
      planRevision: 1,
      state: 'SCHEDULED',
      outcomeReason: undefined,
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });
  }

  return { referenceId: jobId, enrolled, executionId };
}

export async function evaluateFittingAppointmentEvent(
  event: DomainEvent<{ appointmentId: string; customerId: string }>
): Promise<ServiceStrategyResult> {
  const { tenantId, occurredAt, data, entityVersion } = event;
  const { appointmentId, customerId } = data;

  const match = await findActiveCampaignForEventType(tenantId, 'appointment.scheduled');
  if (!match) {
    return { referenceId: appointmentId, enrolled: false };
  }
  const { campaign: activeCampaign, version } = match;

  const customer = await CustomerModel.findOne({
    id: customerId,
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false
  });

  if (!customer) {
    return { referenceId: appointmentId, enrolled: false };
  }

  const occurrenceId = `fitting:${appointmentId}`;

  let enrollment = await CampaignEnrollmentModel.findOne({
    tenantId,
    campaignId: activeCampaign.id,
    customerId,
    occurrenceId
  });

  if (enrollment && enrollment.sourceRef && entityVersion && entityVersion < enrollment.sourceRef.version) {
    return { referenceId: appointmentId, enrolled: false };
  }

  let enrolled = false;
  if (!enrollment) {
    enrollment = await CampaignEnrollmentModel.create({
      id: generateId('enr'),
      tenantId,
      campaignId: activeCampaign.id,
      campaignVersionId: version.id,
      customerId,
      occurrenceId,
      sourceRef: {
        type: 'ORDER_EVENT',
        id: appointmentId,
        version: entityVersion || 1
      },
      planRevision: 1,
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });
    enrolled = true;
  }

  const stepDef = version.steps[0] || {
    stepId: 'fitting_reminder',
    templateRef: { id: 'tpl_fitting_appointment', revision: 1, language: 'en' },
    maxLatenessMinutes: 240
  };

  const existingExecution = await CampaignExecutionModel.findOne({
    tenantId,
    enrollmentId: enrollment.id,
    stepId: stepDef.stepId
  });

  let executionId = existingExecution?.id;

  if (!existingExecution) {
    executionId = generateId('exe');
    const timezone = version.timezone || 'Asia/Kolkata';
    const dueAt = new Date();
    const expiresAt = new Date(dueAt.getTime() + (stepDef.maxLatenessMinutes || 240) * 60 * 1000);
    const localDt = DateTime.fromJSDate(dueAt, { zone: timezone });

    await CampaignExecutionModel.create({
      id: executionId,
      tenantId,
      enrollmentId: enrollment.id,
      campaignId: activeCampaign.id,
      stepId: stepDef.stepId,
      dueAt,
      expiresAt,
      localDate: localDt.toFormat('yyyy-MM-dd'),
      localTime: localDt.toFormat('HH:mm'),
      timezone,
      priority: version.priority || 70,
      planRevision: 1,
      state: 'SCHEDULED',
      outcomeReason: undefined,
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });
  }

  return { referenceId: appointmentId, enrolled, executionId };
}

export async function evaluateDeliveryUpdateEvent(
  event: DomainEvent<{ orderId: string; customerId: string; deliveryStatus: string }>
): Promise<ServiceStrategyResult> {
  const { tenantId, occurredAt, data, entityVersion } = event;
  const { orderId, customerId, deliveryStatus } = data;

  const match = await findActiveCampaignForEventType(tenantId, 'delivery.updated');
  if (!match) {
    return { referenceId: orderId, enrolled: false };
  }
  const { campaign: activeCampaign, version } = match;

  const customer = await CustomerModel.findOne({
    id: customerId,
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false
  });

  if (!customer) {
    return { referenceId: orderId, enrolled: false };
  }

  // Deduplication per order and courier status (Spec p.15)
  // Re-occurring duplicate courier updates are ignored
  const occurrenceId = `delivery:${orderId}:${deliveryStatus}`;

  let enrollment = await CampaignEnrollmentModel.findOne({
    tenantId,
    campaignId: activeCampaign.id,
    customerId,
    occurrenceId
  });

  if (enrollment) {
    logger.info({ orderId, deliveryStatus }, 'Duplicate courier delivery event ignored');
    return { referenceId: orderId, enrolled: false, executionId: undefined };
  }

  enrollment = await CampaignEnrollmentModel.create({
    id: generateId('enr'),
    tenantId,
    campaignId: activeCampaign.id,
    campaignVersionId: version.id,
    customerId,
    occurrenceId,
    sourceRef: {
      type: 'ORDER_EVENT',
      id: orderId,
      version: entityVersion || 1
    },
    planRevision: 1,
    status: 'ACTIVE',
    replyHoldAt: null,
    goalReachedAt: null
  });

  const stepDef = version.steps[0] || {
    stepId: 'out_for_delivery',
    templateRef: { id: 'tpl_delivery_update', revision: 1, language: 'en' },
    maxLatenessMinutes: 240
  };

  const executionId = generateId('exe');
  const timezone = version.timezone || 'Asia/Kolkata';
  const localDt = DateTime.now().setZone(timezone);
  const localDate = localDt.toFormat('yyyy-MM-dd');
  const localTime = localDt.toFormat('HH:mm');
  const dueAt = new Date();
  const expiresAt = new Date(dueAt.getTime() + (stepDef.maxLatenessMinutes || 240) * 60 * 1000);
  const adjustment = adjustForAllowedHoursAndBlackouts(dueAt, expiresAt, timezone);
  const finalDueAt = adjustment.valid ? adjustment.adjustedDueAt : dueAt;
  const state = adjustment.valid ? 'SCHEDULED' : 'SKIPPED';
  const outcomeReason = adjustment.valid ? undefined : (adjustment.reason || 'SKIPPED_BLACKOUT_EXPIRED');

  await CampaignExecutionModel.create({
    id: executionId,
    tenantId,
    enrollmentId: enrollment.id,
    campaignId: activeCampaign.id,
    stepId: stepDef.stepId,
    dueAt: finalDueAt,
    expiresAt,
    localDate,
    localTime,
    timezone,
    priority: version.priority || 70,
    planRevision: 1,
    state,
    outcomeReason,
    prerequisite: 'NONE',
    deliveryIntentId: null,
    lease: { token: null, until: null, claimedBy: null }
  });

  return { referenceId: orderId, enrolled: true, executionId };
}
