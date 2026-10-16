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

export interface EventConsumerCycleResult {
  processedCount: number;
  failedCount: number;
}

/**
 * Consumes and routes domain events from campaignEventInbox
 */
export async function processNextPendingEvent(
  tenantId: string
): Promise<ICampaignEventInbox | null> {
  // Recover any stalled events that crashed during processing (> 5 minutes old)
  await CampaignEventInboxModel.updateMany(
    {
      tenantId,
      status: 'PROCESSING',
      updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) }
    },
    {
      $set: { status: 'RECEIVED' }
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
      $set: { status: 'RECEIVED' }
    }
  );

  const event = await CampaignEventInboxModel.findOneAndUpdate(
    {
      tenantId,
      status: 'RECEIVED'
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

    if (event.type === 'stock.published') {
      await evaluateRestockEvent(event as any);
    } else if (event.type === 'enquiry.received') {
      await evaluateEnquiryEvent(event as any);
    } else if (event.type === 'alteration.completed') {
      await evaluateAlterationReadyEvent(event as any);
    } else if (event.type === 'order.completed') {
      await evaluateOrderCompletedGoal({
        tenantId: event.tenantId,
        customerId: event.customerId,
        orderId: event.entityId,
        occasionRef: event.data?.occasionRef,
        netPaise: event.data?.netPaise
      });
    } else if (event.type.startsWith('whatsapp.status.')) {
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
            await event.save();
            return event;
          }
          event.entityId = intent.executionId;
        } else {
          // Intent not yet available (out-of-order delivery); return to RECEIVED for next cycle
          event.status = 'RECEIVED';
          await event.save();
          return event;
        }
      }
    }

    event.status = 'PROCESSED';
    event.processedAt = new Date();
    await event.save();

    logger.info({ eventId: event.eventId, type: event.type }, 'Successfully processed domain event');
  } catch (err: any) {
    logger.error({ err, eventId: event.eventId }, 'Error processing domain event');
    event.status = 'FAILED';
    event.errorMessage = err.message || 'Unknown processing error';
    event.retryCount = (event.retryCount || 0) + 1;
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
