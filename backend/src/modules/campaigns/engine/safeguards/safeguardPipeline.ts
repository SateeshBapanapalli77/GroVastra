import { ICampaignExecution } from '../../models/CampaignExecution.model';
import { ICampaignEnrollment, CampaignEnrollmentModel } from '../../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../../models/CampaignExecution.model';
import { CampaignModel } from '../../models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../../models/CampaignVersion.model';
import { CustomerModel, ICustomer } from '../../../crm/models/Customer.model';
import { checkAndReserveContactCapacity, CapCheckResult } from './contactCapResolver';
import { logger } from '../../../../config/logger';

export type PipelineOutcome =
  | { status: 'PROCEED'; customer: ICustomer; version: ICampaignVersion; enrollment: ICampaignEnrollment; campaign: any }
  | { status: 'SKIP'; reason: string }
  | { status: 'DEFER'; reason: string; nextDueAt: Date };

/**
 * Preflight Safeguard Pipeline (Chain of Responsibility Pattern)
 * Evaluates gates in strict Reason Precedence Order (Handoff Page 33):
 * 1. Channel Suppression / Customer Deletion
 * 2. Campaign / Global Pause & Pause Generation
 * 3. Step Expiry / Lateness Cutoff
 * 4. Stop Rules (stopOnGoal purchase, stopOnReply staff hold)
 * 5. Prerequisite Check (PREVIOUS_ACCEPTED)
 * 6. Contact Frequency Caps (1/24h, 3/7d)
 */
export async function executePreflightSafeguards(
  execution: ICampaignExecution,
  serverNow: Date = new Date()
): Promise<PipelineOutcome> {
  const { tenantId, campaignId, enrollmentId, stepId, expiresAt } = execution;

  // 1. Load Campaign & Version
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_NOT_FOUND' };
  }

  // Gate 1: Campaign Pause Check & Pause Generation Validation
  if (campaign.status === 'PAUSED' || campaign.status === 'ARCHIVED') {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_PAUSED' };
  }

  if (
    typeof (execution as any).pauseGeneration === 'number' &&
    (execution as any).pauseGeneration < campaign.pauseGeneration
  ) {
    return { status: 'SKIP', reason: 'SKIPPED_CAMPAIGN_PAUSED' };
  }

  const enrollment = await CampaignEnrollmentModel.findOne({ id: enrollmentId, tenantId });
  if (!enrollment || enrollment.status !== 'ACTIVE') {
    return { status: 'SKIP', reason: 'SKIPPED_ENROLLMENT_INACTIVE' };
  }

  const version = await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId });
  if (!version) {
    return { status: 'SKIP', reason: 'SKIPPED_VERSION_NOT_FOUND' };
  }

  const stepDef = version.steps.find((s) => s.stepId === stepId);
  if (!stepDef) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_NOT_FOUND' };
  }

  // 2. Load Customer
  const customer = await CustomerModel.findOne({ id: enrollment.customerId, tenantId });
  if (!customer || customer.status === 'DELETED') {
    return { status: 'SKIP', reason: 'SKIPPED_CUSTOMER_DELETED' };
  }

  // Gate 2: Channel Suppression & Permission
  if (customer.channelSuppressed) {
    return { status: 'SKIP', reason: 'SKIPPED_CHANNEL_SUPPRESSED' };
  }

  if (version.purpose === 'MARKETING' && !customer.optedInMarketing) {
    return { status: 'SKIP', reason: 'SKIPPED_MARKETING_OPT_OUT' };
  }

  // Gate 3: Expiry Check (Page 17)
  if (serverNow > expiresAt) {
    return { status: 'SKIP', reason: 'SKIPPED_STEP_EXPIRED' };
  }

  // Gate 4: Stop Rules (Handoff Page 8 & 11)
  // Stop on Goal Purchase
  if (stepDef.stopOnGoal && enrollment.goalReachedAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_GOAL_REACHED' };
  }

  // Stop on Customer Inbound Reply (Staff Hold)
  if (stepDef.stopOnReply && enrollment.replyHoldAt !== null) {
    return { status: 'SKIP', reason: 'SKIPPED_REPLY_HOLD' };
  }

  // Gate 5: Prerequisite Check (Page 8 & 19)
  if (stepDef.prerequisite === 'PREVIOUS_ACCEPTED') {
    const priorExecutions = await CampaignExecutionModel.find({
      tenantId,
      enrollmentId
    }).lean();

    // Check if there is an accepted previous step (PROVIDER_ACCEPTED, DELIVERED, or READ)
    const priorAccepted = priorExecutions.some(
      (e) => e.stepId !== stepId && ['PROVIDER_ACCEPTED', 'DELIVERED', 'READ'].includes(e.state)
    );

    if (!priorAccepted) {
      // Check if prior step has already failed or skipped permanently
      const priorTerminalFailure = priorExecutions.some(
        (e) => e.stepId !== stepId && ['SKIPPED', 'FAILED'].includes(e.state)
      );

      if (priorTerminalFailure) {
        return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
      }

      // Prior step might still be scheduled or in transit; defer
      const retryDue = new Date(serverNow.getTime() + 15 * 60 * 1000); // Check again in 15 min
      if (retryDue < expiresAt) {
        return {
          status: 'DEFER',
          reason: 'DEFERRED_WAITING_PREREQUISITE',
          nextDueAt: retryDue
        };
      }
      return { status: 'SKIP', reason: 'SKIPPED_PREREQUISITE_NOT_MET' };
    }
  }

  // Gate 6: Contact Caps & Collision Arbitration (Page 18)
  if (version.purpose === 'MARKETING') {
    const capResult: CapCheckResult = await checkAndReserveContactCapacity(
      tenantId,
      customer.phone,
      campaignId,
      execution.id,
      expiresAt,
      version.priority,
      serverNow
    );

    if (!capResult.allowed) {
      if (capResult.reason === 'DEFERRED_CONTACT_CAP' && capResult.nextAvailableAt) {
        return {
          status: 'DEFER',
          reason: 'DEFERRED_CONTACT_CAP',
          nextDueAt: capResult.nextAvailableAt
        };
      }
      return { status: 'SKIP', reason: 'SKIPPED_CONTACT_CAP' };
    }
  }

  // All gates passed!
  return {
    status: 'PROCEED',
    customer,
    version,
    enrollment,
    campaign
  };
}
