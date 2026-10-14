import { BoutiqueJobModel } from '../../crm/models/BoutiqueJob.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { DomainEvent } from '../../../shared/events/types';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

export interface AlterationStrategyResult {
  jobId: string;
  enrolled: boolean;
  executionId?: string;
}

/**
 * Boutique Alterations & Fitting Strategy (Handoff Page 15):
 * Triggers when custom blouse stitching, fall-pico, or alterations reach READY_FOR_PICKUP.
 * Service purpose: Not subject to marketing caps, but checks customer channel suppression.
 */
export async function evaluateAlterationReadyEvent(
  event: DomainEvent<{ jobId: string; customerId: string; itemTitle: string }>
): Promise<AlterationStrategyResult> {
  const { tenantId, occurredAt, data } = event;
  const { jobId, customerId, itemTitle } = data;

  const activeCampaign = await CampaignModel.findOne({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  if (!activeCampaign || !activeCampaign.activeVersionId) {
    return { jobId, enrolled: false };
  }

  const version = await CampaignVersionModel.findOne({
    id: activeCampaign.activeVersionId,
    tenantId
  }).lean();

  if (!version || version.trigger.eventType !== 'alteration.completed') {
    return { jobId, enrolled: false };
  }

  const customer = await CustomerModel.findOne({
    id: customerId,
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false
  });

  if (!customer) {
    return { jobId, enrolled: false };
  }

  const occurrenceId = `alteration:${jobId}`;

  // Upsert enrollment
  let enrollment = await CampaignEnrollmentModel.findOne({
    tenantId,
    campaignId: activeCampaign.id,
    customerId,
    occurrenceId
  });

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
        id: jobId,
        version: 1
      },
      planRevision: 1,
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });
    enrolled = true;
  }

  // Create immediate pickup execution
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
    const dueAt = new Date();
    const expiresAt = new Date(dueAt.getTime() + (stepDef.maxLatenessMinutes || 240) * 60 * 1000);

    await CampaignExecutionModel.create({
      id: executionId,
      tenantId,
      enrollmentId: enrollment.id,
      campaignId: activeCampaign.id,
      stepId: stepDef.stepId,
      dueAt,
      expiresAt,
      localDate: dueAt.toISOString().slice(0, 10),
      localTime: '11:00',
      timezone: version.timezone || 'Asia/Kolkata',
      planRevision: 1,
      state: 'SCHEDULED',
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });
  }

  logger.info({ jobId, customerId, executionId }, 'Processed alteration pickup notification');
  return { jobId, enrolled, executionId };
}
