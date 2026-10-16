import { connectDatabase } from '../config/database';
import { CampaignEventInboxModel, ICampaignEventInbox } from '../modules/campaigns/models/CampaignEventInbox.model';
import { CampaignDeliveryIntentModel } from '../modules/campaigns/models/CampaignDeliveryIntent.model';
import { TenantSettingsModel } from '../modules/campaigns/models/TenantSettings.model';
import { TenantConnectionModel } from '../modules/campaigns/models/TenantConnection.model';
import { reconcileDeliveryStatus } from '../modules/campaigns/services/deliveryStatusReconciliation';
import { evaluateRestockEvent } from '../modules/campaigns/engine/restockStrategy';
import { evaluateEnquiryEvent } from '../modules/campaigns/engine/enquiryStrategy';
import { evaluateAlterationReadyEvent } from '../modules/campaigns/engine/boutiqueServiceStrategy';
import { evaluateOrderCompletedGoal } from '../modules/campaigns/engine/orderGoalEvaluator';
import { generateId } from '../shared/utils/id';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getEventDefinition } from '../shared/events/registry';

export interface EventConsumerCycleResult {
  processedCount: number;
  failedCount: number;
}

export interface TenantBacklogMetrics {
  tenantId: string;
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  quarantineCount: number;
  oldestPendingAgeMs: number | null;
}

export const MAX_UNRESOLVED_INTENT_RETRIES = 5;
export const BASE_INTENT_RETRY_BACKOFF_MS = 5000;
export const MAX_INTENT_RETRY_BACKOFF_MS = 300000;
export const INBOX_LEASE_DURATION_MS = 60000; // 60 seconds

export function calculateIntentRetryBackoffMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount - 1);
  const backoff = BASE_INTENT_RETRY_BACKOFF_MS * Math.pow(2, exponent);
  return Math.min(backoff, MAX_INTENT_RETRY_BACKOFF_MS);
}

/**
 * Calculates operational backlog metrics for a tenant's domain event queue (Requirement 10)
 */
export async function getTenantBacklogMetrics(tenantId: string): Promise<TenantBacklogMetrics> {
  const [counts, oldest] = await Promise.all([
    CampaignEventInboxModel.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    CampaignEventInboxModel.findOne(
      { tenantId, status: 'RECEIVED' },
      { receivedAt: 1 }
    ).sort({ receivedAt: 1 }).lean()
  ]);

  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c._id] = c.count;
  }

  const oldestPendingAgeMs = oldest?.receivedAt
    ? Math.max(0, Date.now() - new Date(oldest.receivedAt).getTime())
    : null;

  return {
    tenantId,
    pendingCount: countMap['RECEIVED'] || 0,
    processingCount: countMap['PROCESSING'] || 0,
    failedCount: countMap['FAILED'] || 0,
    quarantineCount: countMap['QUARANTINE'] || 0,
    oldestPendingAgeMs
  };
}

/**
 * Discovers distinct tenants with pending inbox events or active tenant settings
 * to guarantee fair multi-tenant worker scheduling (Handoff p.28, Requirement 3)
 */
export async function getActiveEventTenants(): Promise<string[]> {
  const [pendingTenants, provisionedTenants, connectionTenants] = await Promise.all([
    CampaignEventInboxModel.distinct('tenantId', {
      status: { $in: ['RECEIVED', 'FAILED', 'PROCESSING'] }
    }),
    TenantSettingsModel.distinct('tenantId'),
    TenantConnectionModel.distinct('tenantId', { status: 'ACTIVE' })
  ]);

  const allTenants = Array.from(
    new Set([
      ...pendingTenants,
      ...provisionedTenants,
      ...connectionTenants,
      ...(env.DEFAULT_TENANT_ID ? [env.DEFAULT_TENANT_ID] : [])
    ])
  ).filter(Boolean);

  return allTenants;
}

/**
 * Consumes and routes domain events from campaignEventInbox for a specific tenant
 * using atomic lease claims and safe crash recovery.
 */
