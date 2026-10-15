import mongoose from 'mongoose';
import { CampaignExecutionModel, ICampaignExecution } from '../models/CampaignExecution.model';
import { CampaignDeliveryIntentModel, ICampaignDeliveryIntent } from '../models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { TenantControlGateModel } from '../models/TenantControlGate.model';
import { CampaignControlGateModel } from '../models/CampaignControlGate.model';
import { executePreflightSafeguards, PipelineOutcome } from './safeguards/safeguardPipeline';
import { checkAndReserveContactCapacity, updateContactReservationStatus } from './safeguards/contactCapResolver';
import { IWhatsAppDeliveryAdapter } from '../adapters/deliveryAdapter.interface';
import { getWhatsAppDeliveryAdapter } from '../adapters/adapterFactory';
import { encryptText, decryptText, sha256 } from '../../../shared/utils/crypto';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';
import { ulid } from 'ulid';

export interface DispatchCycleResult {
  claimedCount: number;
  acceptedCount: number;
  skippedCount: number;
  deferredCount: number;
  unknownCount: number;
  retryWaitCount: number;
  blockedCount: number;
  failedCount: number;
}

/**
 * Known Meta error codes for documented non-acceptance (Spec reference M4)
 * that are safe to retry under bounded exponential backoff (e.g. Rate limits, cloud API throughput).
 */
export function isRetryableThrottleError(errorCode?: string | null): boolean {
  if (!errorCode) return false;
  const retryableCodes = ['130429', '131056', '131048', '80007', '429', 'THROTTLED', 'RATE_LIMIT', 'TEMPORARY_UNAVAILABLE'];
  return retryableCodes.includes(String(errorCode));
}

/**
 * Atomically claims one due execution using an expiring lease token (Handoff Page 19 & 25).
 * Updates claimVersion, keeping planRevision strictly for replans (P1.a).
 */
export async function claimNextDueExecution(
  tenantId: string,
  serverNow: Date = new Date(),
  workerId: string = 'executor_worker'
): Promise<ICampaignExecution | null> {
  const leaseToken = ulid();
  const leaseDurationMs = 30 * 1000; // 30 seconds
  const leaseExpiry = new Date(serverNow.getTime() + leaseDurationMs);

  const claimed = await CampaignExecutionModel.findOneAndUpdate(
    {
      tenantId,
      state: { $in: ['SCHEDULED', 'DEFERRED', 'RETRY_WAIT'] },
      dueAt: { $lte: serverNow },
      $or: [{ 'lease.until': null }, { 'lease.until': { $lte: serverNow } }]
    },
    {
      $set: {
        state: 'EVALUATING',
        'lease.token': leaseToken,
        'lease.until': leaseExpiry,
        'lease.claimedBy': workerId
      },
      $inc: { claimVersion: 1 } // Increment claim fence counter; planRevision unchanged
    },
    {
      sort: { dueAt: 1 },
      new: true
    }
  );

  return claimed;
}

/**
 * Re-plans an execution schedule (e.g. date correction within year).
 * Fails CAS if execution was already claimed/evaluating or planRevision changed (B20).
 */
export async function replanExecution(
  tenantId: string,
  executionId: string,
  expectedPlanRevision: number,
  newDueAt: Date,
  newExpiresAt?: Date
): Promise<boolean> {
  const updated = await CampaignExecutionModel.findOneAndUpdate(
    {
      id: executionId,
      tenantId,
      deliveryIntentId: null, // Only replan executions before delivery intent exists (Page 20)
      planRevision: expectedPlanRevision,
      state: { $in: ['SCHEDULED', 'DEFERRED'] }
    },
    {
      $set: {
        dueAt: newDueAt,
        ...(newExpiresAt ? { expiresAt: newExpiresAt } : {})
      },
      $inc: { planRevision: 1 }
    },
    { new: true }
  );

  return Boolean(updated);
}

/**
 * Processes a claimed execution through preflight safeguards, atomic submission transaction,
 * WhatsApp delivery adapter, and delivery status correlation.
 */
