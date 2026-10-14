import { CustomerEnquiryModel } from '../../crm/models/CustomerEnquiry.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { DomainEvent } from '../../../shared/events/types';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

export interface EnquiryStrategyResult {
  enquiryId: string;
  enrolled: boolean;
  scheduledSteps: number;
}

/**
 * Unresolved Enquiry Strategy (Handoff Page 14):
 * Follows up with customers who inquired about a handloom saree before interest is lost.
 * Anchor: enquiry lastInteractionAt. Step 1: +24h, Step 2: +72h.
 * Halts if customer replies or staff takes over.
 */
export async function evaluateEnquiryEvent(
  event: DomainEvent<{ enquiryId: string; customerId: string; inquiryText: string }>
): Promise<EnquiryStrategyResult> {
  const { tenantId, occurredAt, data } = event;
  const { enquiryId, customerId } = data;

  const activeCampaign = await CampaignModel.findOne({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  if (!activeCampaign || !activeCampaign.activeVersionId) {
    return { enquiryId, enrolled: false, scheduledSteps: 0 };
  }

  const version = await CampaignVersionModel.findOne({
    id: activeCampaign.activeVersionId,
    tenantId
  }).lean();

  if (!version || version.trigger.eventType !== 'enquiry.received') {
    return { enquiryId, enrolled: false, scheduledSteps: 0 };
  }

  const customer = await CustomerModel.findOne({
    id: customerId,
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false
  });

  if (!customer) {
    return { enquiryId, enrolled: false, scheduledSteps: 0 };
  }

  const occurrenceId = `enquiry:${enquiryId}`;

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
        type: 'ENQUIRY_EVENT',
        id: enquiryId,
        version: 1
      },
      planRevision: 1,
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });
    enrolled = true;
  }

  // Schedule +24h and +72h steps
  let scheduledSteps = 0;
  const stepOffsets = [
    { stepId: 'enquiry_nudge_24h', delayHours: 24 },
    { stepId: 'enquiry_nudge_72h', delayHours: 72 }
  ];

  for (const st of stepOffsets) {
    const existing = await CampaignExecutionModel.findOne({
      tenantId,
      enrollmentId: enrollment.id,
      stepId: st.stepId
    });

    if (!existing) {
      const dueAt = new Date(new Date(occurredAt).getTime() + st.delayHours * 3600 * 1000);
      const expiresAt = new Date(dueAt.getTime() + 12 * 3600 * 1000); // 12-hour expiry

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: enrollment.id,
        campaignId: activeCampaign.id,
        stepId: st.stepId,
        dueAt,
        expiresAt,
        localDate: dueAt.toISOString().slice(0, 10),
        localTime: '11:00',
        timezone: version.timezone || 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: st.stepId === 'enquiry_nudge_72h' ? 'PREVIOUS_ACCEPTED' : 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      scheduledSteps++;
    }
  }

  logger.info({ enquiryId, customerId, scheduledSteps }, 'Evaluated enquiry follow-up campaign');
  return { enquiryId, enrolled, scheduledSteps };
}