export async function processNextPendingEvent(
  tenantId: string
): Promise<ICampaignEventInbox | null> {
  const now = new Date();
  const claimToken = generateId('claim');
  const claimedUntil = new Date(Date.now() + INBOX_LEASE_DURATION_MS);

  // 1. Recover stalled events whose lease expired (crashed worker recovery)
  await CampaignEventInboxModel.updateMany(
    {
      tenantId,
      status: 'PROCESSING',
      $or: [
        { claimedUntil: { $lte: now } },
        { claimedUntil: null, updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } }
      ]
    },
    {
      $set: { status: 'RECEIVED', nextAttemptAt: now, claimToken: null, claimedUntil: null }
    }
  );

  // 2. Recover FAILED events with bounded retries (< 5 attempts, > 2 minutes old)
  await CampaignEventInboxModel.updateMany(
    {
      tenantId,
      status: 'FAILED',
      retryCount: { $lt: 5 },
      updatedAt: { $lte: new Date(Date.now() - 2 * 60 * 1000) }
    },
    {
      $set: { status: 'RECEIVED', nextAttemptAt: now, claimToken: null, claimedUntil: null }
    }
  );

  // 3. Atomic lease claim: find one eligible RECEIVED event
  const event = await CampaignEventInboxModel.findOneAndUpdate(
    {
      tenantId,
      status: 'RECEIVED',
      $or: [
        { nextAttemptAt: null },
        { nextAttemptAt: { $exists: false } },
        { nextAttemptAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'PROCESSING',
        claimToken,
        claimedUntil
      }
    },
    {
      sort: { receivedAt: 1 },
      new: true
    }
  );

  if (!event) return null;

  try {
    logger.info({ eventId: event.eventId, type: event.type, tenantId }, 'Processing domain event');

    const eventDef = getEventDefinition(event.type);
    if (!eventDef) {
      await CampaignEventInboxModel.updateOne(
        { id: event.id, tenantId, claimToken },
        {
          $set: {
            status: 'QUARANTINE',
            errorMessage: `UNKNOWN_EVENT_TYPE: Event type '${event.type}' is not registered`,
            nextAttemptAt: null,
            claimToken: null,
            claimedUntil: null
          }
        }
      );
      event.status = 'QUARANTINE';
      event.errorMessage = `UNKNOWN_EVENT_TYPE: Event type '${event.type}' is not registered`;
      event.nextAttemptAt = null;
      logger.warn({ eventId: event.eventId, type: event.type }, 'Moved unknown event to QUARANTINE');
      return event;
    }

    if (event.type.startsWith('whatsapp.status.')) {
      const { providerMessageId, status, errorCode, errorReason } = event.data || {};
      if (providerMessageId && status) {
        const intent = await CampaignDeliveryIntentModel.findOne({
          providerMessageId,
          tenantId: event.tenantId
        });
        if (intent) {
          const reconResult = await reconcileDeliveryStatus({
            tenantId: event.tenantId,
            providerMessageId,
            status,
            providerTimestamp: event.occurredAt || new Date(),
            errorCode: errorCode || 'PROVIDER_DELIVERY_FAILED',
            errorReason: errorReason || 'PROVIDER_DELIVERY_FAILED',
            inboxEventId: event.id,
            claimToken
          });
          if (!reconResult.reconciled) {
            await CampaignEventInboxModel.updateOne(
              { id: event.id, tenantId, claimToken, status: { $ne: 'PROCESSED' } },
              {
                $set: {
                  status: 'FAILED',
                  errorMessage: reconResult.details,
                  nextAttemptAt: null,
                  claimToken: null,
                  claimedUntil: null
                },
                $inc: { retryCount: 1 }
              }
            );
            event.status = 'FAILED';
            event.errorMessage = reconResult.details;
            event.retryCount = (event.retryCount || 0) + 1;
            event.nextAttemptAt = null;
            return event;
          }
          event.entityId = intent.executionId;
          event.status = 'PROCESSED';
          event.processedAt = new Date();
          event.nextAttemptAt = null;
          event.errorMessage = null;

          logger.info({ eventId: event.eventId, type: event.type }, 'Successfully processed domain event via delivery reconciliation');
          return event;
        } else {
          // Intent not yet available (early webhook delivered before provider message ID persisted)
          const retries = (event.retryCount || 0) + 1;
          event.retryCount = retries;

          if (retries >= MAX_UNRESOLVED_INTENT_RETRIES) {
            // Move to terminal dead-letter quarantine after bounded attempts
            await CampaignEventInboxModel.updateOne(
              { id: event.id, tenantId, claimToken, status: { $ne: 'PROCESSED' } },
              {
                $set: {
                  status: 'QUARANTINE',
                  errorMessage: `Missing delivery intent for providerMessageId: ${providerMessageId} after ${retries} attempts; moved to dead-letter queue`,
                  nextAttemptAt: null,
                  retryCount: retries,
                  claimToken: null,
                  claimedUntil: null
                }
              }
            );
            event.status = 'QUARANTINE';
            event.errorMessage = `Missing delivery intent for providerMessageId: ${providerMessageId} after ${retries} attempts; moved to dead-letter queue`;
            event.nextAttemptAt = null;

            logger.warn(
              {
                inboxId: event.id,
                eventId: event.eventId,
                providerMessageId,
                tenantId: event.tenantId,
                retryCount: retries
              },
              'Early webhook status receipt reached maximum retry attempts with no matching intent. Moved to QUARANTINE dead-letter queue.'
            );
            return event;
          }

          // Defer next attempt with exponential backoff so subsequent queue events are not starved
          const backoffMs = calculateIntentRetryBackoffMs(retries);
          const nextAttemptAt = new Date(Date.now() + backoffMs);
          const errMsg = `Awaiting delivery intent association (attempt ${retries}/${MAX_UNRESOLVED_INTENT_RETRIES}, next attempt at ${nextAttemptAt.toISOString()})`;

          await CampaignEventInboxModel.updateOne(
            { id: event.id, tenantId, claimToken, status: { $ne: 'PROCESSED' } },
            {
              $set: {
                status: 'RECEIVED',
                nextAttemptAt,
                errorMessage: errMsg,
                retryCount: retries,
                claimToken: null,
                claimedUntil: null
              }
            }
          );

          event.status = 'RECEIVED';
          event.nextAttemptAt = nextAttemptAt;
          event.errorMessage = errMsg;

          logger.info(
            {
              inboxId: event.id,
              eventId: event.eventId,
              providerMessageId,
              tenantId: event.tenantId,
              retryCount: retries,
              nextAttemptAt: event.nextAttemptAt
            },
            'Early webhook status receipt missing delivery intent; deferred with backoff to prevent queue starvation'
          );
          return event;
        }
      }
    } else {
      await eventDef.evaluator(event);
    }

    // Atomically mark PROCESSED (strictly fenced by claimToken)
    const procRes = await CampaignEventInboxModel.updateOne(
      { id: event.id, tenantId, claimToken },
      {
        $set: {
          status: 'PROCESSED',
          processedAt: new Date(),
          nextAttemptAt: null,
          errorMessage: null,
          claimToken: null,
          claimedUntil: null
        }
      }
    );

    if (procRes.matchedCount === 0) {
      logger.warn(
        { eventId: event.eventId, claimToken, tenantId },
        'Lease expired or reclaimed by another worker; stale worker completion write rejected'
      );
      return null;
    }

    event.status = 'PROCESSED';
    event.processedAt = new Date();
    event.nextAttemptAt = null;
    event.errorMessage = null;

    logger.info({ eventId: event.eventId, type: event.type }, 'Successfully processed domain event');
  } catch (err: any) {
    logger.error({ err, eventId: event.eventId }, 'Error processing domain event');
    // Ensure failure never overwrites an active claim from another worker or an already PROCESSED event
    const failRes = await CampaignEventInboxModel.updateOne(
      { id: event.id, tenantId, claimToken, status: { $ne: 'PROCESSED' } },
      {
        $set: {
          status: 'FAILED',
          errorMessage: err.message || 'Unknown processing error',
          nextAttemptAt: null,
          claimToken: null,
          claimedUntil: null
        },
        $inc: { retryCount: 1 }
      }
    );

    if (failRes.matchedCount === 0) {
      logger.warn(
        { eventId: event.eventId, claimToken, tenantId },
        'Lease expired or reclaimed by another worker; stale worker failure write rejected'
      );
      return null;
    }

    event.status = 'FAILED';
    event.errorMessage = err.message || 'Unknown processing error';
    event.retryCount = (event.retryCount || 0) + 1;
    event.nextAttemptAt = null;
  }

  return event;
}