export async function processClaimedExecution(
  execution: ICampaignExecution,
  adapter: IWhatsAppDeliveryAdapter = getWhatsAppDeliveryAdapter(),
  serverNow: Date = new Date()
): Promise<'ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'OUTCOME_UNKNOWN' | 'RETRY_WAIT' | 'BLOCKED' | 'FAILED'> {
  const { tenantId, id: executionId } = execution;

  try {
    // 1. Run Preflight Safeguards
    const outcome: PipelineOutcome = await executePreflightSafeguards(execution, serverNow);

    if (outcome.status === 'SKIP') {
      const skipped = await CampaignExecutionModel.findOneAndUpdate(
        {
          id: executionId,
          tenantId,
          claimVersion: execution.claimVersion,
          planRevision: execution.planRevision,
          'lease.token': execution.lease.token,
          'lease.until': { $gt: serverNow }
        },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: outcome.reason,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        },
        { new: true }
      );

      if (!skipped) {
        logger.warn({ executionId }, 'CAS Conflict: Execution modified or lease expired while evaluating SKIP');
        return 'FAILED';
      }

      logger.info({ executionId, reason: outcome.reason }, 'Execution skipped by preflight safeguard');
      return 'SKIPPED';
    }

    if (outcome.status === 'DEFER') {
      const deferred = await CampaignExecutionModel.findOneAndUpdate(
        {
          id: executionId,
          tenantId,
          claimVersion: execution.claimVersion,
          planRevision: execution.planRevision,
          'lease.token': execution.lease.token,
          'lease.until': { $gt: serverNow }
        },
        {
          $set: {
            state: 'DEFERRED',
            dueAt: outcome.nextDueAt,
            outcomeReason: outcome.reason,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        },
        { new: true }
      );

      if (!deferred) {
        logger.warn({ executionId }, 'CAS Conflict: Execution modified or lease expired while evaluating DEFER');
        return 'FAILED';
      }

      logger.info({ executionId, nextDueAt: outcome.nextDueAt, reason: outcome.reason }, 'Execution deferred');
      return 'DEFERRED';
    }

    if (outcome.status === 'BLOCKED') {
      const blocked = await CampaignExecutionModel.findOneAndUpdate(
        {
          id: executionId,
          tenantId,
          claimVersion: execution.claimVersion,
          planRevision: execution.planRevision,
          'lease.token': execution.lease.token,
          'lease.until': { $gt: serverNow }
        },
        {
          $set: {
            state: 'BLOCKED',
            outcomeReason: outcome.reason,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        },
        { new: true }
      );

      if (!blocked) {
        logger.warn({ executionId }, 'CAS Conflict: Execution modified or lease expired while evaluating BLOCKED');
        return 'FAILED';
      }

      logger.info({ executionId, reason: outcome.reason }, 'Execution blocked by safeguard');
      return 'BLOCKED';
    }

    // 2. Preflight passed -> PROCEED to ONE MongoDB Transaction (Handoff p.25, P1.b, P1.c)
    // Validate control generations + reserve contact capacity + freeze one delivery intent + mark DISPATCHING
    const { customer, version, campaign, parameters, payloadHash } = outcome;
    const stepDef = version.steps.find((s) => s.stepId === execution.stepId)!;
    const attemptId = `attempt_${ulid().toLowerCase()}`;
    const deliveryIntentId = execution.deliveryIntentId || generateId('di');

    let deliveryIntentDoc: ICampaignDeliveryIntent | null = null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Step A: Lock & Validate TenantControlGate (Consistent Lock Order: 1)
        let tenantGate = await TenantControlGateModel.findOne({ tenantId }).session(session);
        if (!tenantGate) {
          const created = await TenantControlGateModel.create(
            [{ id: generateId('tg'), tenantId, globalPause: false, gateVersion: 1 }],
            { session }
          );
          tenantGate = created[0];
        }
        if (tenantGate.globalPause) {
          throw new Error('CAMPAIGN_OR_GLOBAL_PAUSED');
        }

        // Step B: Lock & Validate CampaignControlGate (Consistent Lock Order: 2)
        let campaignGate = await CampaignControlGateModel.findOne({
          tenantId,
          campaignId: execution.campaignId
        }).session(session);

        if (!campaignGate) {
          const created = await CampaignControlGateModel.create(
            [{ id: generateId('cg'), tenantId, campaignId: execution.campaignId, paused: false, pauseGeneration: 0 }],
            { session }
          );
          campaignGate = created[0];
        }
        if (campaignGate.paused || campaignGate.pauseGeneration !== execution.pauseGeneration) {
          throw new Error('CAMPAIGN_OR_GLOBAL_PAUSED');
        }

        // Step C: Lock & Reserve Destination Contact Gate (Consistent Lock Order: 3)
        if (version.purpose === 'MARKETING') {
          const capResult = await checkAndReserveContactCapacity(
            tenantId,
            customer.phone,
            execution.campaignId,
            executionId,
            execution.expiresAt,
            version.priority,
            serverNow,
            session
          );

          if (!capResult.allowed) {
            throw new Error(capResult.reason || 'SKIPPED_CONTACT_CAP');
          }
        }

        // Step D: Freeze or reuse Delivery Intent
        deliveryIntentDoc = await CampaignDeliveryIntentModel.findOne({
          tenantId,
          executionId
        }).session(session);

        if (!deliveryIntentDoc) {
          const created = await CampaignDeliveryIntentModel.create(
            [
              {
                id: deliveryIntentId,
                tenantId,
                executionId,
                deliveryKey: executionId,
                connectionId: env.WHATSAPP_CONNECTION_ID,
                customerId: customer.id,
                recipientVersion: 1,
                encryptedRecipient: encryptText(customer.phone),
                templateRef: {
                  id: stepDef.templateRef.id,
                  revision: stepDef.templateRef.revision,
                  language: stepDef.templateRef.language
                },
                parameters,
                payloadHash,
                state: 'SUBMITTING',
                attemptId,
                providerMessageId: null,
                submittedAt: serverNow
              }
            ],
            { session }
          );
          deliveryIntentDoc = created[0];
        } else {
          // Reusing existing frozen intent for safe retry (C08, C20)
          deliveryIntentDoc.state = 'SUBMITTING';
          deliveryIntentDoc.attemptId = attemptId;
          deliveryIntentDoc.submittedAt = serverNow;
          await deliveryIntentDoc.save({ session });
        }

        // Step E: Mark Execution DISPATCHING with atomic CAS matching lease token, claimVersion, planRevision
        const dispatching = await CampaignExecutionModel.findOneAndUpdate(
          {
            id: executionId,
            tenantId,
            state: 'EVALUATING',
            claimVersion: execution.claimVersion,
            planRevision: execution.planRevision,
            'lease.token': execution.lease.token,
            'lease.until': { $gt: serverNow },
            expiresAt: { $gt: serverNow }
          },
          {
            $set: {
              state: 'DISPATCHING',
              deliveryIntentId: deliveryIntentDoc.id
            }
          },
          { session, new: true }
        );

        if (!dispatching) {
          throw new Error('LEASE_LOST_BEFORE_DISPATCH');
        }
      });
    } catch (txErr: any) {
      await session.endSession();

      const errMsg = txErr.message || '';
      logger.warn({ executionId, error: errMsg }, 'Submission transaction aborted and rolled back');

      if (errMsg === 'CAMPAIGN_OR_GLOBAL_PAUSED') {
        await CampaignExecutionModel.updateOne(
          { id: executionId, tenantId },
          {
            $set: {
              state: 'SKIPPED',
              outcomeReason: 'CAMPAIGN_OR_GLOBAL_PAUSED',
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          }
        );
        return 'SKIPPED';
      }

      if (errMsg === 'DEFERRED_CONTACT_CAP' || errMsg === 'SKIPPED_CONTACT_CAP') {
        await CampaignExecutionModel.updateOne(
          { id: executionId, tenantId },
          {
            $set: {
              state: errMsg === 'DEFERRED_CONTACT_CAP' ? 'DEFERRED' : 'SKIPPED',
              outcomeReason: errMsg,
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          }
        );
        return errMsg === 'DEFERRED_CONTACT_CAP' ? 'DEFERRED' : 'SKIPPED';
      }

      // Lease lost or expired CAS conflict
      return 'FAILED';
    }
    await session.endSession();

    // 3. Provider HTTP Call Outside the DB Transaction (Strict Rule, Handoff p.25)
    const sendResult = await adapter.sendCampaignStep({
      executionId,
      deliveryKey: executionId,
      connectionId: env.WHATSAPP_CONNECTION_ID,
      customerId: customer.id,
      recipientVersion: 1,
      template: {
        id: stepDef.templateRef.id,
        revision: stepDef.templateRef.revision,
        language: stepDef.templateRef.language
      },
      parameters,
      expiresAt: execution.expiresAt,
      recipientPhone: customer.phone
    });

    const refreshedIntent = (await CampaignDeliveryIntentModel.findOne({ tenantId, executionId })) || deliveryIntentDoc;

    // 4. Handle Adapter Response & Update States
    if (sendResult.state === 'ACCEPTED') {
      if (refreshedIntent) {
        refreshedIntent.state = 'ACCEPTED';
        refreshedIntent.providerMessageId = sendResult.providerMessageId || null;
        await refreshedIntent.save();
      }

      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, tenantId, state: 'DISPATCHING' },
        {
          $set: {
            state: 'PROVIDER_ACCEPTED',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        }
      );

      await updateContactReservationStatus(tenantId, customer.phone, executionId, 'ACCEPTED');
      logger.info({ executionId, providerId: sendResult.providerMessageId }, 'Message accepted by provider');

      // Check if a late status event already arrived before response persistence (Test C12)
      if (sendResult.providerMessageId) {
        const earlyStatus = await CampaignEventInboxModel.findOne({
          tenantId,
          type: { $in: ['whatsapp.status.delivered', 'whatsapp.status.read'] },
          'data.providerMessageId': sendResult.providerMessageId
        }).exec();

        if (earlyStatus) {
          const isRead = earlyStatus.type === 'whatsapp.status.read';
          await CampaignExecutionModel.updateOne(
            { id: executionId, tenantId },
            {
              $set: {
                state: isRead ? 'READ' : 'DELIVERED',
                deliveredAt: earlyStatus.occurredAt,
                readAt: isRead ? earlyStatus.occurredAt : null
              }
            }
          );
          if (refreshedIntent) {
            refreshedIntent.deliveredAt = earlyStatus.occurredAt;
            if (isRead) refreshedIntent.readAt = earlyStatus.occurredAt;
            await refreshedIntent.save();
          }
        }
      }

      return 'ACCEPTED';
    }

    if (sendResult.state === 'OUTCOME_UNKNOWN') {
      if (refreshedIntent) {
        refreshedIntent.state = 'OUTCOME_UNKNOWN';
        await refreshedIntent.save();
      }

      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, tenantId, state: 'DISPATCHING' },
        {
          $set: {
            state: 'OUTCOME_UNKNOWN',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        }
      );

      // Rule 3: An ambiguous send is never resubmitted, requeued or released from the contact cap!
      await updateContactReservationStatus(tenantId, customer.phone, executionId, 'UNKNOWN');
      logger.warn({ executionId }, 'Message outcome unknown; awaiting webhook correlation');
      return 'OUTCOME_UNKNOWN';
    }

    // Proven Non-Acceptance / Rejection
    // Release contact reservation on proven non-acceptance (Spec p.18, C08)
    await updateContactReservationStatus(tenantId, customer.phone, executionId, 'RELEASED');

    // Check if error is a documented retryable throttle/error (Spec reference M4, test C08)
    const isRetryable = isRetryableThrottleError(sendResult.errorCode);
    const MAX_RETRIES = 3;

    if (isRetryable && execution.retryCount < MAX_RETRIES) {
      // Exponential backoff: 60s, 120s, 240s
      const backoffMs = Math.min(30 * 60 * 1000, 60 * 1000 * Math.pow(2, execution.retryCount));
      const retryAt = new Date(serverNow.getTime() + backoffMs);

      // Test C09: Expiry reached during retry delay -> mark expired
      if (retryAt >= execution.expiresAt) {
        if (refreshedIntent) {
          refreshedIntent.state = 'REJECTED';
          refreshedIntent.errorCode = 'EXPIRED_DURING_RETRY';
          await refreshedIntent.save();
        }

        await CampaignExecutionModel.findOneAndUpdate(
          { id: executionId, tenantId, state: 'DISPATCHING' },
          {
            $set: {
              state: 'SKIPPED',
              outcomeReason: 'STEP_EXPIRED',
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          }
        );
        logger.info({ executionId }, 'Step expired during retry backoff interval');
        return 'SKIPPED';
      }

      // Enter RETRY_WAIT reusing the same frozen intent and delivery key (C08)
      if (refreshedIntent) {
        refreshedIntent.state = 'REJECTED';
        refreshedIntent.errorCode = sendResult.errorCode || 'THROTTLED';
        await refreshedIntent.save();
      }

      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, tenantId, state: 'DISPATCHING' },
        {
          $set: {
            state: 'RETRY_WAIT',
            dueAt: retryAt,
            retryAt,
            outcomeReason: 'RETRY_WAIT',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          },
          $inc: { retryCount: 1 }
        }
      );

      logger.info({ executionId, retryAt, retryCount: execution.retryCount + 1 }, 'Scheduled safe retry for throttled message');
      return 'RETRY_WAIT';
    }

    // Permanent Rejection
    if (refreshedIntent) {
      refreshedIntent.state = 'REJECTED';
      refreshedIntent.errorCode = sendResult.errorCode || 'UNKNOWN_ERROR';
      await refreshedIntent.save();
    }

    await CampaignExecutionModel.findOneAndUpdate(
      { id: executionId, tenantId, state: 'DISPATCHING' },
      {
        $set: {
          state: 'FAILED',
          outcomeReason: sendResult.errorCode || undefined,
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        }
      }
    );

    logger.error({ executionId, error: sendResult.errorMessage }, 'Message permanently rejected by provider');
    return 'FAILED';
  } catch (err) {
    logger.error({ err, executionId }, 'Unexpected error in dispatch execution; releasing lease');
    await CampaignExecutionModel.findOneAndUpdate(
      { id: executionId, 'lease.token': execution.lease.token },
      {
        $set: {
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        }
      }
    );
    return 'FAILED';
  }
}

