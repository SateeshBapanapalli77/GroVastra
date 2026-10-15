import { CampaignCustomerFactModel } from '../models/CampaignCustomerFact.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { generateId } from '../../../shared/utils/id';
import { DateTime } from 'luxon';
import { logger } from '../../../config/logger';

export interface CustomerFactUpdateParams {
  tenantId: string;
  customerId: string;
  orderId: string;
  purchaseAt: Date;
  netPaise: number;
}

/**
 * Updates or creates CampaignCustomerFact record upon order completion (Spec p.14, A13, B17)
 */
export async function updateCustomerPurchaseFact(params: CustomerFactUpdateParams) {
  const { tenantId, customerId, orderId, purchaseAt } = params;

  let fact = await CampaignCustomerFactModel.findOne({ tenantId, customerId });
  if (!fact) {
    fact = new CampaignCustomerFactModel({
      id: generateId('fact'),
      tenantId,
      customerId,
      lastQualifyingOrderId: orderId,
      lastQualifyingPurchaseAt: purchaseAt,
      nextEvaluationAt: new Date(purchaseAt.getTime() + 90 * 24 * 3600 * 1000), // Default 90d lookahead
      aggregateVersion: 1,
      tags: [],
      preferences: {}
    });
  } else {
    fact.lastQualifyingOrderId = orderId;
    fact.lastQualifyingPurchaseAt = purchaseAt;
    fact.nextEvaluationAt = new Date(purchaseAt.getTime() + 90 * 24 * 3600 * 1000);
    fact.aggregateVersion += 1;
  }

  await fact.save();
  return fact;
}

/**
 * Recomputes Customer Facts upon Order Refund (Spec p.14, test A14)
 * Anchor recomputation without re-sending a completed occurrence
 */
export async function handleOrderRefundFact(
  tenantId: string,
  customerId: string,
  refundedOrderId: string,
  remainingOrders: Array<{ orderId: string; purchaseAt: Date }> = []
) {
  const fact = await CampaignCustomerFactModel.findOne({ tenantId, customerId });
  if (!fact) return null;

  if (fact.lastQualifyingOrderId === refundedOrderId) {
    if (remainingOrders.length > 0) {
      // Pick most recent remaining order
      const sorted = [...remainingOrders].sort((a, b) => b.purchaseAt.getTime() - a.purchaseAt.getTime());
      fact.lastQualifyingOrderId = sorted[0].orderId;
      fact.lastQualifyingPurchaseAt = sorted[0].purchaseAt;
      fact.nextEvaluationAt = new Date(sorted[0].purchaseAt.getTime() + 90 * 24 * 3600 * 1000);
    } else {
      fact.lastQualifyingOrderId = null;
      fact.lastQualifyingPurchaseAt = null;
      fact.nextEvaluationAt = null;
    }

    fact.aggregateVersion += 1;
    await fact.save();
  }

  logger.info(
    { tenantId, customerId, refundedOrderId, newAnchor: fact.lastQualifyingOrderId, aggregateVersion: fact.aggregateVersion },
    'Recomputed customer facts following order refund'
  );

  return fact;
}

/**
 * Daily Indexed Inactivity Scan (Spec p.14, tests A13, B17)
 * Runs against indexed nextEvaluationAt <= serverNow
 */
