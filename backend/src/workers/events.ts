import { connectDatabase } from '../config/database';
import { CampaignEventInboxModel, ICampaignEventInbox } from '../modules/campaigns/models/CampaignEventInbox.model';
import { CampaignDeliveryIntentModel } from '../modules/campaigns/models/CampaignDeliveryIntent.model';
import { reconcileDeliveryStatus } from '../modules/campaigns/services/deliveryStatusReconciliation';
import { evaluateRestockEvent } from '../modules/campaigns/engine/restockStrategy';
import { evaluateEnquiryEvent } from '../modules/campaigns/engine/enquiryStrategy';
import { evaluateAlterationReadyEvent } from '../modules/campaigns/engine/boutiqueServiceStrategy';
import { evaluateOrderCompletedGoal } from '../modules/campaigns/engine/orderGoalEvaluator';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getEventDefinition } from '../shared/events/registry';

export interface EventConsumerCycleResult {
  processedCount: number;
  failedCount: number;
}

export const MAX_UNRESOLVED_INTENT_RETRIES = 5;
export const BASE_INTENT_RETRY_BACKOFF_MS = 5000;
export const MAX_INTENT_RETRY_BACKOFF_MS = 300000;

export function calculateIntentRetryBackoffMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount - 1);
  const backoff = BASE_INTENT_RETRY_BACKOFF_MS * Math.pow(2, exponent);
  return Math.min(backoff, MAX_INTENT_RETRY_BACKOFF_MS);
}

/**
 * Consumes and routes domain events from campaignEventInbox
 */
export async function processNextPendingEvent(
  tenantId: string
): Promise<ICampaignEventInbox | null> {
  const now = new Date();

  // Recover any stalled events that crashed during processing (> 5 minutes old)
  await CampaignEventInboxModel.updateMany(
    {
      tenantId,
      status: 'PROCESSING',
      updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) }
    },
    {
      $set: { status: 'RECEIVED', nextAttemptAt: now }
    }
  );

  // Recover FAILED events with bounded retries (< 5 attempts, > 2 minutes old)
  await CampaignEventInboxModel.updateMany(
    {
      tenantId,
      status: 'FAILED',
      retryCount: { $lt: 5 },
      updatedAt: { $lte: new Date(Date.now() - 2 * 60 * 1000) }
    },
    {
      $set: { status: 'RECEIVED', nextAttemptAt: now }
    }
  );

  // Exclude deferred events whose nextAttemptAt is scheduled for the future (P2: queue starvation prevention)
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
      $set: { status: 'PROCESSING' }
    },
    {
      sort: { receivedAt: 1 },
      new: true
    }
  );

  if (!event) return null;

  try {
    logger.info({ eventId: event.eventId, type: event.type }, 'Processing domain event');

    const eventDef = getEventDefinition(event.type);
    if (!eventDef) {
      event.status = 'QUARANTINE';
      event.errorMessage = `UNKNOWN_EVENT_TYPE: Event type '${event.type}' is not registered`;
      event.nextAttemptAt = null;
      await event.save();
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
            inboxEventId: event.id
          });
          if (!reconResult.reconciled) {
            event.status = 'FAILED';
            event.errorMessage = reconResult.details;
            event.retryCount = (event.retryCount || 0) + 1;
            event.nextAttemptAt = null;
            await event.save();
            return event;
          }
          event.entityId = intent.executionId;
        } else {
          // Intent not yet available (early webhook delivered before provider message ID persisted)
          const retries = (event.retryCount || 0) + 1;
          event.retryCount = retries;

          if (retries >= MAX_UNRESOLVED_INTENT_RETRIES) {
            // Move to terminal dead-letter quarantine after bounded attempts
            event.status = 'QUARANTINE';
            event.errorMessage = `Missing delivery intent for providerMessageId: ${providerMessageId} after ${retries} attempts; moved to dead-letter queue`;
            event.nextAttemptAt = null;
            await event.save();

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
          event.status = 'RECEIVED';
          event.nextAttemptAt = new Date(Date.now() + backoffMs);
          event.errorMessage = `Awaiting delivery intent association (attempt ${retries}/${MAX_UNRESOLVED_INTENT_RETRIES}, next attempt at ${event.nextAttemptAt.toISOString()})`;
          await event.save();

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

    event.status = 'PROCESSED';
    event.processedAt = new Date();
    event.nextAttemptAt = null;
    event.errorMessage = null;
    await event.save();

    logger.info({ eventId: event.eventId, type: event.type }, 'Successfully processed domain event');
  } catch (err: any) {
    logger.error({ err, eventId: event.eventId }, 'Error processing domain event');
    event.status = 'FAILED';
    event.errorMessage = err.message || 'Unknown processing error';
    event.retryCount = (event.retryCount || 0) + 1;
    event.nextAttemptAt = null;
    await event.save();
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

export async function startEventConsumerLoop(once: boolean = false): Promise<void> {
  logger.info('Starting Domain Event Consumer Worker...');
  await connectDatabase();

  const tenantId = env.DEFAULT_TENANT_ID;

  const cycle = async () => {
    try {
      const stats = await runEventConsumerCycle(tenantId, 10);
      if (stats.processedCount > 0 || stats.failedCount > 0) {
        logger.info(stats, 'Event consumer pass finished');
      }
    } catch (err) {
      logger.error({ err }, 'Error in event consumer cycle');
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
