import { CustomerProductRequestModel } from '../../crm/models/CustomerProductRequest.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { ProductModel } from '../../inventory/models/Product.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { DomainEvent } from '../../../shared/events/types';
import { generateId } from '../../../shared/utils/id';
import { DateTime } from 'luxon';
import { adjustForAllowedHoursAndBlackouts } from '../../../shared/utils/clock';
import { logger } from '../../../config/logger';

export interface MerchandiseMatchResult {
  sku?: string;
  matchedRequests: number;
  createdEnrollments: number;
  createdExecutions: number;
  consolidatedCount?: number;
}

/**
 * Merchandise Family Evaluator (Spec p.13 & 16, tests A15, A16):
 * 1. Requested restock with exact SKU matching (arrival:arrivalEventId:requestId)
 * 2. True-availability event required (rejects stock recounts)
 * 3. Consolidates multiple matches per customer into one payload
 * 4. Re-checks stock at execution and again before submission
 * 5. Festival launches (festival:seasonId) and Collection releases (collection:releaseId)
 * 6. Selected-stock offers (stockoffer:offerId)
 */
export async function evaluateInventoryArrivalEvent(
  event: DomainEvent<{
    sku: string;
    title?: string;
    pricePaise?: number;
    stockCount: number;
    isStockRecount?: boolean;
    arrivalEventId?: string;
    seasonId?: string;
    releaseId?: string;
    offerId?: string;
  }>
): Promise<MerchandiseMatchResult> {
  const { tenantId, occurredAt, data } = event;
  const { sku, title, stockCount, isStockRecount, arrivalEventId } = data;

  // 1. Guard against stock recounts (Spec p.13): Require true availability event
  if (isStockRecount === true || event.type === 'inventory.recount') {
    logger.info({ sku, isStockRecount }, 'Stock recount event ignored: true availability event required');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  if (!sku || stockCount <= 0) {
    logger.info({ sku, stockCount }, 'Restock event ignored: zero or missing stock');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  // 2. Find active merchandise campaign
  const activeCampaign = await CampaignModel.findOne({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  if (!activeCampaign || !activeCampaign.activeVersionId) {
    logger.info({ tenantId }, 'No active campaign for merchandise arrival event');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  const version = await CampaignVersionModel.findOne({
    id: activeCampaign.activeVersionId,
    tenantId
  }).lean();

  if (!version) {
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  // 3. Find open customer requests for this exact SKU
  const exactRequests = await CustomerProductRequestModel.find({
    tenantId,
    sku,
    status: 'OPEN'
  }).lean();

  let allRequests = [...exactRequests];

  // Optional similar-arrival matching rule
  if ((version.trigger as any)?.allowSimilarWeave) {
    const product = await ProductModel.findOne({ tenantId, sku }).lean();
    if (product) {
      const similarRequests = await CustomerProductRequestModel.find({
        tenantId,
        sku: { $ne: sku },
        weave: product.weave,
        status: 'OPEN'
      }).lean();
      allRequests = [...allRequests, ...similarRequests];
    }
  }

  if (allRequests.length === 0) {
    logger.info({ sku }, 'No open customer requests matching arrived merchandise');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  // 4. Consolidate multiple matches per customer into one payload (Spec p.13, test A16)
  const requestsByCustomer = new Map<string, typeof allRequests>();
  for (const req of allRequests) {
    const existing = requestsByCustomer.get(req.customerId) || [];
    existing.push(req);
    requestsByCustomer.set(req.customerId, existing);
  }

  let createdEnrollments = 0;
  let createdExecutions = 0;
  const eventRefId = arrivalEventId || event.eventId || generateId('arr');

  for (const [customerId, customerRequests] of requestsByCustomer.entries()) {
    const customer = await CustomerModel.findOne({
      id: customerId,
      tenantId,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false
    });

    if (!customer) continue;

    // Spec p.16: arrival:arrivalEventId:requestId
    const primaryRequestId = customerRequests[0].id;
    const occurrenceId = `arrival:${eventRefId}:${primaryRequestId}`;

    let enrollment = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId: activeCampaign.id,
      customerId,
      occurrenceId
    });

    let enrollmentId = enrollment?.id;

    if (!enrollment) {
      enrollmentId = generateId('enr');
      enrollment = await CampaignEnrollmentModel.create({
        id: enrollmentId,
        tenantId,
        campaignId: activeCampaign.id,
        campaignVersionId: version.id,
        customerId,
        occurrenceId,
        sourceRef: {
          type: 'STOCK_EVENT',
          id: sku,
          version: event.entityVersion || 1
        },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });
      createdEnrollments++;

      // Mark all consolidated requests as NOTIFIED
      const requestIds = customerRequests.map((r) => r.id);
      await CustomerProductRequestModel.updateMany(
        { id: { $in: requestIds } },
        { $set: { status: 'NOTIFIED', notifiedAt: new Date() } }
      );
    }

    // Upsert execution
    const stepDef = version.steps[0] || {
      stepId: 'restock_notification',
      templateRef: { id: 'tpl_stock_restock', revision: 2, language: 'en' },
      maxLatenessMinutes: 180
    };

    const existingExecution = await CampaignExecutionModel.findOne({
      tenantId,
      enrollmentId,
      stepId: stepDef.stepId
    });

    if (!existingExecution) {
      const timezone = version.timezone || 'Asia/Kolkata';
      const baseDueAt = new Date(occurredAt || Date.now());
      const usefulDurationMs = Math.max((stepDef.maxLatenessMinutes || 180) * 60 * 1000, 24 * 60 * 60 * 1000);
      const tentativeExpires = new Date(baseDueAt.getTime() + usefulDurationMs);
      const adjustment = adjustForAllowedHoursAndBlackouts(baseDueAt, tentativeExpires, timezone);
      const finalDueAt = adjustment.valid ? adjustment.adjustedDueAt : baseDueAt;
      const expiresAt = new Date(finalDueAt.getTime() + usefulDurationMs);
      const localDt = DateTime.fromJSDate(finalDueAt, { zone: timezone });
      const localDate = localDt.toFormat('yyyy-MM-dd');
      const localTime = localDt.toFormat('HH:mm');

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId,
        campaignId: activeCampaign.id,
        stepId: stepDef.stepId,
        dueAt: finalDueAt,
        expiresAt,
        localDate,
        localTime,
        timezone,
        priority: version.priority || 60,
        planRevision: 1,
        state: 'SCHEDULED',
        outcomeReason: undefined,
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      createdExecutions++;
    }
  }

  logger.info(
    { sku, matchedCustomers: requestsByCustomer.size, createdEnrollments, createdExecutions },
    'Processed merchandise arrival event'
  );

  return {
    sku,
    matchedRequests: allRequests.length,
    createdEnrollments,
    createdExecutions,
    consolidatedCount: allRequests.length - requestsByCustomer.size
  };
}

/**
 * Festival campaign activation (occurrence: festival:seasonId)
 */
export async function evaluateFestivalEvent(
  tenantId: string,
  campaignId: string,
  seasonId: string
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

  const occurrenceId = `festival:${seasonId}`;
  let enrolledCount = 0;

  for (const customer of customers) {
    const existing = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId,
      customerId: customer.id,
      occurrenceId
    });

    if (!existing) {
      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId,
        sourceRef: { type: 'STOCK_EVENT', id: seasonId, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const stepDef = version.steps[0] || {
        stepId: 'festival_greeting',
        templateRef: { id: 'tpl_festival_launch', revision: 1, language: 'en' },
        maxLatenessMinutes: 240
      };

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
        id: generateId('exe'),
        tenantId,
        enrollmentId: enr.id,
        campaignId,
        stepId: stepDef.stepId,
        dueAt: finalDueAt,
        expiresAt,
        localDate,
        localTime,
        timezone,
        priority: version.priority || 50,
        planRevision: 1,
        state,
        outcomeReason,
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      enrolledCount++;
    }
  }

  return { enrolledCount };
}

/**
 * Collection launch activation (occurrence: collection:releaseId)
 */
export async function evaluateCollectionReleaseEvent(
  tenantId: string,
  campaignId: string,
  releaseId: string
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

  const occurrenceId = `collection:${releaseId}`;
  let enrolledCount = 0;

  for (const customer of customers) {
    const existing = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId,
      customerId: customer.id,
      occurrenceId
    });

    if (!existing) {
      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId,
        sourceRef: { type: 'STOCK_EVENT', id: releaseId, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const stepDef = version.steps[0] || {
        stepId: 'collection_preview',
        templateRef: { id: 'tpl_collection_launch', revision: 1, language: 'en' },
        maxLatenessMinutes: 240
      };

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
        id: generateId('exe'),
        tenantId,
        enrollmentId: enr.id,
        campaignId,
        stepId: stepDef.stepId,
        dueAt: finalDueAt,
        expiresAt,
        localDate,
        localTime,
        timezone,
        priority: version.priority || 50,
        planRevision: 1,
        state,
        outcomeReason,
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      enrolledCount++;
    }
  }

  return { enrolledCount };
}

/**
 * Selected-stock offer activation (occurrence: stockoffer:offerId)
 */
export async function evaluateSelectedStockOfferEvent(
  tenantId: string,
  campaignId: string,
  offerId: string
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

  const occurrenceId = `stockoffer:${offerId}`;
  let enrolledCount = 0;

  for (const customer of customers) {
    const existing = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId,
      customerId: customer.id,
      occurrenceId
    });

    if (!existing) {
      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId,
        sourceRef: { type: 'STOCK_EVENT', id: offerId, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const stepDef = version.steps[0] || {
        stepId: 'stockoffer_preview',
        templateRef: { id: 'tpl_collection_launch', revision: 1, language: 'en' },
        maxLatenessMinutes: 240
      };

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
        id: generateId('exe'),
        tenantId,
        enrollmentId: enr.id,
        campaignId,
        stepId: stepDef.stepId,
        dueAt: finalDueAt,
        expiresAt,
        localDate,
        localTime,
        timezone,
        priority: version.priority || 50,
        planRevision: 1,
        state,
        outcomeReason,
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      enrolledCount++;
    }
  }

  return { enrolledCount };
}
