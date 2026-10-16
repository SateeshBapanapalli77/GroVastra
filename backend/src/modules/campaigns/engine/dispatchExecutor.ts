import mongoose from 'mongoose';
import { CampaignExecutionModel, ICampaignExecution } from '../models/CampaignExecution.model';
import { CampaignDeliveryIntentModel, ICampaignDeliveryIntent } from '../models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { TenantControlGateModel } from '../models/TenantControlGate.model';
import { CampaignControlGateModel } from '../models/CampaignControlGate.model';
import { TenantConnectionModel } from '../models/TenantConnection.model';
import { executePreflightSafeguards, PipelineOutcome } from './safeguards/safeguardPipeline';
import {
  checkAndReserveContactCapacity,
  updateContactReservationStatus,
  ContactCapExceededError
} from './safeguards/contactCapResolver';
export { ContactCapExceededError } from './safeguards/contactCapResolver';
import { ProductModel } from '../../inventory/models/Product.model';
import { IWhatsAppDeliveryAdapter } from '../adapters/deliveryAdapter.interface';
import { getWhatsAppDeliveryAdapter } from '../adapters/adapterFactory';
import { encryptText, decryptText, sha256 } from '../../../shared/utils/crypto';
import { generateId } from '../../../shared/utils/id';
import { reconcileDeliveryStatus } from '../services/deliveryStatusReconciliation';
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
      $or: [
        {
          state: { $in: ['SCHEDULED', 'DEFERRED', 'RETRY_WAIT'] },
          dueAt: { $lte: serverNow },
          $or: [{ 'lease.until': null }, { 'lease.until': { $lte: serverNow } }]
        },
        {
          state: 'EVALUATING',
          'lease.until': { $lte: serverNow }
        }
      ]
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
      sort: { priority: -1, dueAt: 1 },
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
 * Executes dispatch for a specified execution ID (used in worker loops and tests).
 */
export async function executeDueStepDispatch(
  executionId: string,
  adapter: IWhatsAppDeliveryAdapter = getWhatsAppDeliveryAdapter(),
  serverNow: Date = new Date()
): Promise<'PROVIDER_ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'OUTCOME_UNKNOWN' | 'RETRY_WAIT' | 'BLOCKED' | 'FAILED'> {
  const execution = await CampaignExecutionModel.findOne({ id: executionId });
  if (!execution) return 'FAILED';
  const res = await processClaimedExecution(execution, adapter, serverNow);
  if (res === 'ACCEPTED') return 'PROVIDER_ACCEPTED';
  return res as any;
}

/**
 * Processes a claimed execution through preflight safeguards, atomic submission transaction,
 * WhatsApp delivery adapter, and delivery status correlation.
 */
