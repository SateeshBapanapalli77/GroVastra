import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

/**
 * Retention Preset Family (Spec p.16):
 * - VIP milestone (vip:level)
 * - Store credit expiry (credit:creditId)
 * - Patron referral (referral:refId)
 * - Exhibition / trunk show private preview (exhibition:showId)
 */

export async function evaluateVipMilestoneEvent(
  tenantId: string,
  campaignId: string,
  customerId: string,
  vipTier: string
): Promise<{ enrolled: boolean; enrollmentId?: string }> {
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign || !campaign.activeVersionId) return { enrolled: false };

  const version = await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId });
  if (!version) return { enrolled: false };

  const customer = await CustomerModel.findOne({ id: customerId, tenantId, status: 'ACTIVE', optedInMarketing: true });
  if (!customer) return { enrolled: false };

  const occurrenceId = `vip:${vipTier}`;
  const existing = await CampaignEnrollmentModel.findOne({ tenantId, campaignId, customerId, occurrenceId });
  if (existing) return { enrolled: false, enrollmentId: existing.id };

  const enrollment = await CampaignEnrollmentModel.create({
    id: generateId('enr'),
    tenantId,
    campaignId,
    campaignVersionId: version.id,
    customerId,
    occurrenceId,
    sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
    planRevision: 1,
    status: 'ACTIVE',
    replyHoldAt: null,
    goalReachedAt: null
  });

  const stepDef = version.steps[0] || {
    stepId: 'vip_congratulations',
    templateRef: { id: 'tpl_vip_milestone', revision: 1, language: 'en' },
    maxLatenessMinutes: 240
  };

  const dueAt = new Date();
  await CampaignExecutionModel.create({
    id: generateId('exe'),
    tenantId,
    enrollmentId: enrollment.id,
    campaignId,
    stepId: stepDef.stepId,
    dueAt,
    expiresAt: new Date(dueAt.getTime() + 24 * 3600 * 1000),
    localDate: dueAt.toISOString().slice(0, 10),
    localTime: '12:00',
    timezone: version.timezone || 'Asia/Kolkata',
    planRevision: 1,
    state: 'SCHEDULED',
    prerequisite: 'NONE',
    deliveryIntentId: null,
    lease: { token: null, until: null, claimedBy: null }
  });

  return { enrolled: true, enrollmentId: enrollment.id };
}

export async function evaluateCreditExpiryEvent(
  tenantId: string,
  campaignId: string,
  customerId: string,
  creditId: string,
  expiryDate: Date
): Promise<{ enrolled: boolean }> {
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign || !campaign.activeVersionId) return { enrolled: false };

  const version = await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId });
  if (!version) return { enrolled: false };

  const occurrenceId = `credit:${creditId}`;
  const existing = await CampaignEnrollmentModel.findOne({ tenantId, campaignId, customerId, occurrenceId });
  if (existing) return { enrolled: false };

  const enrollment = await CampaignEnrollmentModel.create({
    id: generateId('enr'),
    tenantId,
    campaignId,
    campaignVersionId: version.id,
    customerId,
    occurrenceId,
    sourceRef: { type: 'ORDER_EVENT', id: creditId, version: 1 },
    planRevision: 1,
    status: 'ACTIVE',
    replyHoldAt: null,
    goalReachedAt: null
  });

  const stepDef = version.steps[0] || {
    stepId: 'credit_reminder',
    templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
    maxLatenessMinutes: 240
  };

  const dueAt = new Date();
  await CampaignExecutionModel.create({
    id: generateId('exe'),
    tenantId,
    enrollmentId: enrollment.id,
    campaignId,
    stepId: stepDef.stepId,
    dueAt,
    expiresAt: new Date(dueAt.getTime() + 24 * 3600 * 1000),
    localDate: dueAt.toISOString().slice(0, 10),
    localTime: '11:00',
    timezone: version.timezone || 'Asia/Kolkata',
    planRevision: 1,
    state: 'SCHEDULED',
    prerequisite: 'NONE',
    deliveryIntentId: null,
    lease: { token: null, until: null, claimedBy: null }
  });

  return { enrolled: true };
}

export async function evaluateExhibitionInviteEvent(
  tenantId: string,
  campaignId: string,
  showId: string
): Promise<{ enrolledCount: number }> {
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign || !campaign.activeVersionId) return { enrolledCount: 0 };

  const version = await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId });
  if (!version) return { enrolledCount: 0 };

  const customers = await CustomerModel.find({
    tenantId,
    status: 'ACTIVE',
    optedInMarketing: true,
    channelSuppressed: false
  });

  const occurrenceId = `exhibition:${showId}`;
  let enrolledCount = 0;

  for (const customer of customers) {
    const existing = await CampaignEnrollmentModel.findOne({ tenantId, campaignId, customerId: customer.id, occurrenceId });
    if (!existing) {
      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId,
        sourceRef: { type: 'STOCK_EVENT', id: showId, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const stepDef = version.steps[0] || {
        stepId: 'exhibition_invitation',
        templateRef: { id: 'tpl_festival_launch', revision: 1, language: 'en' },
        maxLatenessMinutes: 240
      };

      const dueAt = new Date();
      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: enr.id,
        campaignId,
        stepId: stepDef.stepId,
        dueAt,
        expiresAt: new Date(dueAt.getTime() + 48 * 3600 * 1000),
        localDate: dueAt.toISOString().slice(0, 10),
        localTime: '11:00',
        timezone: version.timezone || 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      enrolledCount++;
    }
  }

  return { enrolledCount };
}
