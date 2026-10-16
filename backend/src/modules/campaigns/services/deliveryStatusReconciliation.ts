import mongoose, { ClientSession } from 'mongoose';
import { CampaignDeliveryIntentModel, ICampaignDeliveryIntent } from '../models/CampaignDeliveryIntent.model';
import { CampaignExecutionModel, ICampaignExecution } from '../models/CampaignExecution.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { logger } from '../../../config/logger';

export type DeliveryWebhookStatus = 'delivered' | 'read' | 'failed';

export interface ReconcileDeliveryStatusParams {
  tenantId: string;
  providerMessageId: string;
  status: DeliveryWebhookStatus;
  providerTimestamp?: Date;
  errorCode?: string;
  errorReason?: string;
  existingSession?: ClientSession;
  inboxEventId?: string;
  claimToken?: string;
}

export interface ReconcileDeliveryStatusResult {
  reconciled: boolean;
  intent: ICampaignDeliveryIntent | null;
  execution: ICampaignExecution | null;
  policyResult:
    | 'TRANSITIONED'
    | 'MONOTONIC_PRESERVED'
    | 'TERMINAL_PRESERVED'
    | 'INTENT_NOT_FOUND'
    | 'EXECUTION_NOT_FOUND';
  details: string;
}

/**
 * Unified Transition Policy for CampaignDeliveryIntent and CampaignExecution records.
 *
 * Enforces:
 * 1. Monotonic state progression: IN-FLIGHT -> DELIVERED -> READ.
 * 2. Terminal failure protection: FAILED / REJECTED records cannot be resurrected to DELIVERED / READ.
 * 3. Terminal skip/expiry protection: SKIPPED / EXPIRED records cannot transition to DELIVERED / READ.
 * 4. Terminal delivery protection: DELIVERED / READ records cannot regress to FAILED / REJECTED.
 * 5. Monotonic ordering: READ cannot regress to DELIVERED.
 * 6. Atomicity: Both execution and intent are updated in lockstep inside a MongoDB transaction.
 * 7. Durable Webhook Inbox Lifecycle: If an inboxEventId is provided, the inbox event is atomically
 *    marked PROCESSED inside the exact same transaction committing the delivery state transition.
 */