export async function runEventConsumerCycle(tenantId: string, batchSize: number = 5): Promise<EventConsumerCycleResult> {
  let processedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < batchSize; i++) {
    const event = await processNextPendingEvent(tenantId);
    if (!event) break;

    if (event.status === 'PROCESSED') processedCount++;
    else if (event.status === 'FAILED') failedCount++;
  }

  return { processedCount, failedCount };
}

/**
 * Runs one fair round-robin pass across all active tenants (Requirement 3)
 */
export async function runMultiTenantEventCycle(batchPerTenant: number = 5): Promise<{
  tenantsProcessed: number;
  totalProcessed: number;
  totalFailed: number;
}> {
  const tenants = await getActiveEventTenants();
  let totalProcessed = 0;
  let totalFailed = 0;

  for (const tenantId of tenants) {
    const metrics = await getTenantBacklogMetrics(tenantId);
    if (metrics.pendingCount > 0 || metrics.failedCount > 0) {
      logger.info(
        {
          tenantId,
          pending: metrics.pendingCount,
          processing: metrics.processingCount,
          failed: metrics.failedCount,
          quarantine: metrics.quarantineCount,
          oldestAgeMs: metrics.oldestPendingAgeMs
        },
        'Tenant domain event inbox backlog status'
      );
    }

    const stats = await runEventConsumerCycle(tenantId, batchPerTenant);
    totalProcessed += stats.processedCount;
    totalFailed += stats.failedCount;
  }

  return {
    tenantsProcessed: tenants.length,
    totalProcessed,
    totalFailed
  };
}

export async function startEventConsumerLoop(once: boolean = false): Promise<void> {
  logger.info('Starting Multi-Tenant Domain Event Consumer Worker (Tenant-Fair Scheduler)...');
  await connectDatabase();

  const cycle = async () => {
    try {
      const summary = await runMultiTenantEventCycle(10);
      if (summary.totalProcessed > 0 || summary.totalFailed > 0) {
        logger.info(summary, 'Multi-tenant event consumer cycle completed');
      }
    } catch (err) {
      logger.error({ err }, 'Error in multi-tenant event consumer cycle');
    }
  };

  await cycle();

  if (!once) {
    setInterval(cycle, 5000);
  }
}

if (require.main === module) {
  startEventConsumerLoop().catch((err) => {
    logger.fatal({ err }, 'Fatal crash in event consumer worker');
    process.exit(1);
  });
}