/**
 * Runs a single polling cycle over due executions for one tenant
 */
export async function runDispatchCycle(
  tenantId: string,
  batchSize: number = 5,
  adapter: IWhatsAppDeliveryAdapter = getWhatsAppDeliveryAdapter(),
  serverNow: Date = new Date()
): Promise<DispatchCycleResult> {
  const result: DispatchCycleResult = {
    claimedCount: 0,
    acceptedCount: 0,
    skippedCount: 0,
    deferredCount: 0,
    unknownCount: 0,
    retryWaitCount: 0,
    blockedCount: 0,
    failedCount: 0
  };

  for (let i = 0; i < batchSize; i++) {
    const claimed = await claimNextDueExecution(tenantId, serverNow);
    if (!claimed) break;

    result.claimedCount++;
    const outcome = await processClaimedExecution(claimed, adapter, serverNow);

    if (outcome === 'ACCEPTED') result.acceptedCount++;
    else if (outcome === 'SKIPPED') result.skippedCount++;
    else if (outcome === 'DEFERRED') result.deferredCount++;
    else if (outcome === 'OUTCOME_UNKNOWN') result.unknownCount++;
    else if (outcome === 'RETRY_WAIT') result.retryWaitCount++;
    else if (outcome === 'BLOCKED') result.blockedCount++;
    else if (outcome === 'FAILED') result.failedCount++;
  }

  return result;
}