export async function runIndexedInactivityScan(
  tenantId: string,
  serverNow: Date = new Date()
): Promise<{ evaluatedCount: number; enrolledCount: number }> {
  // 1. Find active win-back campaign
  const winbackCampaign = await CampaignModel.findOne({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  if (!winbackCampaign || !winbackCampaign.activeVersionId) {
    return { evaluatedCount: 0, enrolledCount: 0 };
  }

  const version = await CampaignVersionModel.findOne({
    id: winbackCampaign.activeVersionId,
    tenantId
  }).lean();

  if (!version || version.trigger.type !== 'INACTIVITY_SCAN') {
    return { evaluatedCount: 0, enrolledCount: 0 };
  }

  const inactivityDays = version.trigger.inactivityDays || 90;
  const cutoffDate = DateTime.fromJSDate(serverNow).minus({ days: inactivityDays }).toJSDate();

  // 2. Query indexed facts: nextEvaluationAt <= serverNow (B17)
  const factsToEvaluate = await CampaignCustomerFactModel.find({
    tenantId,
    lastQualifyingPurchaseAt: { $ne: null },
    nextEvaluationAt: { $lte: serverNow }
  });

  let enrolledCount = 0;

  for (const fact of factsToEvaluate) {
    const isInactive = fact.lastQualifyingPurchaseAt && fact.lastQualifyingPurchaseAt <= cutoffDate;

    if (isInactive && fact.lastQualifyingOrderId) {
      const occurrenceId = `winback:${fact.lastQualifyingOrderId}:${version.id}`;

      // Check if this occurrence was already enrolled or completed (Spec p.14, A14)
      const existing = await CampaignEnrollmentModel.findOne({
        tenantId,
        campaignId: winbackCampaign.id,
        customerId: fact.customerId,
        occurrenceId
      });

      if (!existing) {
        const enr = await CampaignEnrollmentModel.create({
          id: generateId('enr'),
          tenantId,
          campaignId: winbackCampaign.id,
          campaignVersionId: version.id,
          customerId: fact.customerId,
          occurrenceId,
          sourceRef: {
            type: 'ORDER_EVENT',
            id: fact.lastQualifyingOrderId,
            version: fact.aggregateVersion
          },
          planRevision: 1,
          status: 'ACTIVE',
          replyHoldAt: null,
          goalReachedAt: null
        });

        const stepDef = version.steps[0] || {
          stepId: 'winback_nudge',
          templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
          maxLatenessMinutes: 180
        };

        const dueAt = serverNow;
        await CampaignExecutionModel.create({
          id: generateId('exe'),
          tenantId,
          enrollmentId: enr.id,
          campaignId: winbackCampaign.id,
          stepId: stepDef.stepId,
          dueAt,
          expiresAt: new Date(dueAt.getTime() + 24 * 3600 * 1000),
          localDate: serverNow.toISOString().slice(0, 10),
          localTime: '11:30',
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

    // Advance nextEvaluationAt by 24h so it does not evaluate multiple times today
    fact.nextEvaluationAt = new Date(serverNow.getTime() + 24 * 3600 * 1000);
    await fact.save();
  }

  return { evaluatedCount: factsToEvaluate.length, enrolledCount };
}

/**
 * Complete the outfit trigger (occurrence: outfit:orderId:ruleId)
 */
export async function evaluateCompleteTheOutfitEvent(
  tenantId: string,
  campaignId: string,
  customerId: string,
  orderId: string,
  ruleId: string = 'blouse_match'
): Promise<{ enrolled: boolean }> {
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign || !campaign.activeVersionId) return { enrolled: false };

  const version = await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId });
  if (!version) return { enrolled: false };

  const occurrenceId = `outfit:${orderId}:${ruleId}`;
  const existing = await CampaignEnrollmentModel.findOne({ tenantId, campaignId, customerId, occurrenceId });
  if (existing) return { enrolled: false };

  const enr = await CampaignEnrollmentModel.create({
    id: generateId('enr'),
    tenantId,
    campaignId,
    campaignVersionId: version.id,
    customerId,
    occurrenceId,
    sourceRef: { type: 'ORDER_EVENT', id: orderId, version: 1 },
    planRevision: 1,
    status: 'ACTIVE',
    replyHoldAt: null,
    goalReachedAt: null
  });

  const stepDef = version.steps[0] || {
    stepId: 'outfit_recommendation',
    templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
    maxLatenessMinutes: 180
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

  return { enrolled: true };
}

/**
 * First-to-second purchase nurture trigger (occurrence: nurture:orderId)
 */
export async function evaluateFirstToSecondPurchaseEvent(
  tenantId: string,
  campaignId: string,
  customerId: string,
  orderId: string
): Promise<{ enrolled: boolean }> {
  const campaign = await CampaignModel.findOne({ id: campaignId, tenantId });
  if (!campaign || !campaign.activeVersionId) return { enrolled: false };

  const version = await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId });
  if (!version) return { enrolled: false };

  const occurrenceId = `nurture:${orderId}`;
  const existing = await CampaignEnrollmentModel.findOne({ tenantId, campaignId, customerId, occurrenceId });
  if (existing) return { enrolled: false };

  const enr = await CampaignEnrollmentModel.create({
    id: generateId('enr'),
    tenantId,
    campaignId,
    campaignVersionId: version.id,
    customerId,
    occurrenceId,
    sourceRef: { type: 'ORDER_EVENT', id: orderId, version: 1 },
    planRevision: 1,
    status: 'ACTIVE',
    replyHoldAt: null,
    goalReachedAt: null
  });

  const stepDef = version.steps[0] || {
    stepId: 'nurture_followup',
    templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
    maxLatenessMinutes: 180
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

  return { enrolled: true };
}