export async function processClaimedExecution(
  executionOrId: ICampaignExecution | string,
  adapter: IWhatsAppDeliveryAdapter = getWhatsAppDeliveryAdapter(),
  serverNow: Date = new Date()
): Promise<'ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'OUTCOME_UNKNOWN' | 'RETRY_WAIT' | 'BLOCKED' | 'FAILED'> {
  let execution: ICampaignExecution | null = null;
  if (typeof executionOrId === 'string') {
    execution = await CampaignExecutionModel.findOne({ id: executionOrId });
  } else {
    execution = executionOrId;
  }
  if (!execution) return 'FAILED';

  const { tenantId, id: executionId } = execution;
  const leaseToken = execution.lease?.token;

  const baseCasQuery: any = {
    id: executionId,
    tenantId,
    claimVersion: execution.claimVersion,
    planRevision: execution.planRevision
  };
  if (leaseToken) {
    baseCasQuery['lease.token'] = leaseToken;
    baseCasQuery['lease.until'] = { $gt: serverNow };
  }

  try {
    // 1. Run Preflight Safeguards
    const outcome: PipelineOutcome = await executePreflightSafeguards(execution, serverNow);

    if (outcome.status === 'SKIP') {
      const skipped = await CampaignExecutionModel.findOneAndUpdate(
        baseCasQuery,
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
        baseCasQuery,
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
        baseCasQuery,
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
    const { customer, version, enrollment, campaign, parameters, payloadHash } = outcome;
    const stepDef = version.steps.find((s: any) => s.stepId === execution.stepId)!;
    const attemptId = `attempt_${ulid().toLowerCase()}`;
    const deliveryIntentId = execution.deliveryIntentId || generateId('di');

    let resolvedConnectionId: string = env.WHATSAPP_CONNECTION_ID || 'conn_test';
    let deliveryIntentDoc: any = null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Step A: Lock & Conditionally Update TenantControlGate (Consistent Lock Order: 1, Spec p.25)
        let tenantGate = await TenantControlGateModel.findOneAndUpdate(
          { tenantId, globalPause: false },
          { $inc: { gateVersion: 1 } },
          { session, new: true }
        );
        if (!tenantGate) {
          const existing = await TenantControlGateModel.findOne({ tenantId }).session(session);
          if (existing && existing.globalPause) {
            throw new Error('CAMPAIGN_OR_GLOBAL_PAUSED');
          }
          const created = await TenantControlGateModel.create(
            [{ id: generateId('tg'), tenantId, globalPause: false, gateVersion: 2 }],
            { session }
          );
          tenantGate = created[0];
        }

        // Step B: Lock & Conditionally Update CampaignControlGate (Consistent Lock Order: 2, Spec p.25)
        let campaignGate = await CampaignControlGateModel.findOneAndUpdate(
          {
            tenantId,
            campaignId: execution.campaignId,
            paused: false,
            pauseGeneration: execution.pauseGeneration
          },
          { $inc: { gateVersion: 1 } },
          { session, new: true }
        );
        if (!campaignGate) {
          const existing = await CampaignControlGateModel.findOne({
            tenantId,
            campaignId: execution.campaignId
          }).session(session);
          if (existing) {
            throw new Error('CAMPAIGN_OR_GLOBAL_PAUSED');
          }
          const created = await CampaignControlGateModel.create(
            [{
              id: generateId('cg'),
              tenantId,
              campaignId: execution.campaignId,
              paused: false,
              pauseGeneration: execution.pauseGeneration,
              gateVersion: 2
            }],
            { session }
          );
          campaignGate = created[0];
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
            throw new ContactCapExceededError(
              capResult.reason || 'SKIPPED_CONTACT_CAP',
              capResult.nextAvailableAt
            );
          }
        }

        // Step C.2: Re-check live stock inside atomic transaction (Spec p.13, test A15, A16)
        if (enrollment.sourceRef?.type === 'STOCK_EVENT') {
          const sku = enrollment.sourceRef.id;
          const product = await ProductModel.findOne({ tenantId, sku }).session(session);
          if (!product || product.stockCount <= 0 || !product.isSellable) {
            throw new Error('SKIPPED_STOCK_DEPLETED');
          }
        }

        // Step D: Resolve Tenant Connection & Freeze Delivery Intent (Spec p.27)
        const tenantConnection = await TenantConnectionModel.findOne({ tenantId, status: 'ACTIVE' }).session(session);
        if (tenantConnection?.connectionId) {
          resolvedConnectionId = tenantConnection.connectionId;
        } else if (process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test' || env.WHATSAPP_MODE === 'mock') {
          resolvedConnectionId = env.WHATSAPP_CONNECTION_ID || 'conn_test';
        } else {
          logger.error({ tenantId }, 'No active WhatsApp connection found for tenant (fail-closed)');
          throw new Error('BLOCKED_NO_TENANT_CONNECTION');
        }

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
                connectionId: resolvedConnectionId,
                customerId: customer.id,
                recipientVersion: customer.version || 1,
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

      if (errMsg === 'LEASE_LOST_BEFORE_DISPATCH') {
        // CAS failed because lease token changed, was stolen, or expired.
        // Stale worker must NOT overwrite the other worker's active evaluation/lease in DB!
        return 'FAILED';
      }

      // Lease-fenced recovery write: match executionId, tenantId, state EVALUATING, claimVersion, planRevision, and lease token (Finding 4)
      const recoveryFence = {
        id: executionId,
        tenantId,
        state: 'EVALUATING',
        claimVersion: execution.claimVersion,
        planRevision: execution.planRevision,
        'lease.token': execution.lease?.token
      };

      if (errMsg === 'CAMPAIGN_OR_GLOBAL_PAUSED') {
        const updateRes = await CampaignExecutionModel.updateOne(
          recoveryFence,
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
        if (updateRes.matchedCount === 0) {
          logger.warn({ executionId, claimVersion: execution.claimVersion }, 'Recovery CAS failed; stale worker aborted without mutating execution');
          return 'FAILED';
        }
        return 'SKIPPED';
      }

      if (txErr instanceof ContactCapExceededError || errMsg === 'DEFERRED_CONTACT_CAP' || errMsg === 'SKIPPED_CONTACT_CAP') {
        const capErr = txErr instanceof ContactCapExceededError ? txErr : null;
        const nextAvailableAt = capErr?.nextAvailableAt;
        const isExpired = Boolean(
          nextAvailableAt && execution.expiresAt && nextAvailableAt.getTime() >= execution.expiresAt.getTime()
        );
        const shouldSkip = isExpired || capErr?.reason === 'SKIPPED_CONTACT_CAP' || errMsg === 'SKIPPED_CONTACT_CAP' || !nextAvailableAt;

        const updateSet: Record<string, any> = {
          state: shouldSkip ? 'SKIPPED' : 'DEFERRED',
          outcomeReason: shouldSkip ? 'SKIPPED_CONTACT_CAP' : 'DEFERRED_CONTACT_CAP',
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        };

        if (!shouldSkip && nextAvailableAt) {
          updateSet.dueAt = nextAvailableAt;
        }

        const updateRes = await CampaignExecutionModel.updateOne(
          recoveryFence,
          { $set: updateSet }
        );
        if (updateRes.matchedCount === 0) {
          logger.warn({ executionId, claimVersion: execution.claimVersion }, 'Recovery CAS failed; stale worker aborted without mutating execution');
          return 'FAILED';
        }
        return shouldSkip ? 'SKIPPED' : 'DEFERRED';
      }

      if (errMsg === 'SKIPPED_STOCK_DEPLETED') {
        const updateRes = await CampaignExecutionModel.updateOne(
          recoveryFence,
          {
            $set: {
              state: 'SKIPPED',
              outcomeReason: 'SKIPPED_STOCK_DEPLETED',
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          }
        );
        if (updateRes.matchedCount === 0) {
          logger.warn({ executionId, claimVersion: execution.claimVersion }, 'Recovery CAS failed; stale worker aborted without mutating execution');
          return 'FAILED';
        }
        return 'SKIPPED';
      }

      if (errMsg === 'BLOCKED_NO_TENANT_CONNECTION') {
        const updateRes = await CampaignExecutionModel.updateOne(
          recoveryFence,
          {
            $set: {
              state: 'BLOCKED',
              outcomeReason: 'BLOCKED_NO_TENANT_CONNECTION',
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          }
        );
        if (updateRes.matchedCount === 0) {
          logger.warn({ executionId, claimVersion: execution.claimVersion }, 'Recovery CAS failed; stale worker aborted without mutating execution');
          return 'FAILED';
        }
        return 'BLOCKED';
      }

      // Safe cleanup for failed or aborted transaction: ensure EVALUATING lease is released (Finding 1 & Finding 4)
      const cleanupRes = await CampaignExecutionModel.updateOne(
        recoveryFence,
        {
          $set: {
            state: 'DEFERRED',
            outcomeReason: `TRANSIENT_FAILURE_${errMsg.slice(0, 32)}`,
            dueAt: new Date(serverNow.getTime() + 60 * 1000),
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        }
      );
      if (cleanupRes.matchedCount === 0) {
        logger.warn({ executionId, claimVersion: execution.claimVersion }, 'Cleanup CAS failed; stale worker aborted without mutating execution');
      }

      // Lease lost or expired CAS conflict
      return 'FAILED';
    }
    await session.endSession();

    // Spec p.27: Recheck dispatch deadline after transaction commit and before POST
    const prePostNow = new Date();
    if (prePostNow >= execution.expiresAt) {
      logger.warn(
        { executionId, expiresAt: execution.expiresAt, prePostNow },
        'Execution expired after transaction commit before POST; cancelling send'
      );
      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, tenantId, state: 'DISPATCHING' },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: 'SKIPPED_STEP_EXPIRED',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        }
      );
      if (deliveryIntentDoc) {
        deliveryIntentDoc.state = 'EXPIRED';
        await deliveryIntentDoc.save();
      }
      await updateContactReservationStatus(tenantId, customer.phone, executionId, 'RELEASED');
      return 'SKIPPED';
    }

    // 3. Provider HTTP Call Outside the DB Transaction (Strict Rule, Handoff p.25)
    const sendResult = await adapter.sendCampaignStep({
      executionId,
      deliveryKey: executionId,
      connectionId: resolvedConnectionId,
      customerId: customer.id,
      recipientVersion: customer.version || 1,
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
      const nowAccepted = new Date();

      // Monotonic progression for delivery intent: only update to ACCEPTED if still in SUBMITTING or OUTCOME_UNKNOWN.
      // Never overwrite newer terminal delivery states (DELIVERED, READ, REJECTED) if a webhook arrived early!
      await CampaignDeliveryIntentModel.updateOne(
        {
          executionId,
          tenantId,
          state: { $in: ['SUBMITTING', 'OUTCOME_UNKNOWN'] }
        },
        {
          $set: {
            state: 'ACCEPTED',
            submittedAt: nowAccepted
          }
        }
      );

      // Persist the provider message ID with a conditional update preserving terminal delivery states
      if (sendResult.providerMessageId) {
        await CampaignDeliveryIntentModel.updateOne(
          { executionId, tenantId },
          {
            $set: {
              providerMessageId: sendResult.providerMessageId
            }
          }
        );
      }

      // Monotonic progression for execution: only update to PROVIDER_ACCEPTED if not already DELIVERED or READ (Finding 7)
      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, tenantId, state: { $in: ['DISPATCHING', 'OUTCOME_UNKNOWN'] } },
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

      // Check if any late status events already arrived before response persistence (Test C12, Review 3 P2, Review 4 P2)
      if (sendResult.providerMessageId) {
        const earlyEvents = await CampaignEventInboxModel.find({
          tenantId,
          type: { $in: ['whatsapp.status.delivered', 'whatsapp.status.read', 'whatsapp.status.failed'] },
          'data.providerMessageId': sendResult.providerMessageId
        })
          .sort({ occurredAt: 1 })
          .exec();

        for (const earlyEvent of earlyEvents) {
          const status = earlyEvent.type.replace('whatsapp.status.', '') as 'delivered' | 'read' | 'failed';
          const providerTimestamp = earlyEvent.occurredAt || new Date();
          const errorCode = earlyEvent.data?.errors?.[0]?.code?.toString() || earlyEvent.data?.errorCode;
          const errorReason = earlyEvent.data?.errors?.[0]?.title || earlyEvent.data?.errors?.[0]?.message;

          await reconcileDeliveryStatus({
            tenantId,
            providerMessageId: sendResult.providerMessageId,
            status,
            providerTimestamp,
            errorCode,
            errorReason,
            inboxEventId: earlyEvent.id
          });

          // Mark early event processed and correlated to executionId (Review 7 recovery)
          earlyEvent.status = 'PROCESSED';
          earlyEvent.entityId = executionId;
          earlyEvent.processedAt = new Date();
          earlyEvent.nextAttemptAt = null;
          earlyEvent.errorMessage = null;
          await earlyEvent.save();
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
    const leaseReleaseQuery: any = { id: executionId };
    if (execution.lease?.token) {
      leaseReleaseQuery['lease.token'] = execution.lease.token;
    }
    await CampaignExecutionModel.findOneAndUpdate(
      leaseReleaseQuery,
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

/**
 * Sweeper: Reclaims expired pre-submission leases for executions stuck in EVALUATING (Spec p.25, Finding 1).
 * When a worker crashes after claiming or transient failure occurs, this resets them to SCHEDULED
 * with cleared leases so they are immediately eligible for claim and execution.
 */
export async function sweepExpiredPreSubmissionLeases(
  tenantId: string,
  serverNow: Date = new Date()
): Promise<{ recoveredCount: number }> {
  const result = await CampaignExecutionModel.updateMany(
    {
      tenantId,
      state: 'EVALUATING',
      'lease.until': { $lte: serverNow }
    },
    {
      $set: {
        state: 'SCHEDULED',
        'lease.token': null,
        'lease.until': null,
        'lease.claimedBy': null
      }
    }
  );

  return { recoveredCount: result.modifiedCount };
}

