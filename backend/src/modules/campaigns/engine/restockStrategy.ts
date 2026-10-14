import { CustomerProductRequestModel } from '../../crm/models/CustomerProductRequest.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { DomainEvent } from '../../../shared/events/types';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

export interface RestockMatchResult {
  sku: string;
  matchedRequests: number;
  createdEnrollments: number;
  createdExecutions: number;
}

/**
 * Restock Strategy (Handoff Page 13):
 * When sellable inventory transition occurs, joins open product requests to exact SKU.
 * Fans out safely to matching customers with occurrence: arrival:sku:day.
 */
export async function evaluateRestockEvent(
  event: DomainEvent<{ sku: string; title: string; pricePaise: number; stockCount: number }>
): Promise<RestockMatchResult> {
  const { tenantId, occurredAt, data } = event;
  const { sku, title, stockCount } = data;

  if (!sku || stockCount <= 0) {
    logger.info({ sku, stockCount }, 'Restock event ignored: zero or missing stock');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  // 1. Find active restock campaign
  const activeCampaign = await CampaignModel.findOne({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  if (!activeCampaign || !activeCampaign.activeVersionId) {
    logger.info({ tenantId }, 'No active campaign for restock event');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  const version = await CampaignVersionModel.findOne({
    id: activeCampaign.activeVersionId,
    tenantId
  }).lean();

  if (!version || version.trigger.eventType !== 'stock.published') {
    logger.info({ campaignId: activeCampaign.id }, 'Active campaign is not a restock trigger');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  // 2. Find open customer requests for this SKU
  const openRequests = await CustomerProductRequestModel.find({
    tenantId,
    sku,
    status: 'OPEN'
  }).lean();

  if (openRequests.length === 0) {
    logger.info({ sku }, 'No open customer requests for restocked SKU');
    return { sku, matchedRequests: 0, createdEnrollments: 0, createdExecutions: 0 };
  }

  let createdEnrollments = 0;
  let createdExecutions = 0;

  const dayString = new Date(occurredAt).toISOString().slice(0, 10);
  const occurrenceId = `restock:${sku}:${dayString}`;

  for (const req of openRequests) {
    const customer = await CustomerModel.findOne({
      id: req.customerId,
      tenantId,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false
    });

    if (!customer) continue;

    // Check duplicate enrollment for this restock event
    const existingEnrollment = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId: activeCampaign.id,
      customerId: customer.id,
      occurrenceId
    });

    let enrollmentId = existingEnrollment?.id;

    if (!existingEnrollment) {
      enrollmentId = generateId('enr');
      await CampaignEnrollmentModel.create({
        id: enrollmentId,
        tenantId,
        campaignId: activeCampaign.id,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId,
        sourceRef: {
          type: 'STOCK_EVENT',
          id: req.id,
          version: 1
        },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });
      createdEnrollments++;

      // Mark product request as notified
      await CustomerProductRequestModel.updateOne(
        { id: req.id },
        { $set: { status: 'NOTIFIED', notifiedAt: new Date() } }
      );
    }

    // Create execution for restock step
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
      const dueAt = new Date(); // Due immediately upon stock arrival
      const expiresAt = new Date(dueAt.getTime() + (stepDef.maxLatenessMinutes || 180) * 60 * 1000);

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId,
        campaignId: activeCampaign.id,
        stepId: stepDef.stepId,
        dueAt,
        expiresAt,
        localDate: dayString,
        localTime: '11:00',
        timezone: version.timezone || 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });
      createdExecutions++;
    }
  }

  logger.info(
    { sku, matched: openRequests.length, createdEnrollments, createdExecutions },
    'Processed restock matching event'
  );

  return {
    sku,
    matchedRequests: openRequests.length,
    createdEnrollments,
    createdExecutions
  };
}