async function reconcileDeliveryStatusAttempt(
  params: ReconcileDeliveryStatusParams
): Promise<ReconcileDeliveryStatusResult> {
  const {
    tenantId,
    providerMessageId,
    status,
    providerTimestamp = new Date(),
    errorCode,
    errorReason,
    existingSession,
    inboxEventId,
    claimToken
  } = params;

  const session = existingSession || (await mongoose.startSession());
  const isSelfManaged = !existingSession;

  if (isSelfManaged) {
    session.startTransaction();
  }

  try {
    // 1. Locate the delivery intent strictly scoped by providerMessageId and tenantId (no unscoped fallback)
    const intent = await CampaignDeliveryIntentModel.findOne({
      providerMessageId,
      tenantId
    }).session(session);

    if (!intent) {
      if (isSelfManaged) await session.abortTransaction();
      return {
        reconciled: false,
        intent: null,
        execution: null,
        policyResult: 'INTENT_NOT_FOUND',
        details: `No delivery intent found for providerMessageId: ${providerMessageId} in tenant: ${tenantId}`
      };
    }

    // 2. Locate the associated campaign execution
    const execution = await CampaignExecutionModel.findOne({
      id: intent.executionId,
      tenantId: intent.tenantId
    }).session(session);

    if (!execution) {
      if (isSelfManaged) await session.abortTransaction();
      return {
        reconciled: false,
        intent,
        execution: null,
        policyResult: 'EXECUTION_NOT_FOUND',
        details: `No campaign execution found for delivery intent: ${intent.id}`
      };
    }

    const currentIntentState = intent.state;
    const currentExecState = execution.state;

    const markInboxProcessed = async () => {
      if (!inboxEventId) return;
      const filter: any = { id: inboxEventId, tenantId: intent.tenantId };
      if (claimToken) {
        filter.claimToken = claimToken;
      }
      const res = await CampaignEventInboxModel.updateOne(
        filter,
        {
          $set: {
            status: 'PROCESSED',
            entityId: execution.id,
            processedAt: new Date(),
            nextAttemptAt: null,
            errorMessage: null,
            claimToken: null,
            claimedUntil: null
          }
        }
      ).session(session);

      if (claimToken && res.matchedCount === 0) {
        throw new Error(`LEASE_LOST: Inbox event ${inboxEventId} claim token was expired or reclaimed by another worker`);
      }
    };

    const commitAndReturn = async (result: ReconcileDeliveryStatusResult): Promise<ReconcileDeliveryStatusResult> => {
      if (result.reconciled) {
        await markInboxProcessed();
      }
      if (isSelfManaged) {
        await session.commitTransaction();
      }
      return result;
    };

    // -------------------------------------------------------------
    // POLICY RULE 1: Terminal Non-Delivery States (FAILED, REJECTED, SKIPPED, EXPIRED, BLOCKED)
    // -------------------------------------------------------------
    // If either record is already in a terminal non-delivery state, late delivery webhooks
    // (delivered/read/failed) MUST NOT resurrect or transition either record to DELIVERED or READ.
    // Both records must be kept consistently aligned in their terminal state.
    const isTerminalFailure = currentExecState === 'FAILED' || currentIntentState === 'REJECTED';
    const isTerminalSkippedOrExpired = currentExecState === 'SKIPPED' || currentIntentState === 'EXPIRED';
    const isTerminalBlocked = currentExecState === 'BLOCKED';

    if (isTerminalFailure) {
      let modified = false;
      if (intent.state !== 'REJECTED') {
        intent.state = 'REJECTED';
        intent.errorCode = errorCode || intent.errorCode || 'PRESERVED_TERMINAL_FAILURE';
        modified = true;
      }
      if (execution.state !== 'FAILED') {
        execution.state = 'FAILED';
        execution.outcomeReason = errorReason || execution.outcomeReason || 'PRESERVED_TERMINAL_FAILURE';
        modified = true;
      }
      if (modified) {
        await intent.save({ session });
        await execution.save({ session });
      }
      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: 'TERMINAL_PRESERVED',
        details: 'Preserved terminal FAILED/REJECTED state; rejected resurrection to DELIVERED/READ'
      });
    }

    if (isTerminalSkippedOrExpired) {
      let modified = false;
      if (execution.state !== 'SKIPPED') {
        execution.state = 'SKIPPED';
        modified = true;
      }
      if (intent.state !== 'EXPIRED') {
        intent.state = 'EXPIRED';
        modified = true;
      }
      if (modified) {
        await intent.save({ session });
        await execution.save({ session });
      }
      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: 'TERMINAL_PRESERVED',
        details: 'Preserved terminal SKIPPED/EXPIRED state; rejected resurrection to DELIVERED/READ'
      });
    }

    if (isTerminalBlocked) {
      let modified = false;
      if (execution.state !== 'BLOCKED') {
        execution.state = 'BLOCKED';
        execution.outcomeReason = execution.outcomeReason || 'BLOCKED_BY_POLICY';
        modified = true;
      }
      // An execution that is blocked cannot be delivered; its delivery intent must be paired to REJECTED
      if (intent.state !== 'REJECTED') {
        intent.state = 'REJECTED';
        intent.errorCode = errorCode || intent.errorCode || 'EXECUTION_BLOCKED';
        modified = true;
      }
      if (modified) {
        await intent.save({ session });
        await execution.save({ session });
      }
      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: 'TERMINAL_PRESERVED',
        details: 'Preserved terminal BLOCKED execution and synchronized delivery intent to REJECTED'
      });
    }

    // -------------------------------------------------------------
    // POLICY RULE 2: Incoming Status is 'failed'
    // -------------------------------------------------------------
    if (status === 'failed') {
      // If the message has already achieved delivery (DELIVERED or READ),
      // late or out-of-order failure cannot regress the delivery confirmation.
      if (
        currentExecState === 'DELIVERED' ||
        currentExecState === 'READ' ||
        currentIntentState === 'DELIVERED' ||
        currentIntentState === 'READ'
      ) {
        return await commitAndReturn({
          reconciled: true,
          intent,
          execution,
          policyResult: 'MONOTONIC_PRESERVED',
          details: 'Protected delivered/read state against late provider failure event'
        });
      }

      // In-flight execution transitioning to failure
      intent.state = 'REJECTED';
      intent.errorCode = errorCode || 'PROVIDER_DELIVERY_FAILED';
      await intent.save({ session });

      execution.state = 'FAILED';
      execution.outcomeReason = errorReason || errorCode || 'PROVIDER_DELIVERY_FAILED';
      execution.lease = { token: null, until: null, claimedBy: null };
      await execution.save({ session });

      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: 'TRANSITIONED',
        details: 'Transitioned in-flight execution and delivery intent to FAILED/REJECTED'
      });
    }

    // -------------------------------------------------------------
    // POLICY RULE 3: Incoming Status is 'read'
    // -------------------------------------------------------------
    if (status === 'read') {
      // READ is the highest delivery state in monotonic ordering
      intent.state = 'READ';
      intent.readAt = intent.readAt || providerTimestamp;
      if (!intent.deliveredAt && execution.deliveredAt) {
        intent.deliveredAt = execution.deliveredAt;
      }
      await intent.save({ session });

      const wasAlreadyRead = currentExecState === 'READ' && currentIntentState === 'READ';
      execution.state = 'READ';
      execution.readAt = execution.readAt || providerTimestamp;
      if (!execution.deliveredAt && intent.deliveredAt) {
        execution.deliveredAt = intent.deliveredAt;
      }
      execution.lease = { token: null, until: null, claimedBy: null };
      await execution.save({ session });

      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: wasAlreadyRead ? 'MONOTONIC_PRESERVED' : 'TRANSITIONED',
        details: wasAlreadyRead
          ? 'Preserved READ state; updated timestamps'
          : 'Monotonically transitioned execution and delivery intent to READ'
      });
    }

    // -------------------------------------------------------------
    // POLICY RULE 4: Incoming Status is 'delivered'
    // -------------------------------------------------------------
    if (status === 'delivered') {
      // If either record is already READ, READ > DELIVERED. Do NOT regress to DELIVERED!
      if (currentExecState === 'READ' || currentIntentState === 'READ') {
        let modified = false;
        if (!intent.deliveredAt) {
          intent.deliveredAt = providerTimestamp;
          modified = true;
        }
        if (intent.state !== 'READ') {
          intent.state = 'READ';
          modified = true;
        }
        if (!execution.deliveredAt) {
          execution.deliveredAt = providerTimestamp;
          modified = true;
        }
        if (execution.state !== 'READ') {
          execution.state = 'READ';
          modified = true;
        }
        if (modified) {
          await intent.save({ session });
          await execution.save({ session });
        }
        return await commitAndReturn({
          reconciled: true,
          intent,
          execution,
          policyResult: 'MONOTONIC_PRESERVED',
          details: 'Preserved terminal READ state; updated deliveredAt timestamp without regressing state'
        });
      }

      // If already DELIVERED on both, maintain DELIVERED and update deliveredAt
      const wasAlreadyDelivered = currentExecState === 'DELIVERED' && currentIntentState === 'DELIVERED';
      intent.state = 'DELIVERED';
      intent.deliveredAt = intent.deliveredAt || providerTimestamp;
      await intent.save({ session });

      execution.state = 'DELIVERED';
      execution.deliveredAt = execution.deliveredAt || providerTimestamp;
      execution.lease = { token: null, until: null, claimedBy: null };
      await execution.save({ session });

      return await commitAndReturn({
        reconciled: true,
        intent,
        execution,
        policyResult: wasAlreadyDelivered ? 'MONOTONIC_PRESERVED' : 'TRANSITIONED',
        details: wasAlreadyDelivered
          ? 'Preserved DELIVERED state; updated timestamp'
          : 'Monotonically transitioned execution and delivery intent to DELIVERED'
      });
    }

    return await commitAndReturn({
      reconciled: true,
      intent,
      execution,
      policyResult: 'MONOTONIC_PRESERVED',
      details: `No state change for status: ${status}`
    });
  } catch (err: any) {
    if (isSelfManaged) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        logger.error({ abortErr }, 'Error aborting delivery status reconciliation transaction');
      }
    }
    logger.error({ err, providerMessageId, status }, 'Failed to reconcile delivery status');
    throw err;
  } finally {
    if (isSelfManaged) {
      await session.endSession();
    }
  }
}

/**
 * Resilient exported wrapper for delivery status reconciliation with automatic retries on transient transaction conflicts
 */
export async function reconcileDeliveryStatus(
  params: ReconcileDeliveryStatusParams
): Promise<ReconcileDeliveryStatusResult> {
  const maxRetries = params.existingSession ? 1 : 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await reconcileDeliveryStatusAttempt(params);
    } catch (err: any) {
      lastError = err;
      const isTransient =
        err?.errorLabels?.has?.('TransientTransactionError') ||
        (Array.isArray(err?.errorResponse?.errorLabels) && err.errorResponse.errorLabels.includes('TransientTransactionError')) ||
        err?.code === 112 ||
        err?.codeName === 'WriteConflict' ||
        (typeof err?.message === 'string' && (err.message.includes('catalog changes') || err.message.includes('TransientTransactionError')));

      if (isTransient && attempt < maxRetries) {
        logger.warn(
          { attempt, providerMessageId: params.providerMessageId, err: err.message },
          'Transient transaction error in reconcileDeliveryStatus; retrying'
        );
        await new Promise((r) => setTimeout(r, 60 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