export interface SweepResult {
  reconciledAccepted: number;
  reconciledDelivered: number;
  stillUnknown: number;
}

export interface StaleDispatchSweepResult {
  movedToUnknown: number;
}

async function recipientPhoneOf(intent: ICampaignDeliveryIntent | null): Promise<string | null> {
  if (!intent?.encryptedRecipient) return null;
  try {
    return decryptText(intent.encryptedRecipient);
  } catch (err) {
    logger.warn({ err, executionId: intent.executionId }, 'Could not decrypt recipient for reservation update');
    return null;
  }
}

/**
 * Moves stale DISPATCHING attempts to OUTCOME_UNKNOWN (Handoff p.27, test C07).
 * A crashed worker is indistinguishable from a lost response, so the outcome is UNKNOWN, never requeued.
 * The contact reservation stays held; only proven non-acceptance may release it.
 */
export async function sweepStaleDispatching(
  tenantId: string,
  serverNow: Date = new Date(),
  requestDeadlineMs: number = 2 * 60 * 1000
): Promise<StaleDispatchSweepResult> {
  const result: StaleDispatchSweepResult = { movedToUnknown: 0 };
  const cutoff = new Date(serverNow.getTime() - requestDeadlineMs);

  const stale = await CampaignExecutionModel.find({
    tenantId,
    state: 'DISPATCHING',
    updatedAt: { $lte: cutoff }
  }).exec();

  for (const exec of stale) {
    const moved = await CampaignExecutionModel.findOneAndUpdate(
      { id: exec.id, tenantId, state: 'DISPATCHING' },
      {
        $set: {
          state: 'OUTCOME_UNKNOWN',
          outcomeReason: 'DISPATCH_INTERRUPTED',
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        }
      },
      { new: true }
    );
    if (!moved) continue;

    const intent = exec.deliveryIntentId
      ? await CampaignDeliveryIntentModel.findOne({ id: exec.deliveryIntentId, tenantId }).exec()
      : null;
    if (intent && intent.state === 'SUBMITTING') {
      intent.state = 'OUTCOME_UNKNOWN';
      await intent.save();
    }
    const phone = await recipientPhoneOf(intent);
    if (phone) await updateContactReservationStatus(tenantId, phone, exec.id, 'UNKNOWN');
    result.movedToUnknown++;
  }
  return result;
}

/**
 * Reconciles OUTCOME_UNKNOWN executions from provider EVIDENCE only (tests C06, C07, C12, C13).
 * NEVER requeues, retries, fails, or releases the contact reservation without evidence.
 */
export async function sweepOutcomeUnknownExecutions(
  tenantId: string,
  _serverNow: Date = new Date()
): Promise<SweepResult> {
  const result: SweepResult = { reconciledAccepted: 0, reconciledDelivered: 0, stillUnknown: 0 };
  const unknownExecutions = await CampaignExecutionModel.find({ tenantId, state: 'OUTCOME_UNKNOWN' }).exec();

  for (const exec of unknownExecutions) {
    const intent = exec.deliveryIntentId
      ? await CampaignDeliveryIntentModel.findOne({ id: exec.deliveryIntentId, tenantId }).exec()
      : null;
    if (!intent) {
      result.stillUnknown++;
      continue;
    }

    const phone = await recipientPhoneOf(intent);
    const byIntentReceipt = Boolean(intent.deliveredAt || intent.readAt);

    const statusEvent = byIntentReceipt
      ? null
      : await CampaignEventInboxModel.findOne({
          tenantId,
          type: { $in: ['whatsapp.status.delivered', 'whatsapp.status.read'] },
          $or: [
            { entityId: exec.id },
            { 'data.providerMessageId': intent.providerMessageId }
          ]
        }).sort({ occurredAt: -1 }).exec();

    if (byIntentReceipt || statusEvent) {
      const isRead = byIntentReceipt ? Boolean(intent.readAt) : statusEvent!.type === 'whatsapp.status.read';
      const deliveredAt = byIntentReceipt ? intent.deliveredAt ?? intent.readAt : statusEvent!.occurredAt;
      const moved = await CampaignExecutionModel.findOneAndUpdate(
        { id: exec.id, tenantId, state: 'OUTCOME_UNKNOWN' },
        {
          $set: {
            state: isRead ? 'READ' : 'DELIVERED',
            deliveredAt,
            readAt: isRead ? (byIntentReceipt ? intent.readAt : statusEvent!.occurredAt) : null,
            outcomeReason: null
          }
        }
      );
      if (moved) {
        if (phone) await updateContactReservationStatus(tenantId, phone, exec.id, 'ACCEPTED');
        result.reconciledDelivered++;
      }
      continue;
    }

    if (intent.state === 'ACCEPTED' && intent.providerMessageId) {
      const moved = await CampaignExecutionModel.findOneAndUpdate(
        { id: exec.id, tenantId, state: 'OUTCOME_UNKNOWN' },
        { $set: { state: 'PROVIDER_ACCEPTED', outcomeReason: null } }
      );
      if (moved) {
        if (phone) await updateContactReservationStatus(tenantId, phone, exec.id, 'ACCEPTED');
        result.reconciledAccepted++;
      }
      continue;
    }

    // No evidence: stays OUTCOME_UNKNOWN, reservation stays held, nothing is resubmitted.
    result.stillUnknown++;
  }
  return result;
}
