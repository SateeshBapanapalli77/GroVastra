import { CampaignExecutionModel, ICampaignExecution } from '../models/CampaignExecution.model';
import { CampaignDeliveryIntentModel, ICampaignDeliveryIntent } from '../models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { executePreflightSafeguards, PipelineOutcome } from './safeguards/safeguardPipeline';
import { updateContactReservationStatus } from './safeguards/contactCapResolver';
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
  failedCount: number;
}

/**
 * Atomically claims one due execution using an expiring lease token (Handoff Page 19 & 25)
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
      state: { $in: ['SCHEDULED', 'DEFERRED'] },
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
      $inc: { planRevision: 1 }
    },
    {
      sort: { dueAt: 1 },
      new: true
    }
  );

  return claimed;
}

/**
 * Processes a claimed execution through the safeguard pipeline and WhatsApp dispatch boundary
 */
export async function processClaimedExecution(
  execution: ICampaignExecution,
  adapter: IWhatsAppDeliveryAdapter = getWhatsAppDeliveryAdapter(),
  serverNow: Date = new Date()
): Promise<'ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'OUTCOME_UNKNOWN' | 'FAILED'> {
  const { tenantId, id: executionId } = execution;

  try {
    // 1. Run Preflight Safeguards
    const outcome: PipelineOutcome = await executePreflightSafeguards(execution, serverNow);

    if (outcome.status === 'SKIP') {
      const skipped = await CampaignExecutionModel.findOneAndUpdate(
        {
          id: executionId,
          planRevision: execution.planRevision,
          'lease.token': execution.lease.token
        },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: outcome.reason,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          },
          $inc: { planRevision: 1 }
        },
        { new: true }
      );

      if (!skipped) {
        logger.warn({ executionId }, 'CAS Conflict: Execution was modified or lease expired while evaluating SKIP');
        return 'FAILED';
      }

      logger.info({ executionId, reason: outcome.reason }, 'Execution skipped by safeguard');
      return 'SKIPPED';
    }

    if (outcome.status === 'DEFER') {
      const deferred = await CampaignExecutionModel.findOneAndUpdate(
        {
          id: executionId,
          planRevision: execution.planRevision,
          'lease.token': execution.lease.token
        },
        {
          $set: {
            state: 'DEFERRED',
            dueAt: outcome.nextDueAt,
            outcomeReason: outcome.reason,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          },
          $inc: { planRevision: 1 }
        },
        { new: true }
      );

      if (!deferred) {
        logger.warn({ executionId }, 'CAS Conflict: Execution was modified or lease expired while evaluating DEFER');
        return 'FAILED';
      }

      logger.info({ executionId, nextDueAt: outcome.nextDueAt, reason: outcome.reason }, 'Execution deferred');
      return 'DEFERRED';
    }

    // 2. All safeguards passed -> PROCEED to Two-Phase Delivery Intent Freezing
    const { customer, version, campaign } = outcome;
    const stepDef = version.steps.find((s) => s.stepId === execution.stepId)!;
    const storeDisplayName = (version as any).brandName || campaign?.name || 'GroVastra Boutique';

    // Resolve parameter bindings dynamically (Handoff Page 19)
    const parameters: Record<string, string> = {};
    const rawBindings = stepDef.bindings instanceof Map
      ? Object.fromEntries(stepDef.bindings.entries())
      : (stepDef.bindings || {});

    for (const [paramKey, rawExpr] of Object.entries(rawBindings)) {
      const expr = typeof rawExpr === 'string' ? rawExpr : String(rawExpr || '');
      if (expr === 'customer.firstName') {
        parameters[paramKey] = customer.firstName || '';
      } else if (expr === 'customer.lastName') {
        parameters[paramKey] = customer.lastName || '';
      } else if (expr === 'customer.fullName') {
        parameters[paramKey] = `${customer.firstName} ${customer.lastName}`.trim();
      } else if (expr === 'shop.displayName' || expr === 'shop.name' || expr === 'store.displayName') {
        parameters[paramKey] = storeDisplayName;
      } else if (expr.startsWith('literal:')) {
        parameters[paramKey] = expr.slice(8);
      } else if (expr in customer) {
        parameters[paramKey] = String((customer as any)[expr] || '');
      } else {
        parameters[paramKey] = expr;
      }
    }

    // Default standard placeholders if template expects them
    if (!parameters.name && customer.firstName) {
      parameters.name = customer.firstName;
    }
    if (!parameters.shop) {
      parameters.shop = storeDisplayName;
    }

    const payloadHash = sha256(parameters);
    const deliveryIntentId = generateId('di');
    const attemptId = `attempt_${ulid().toLowerCase()}`;

    // Create immutable delivery intent
    const deliveryIntent = await CampaignDeliveryIntentModel.create({
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
    });

    // Move execution to DISPATCHING using Atomic CAS
    const dispatching = await CampaignExecutionModel.findOneAndUpdate(
      {
        id: executionId,
        state: 'EVALUATING',
        planRevision: execution.planRevision,
        'lease.token': execution.lease.token
      },
      {
        $set: {
          state: 'DISPATCHING',
          deliveryIntentId
        },
        $inc: { planRevision: 1 }
      },
      { new: true }
    );

    if (!dispatching) {
      logger.warn({ executionId }, 'CAS Conflict: Execution was modified or lease expired before dispatching');
      deliveryIntent.state = 'REJECTED';
      deliveryIntent.errorCode = 'LEASE_LOST_BEFORE_DISPATCH';
      await deliveryIntent.save();
      return 'FAILED';
    }

    // 3. Dispatch to WhatsApp Adapter (Outside of DB transaction)
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

    // 4. Handle Adapter Response & Update States via CAS
    if (sendResult.state === 'ACCEPTED') {
      deliveryIntent.state = 'ACCEPTED';
      deliveryIntent.providerMessageId = sendResult.providerMessageId || null;
      await deliveryIntent.save();

      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, state: 'DISPATCHING', planRevision: dispatching.planRevision },
        {
          $set: {
            state: 'PROVIDER_ACCEPTED',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          },
          $inc: { planRevision: 1 }
        }
      );

      await updateContactReservationStatus(tenantId, customer.phone, executionId, 'ACCEPTED');
      logger.info({ executionId, providerId: sendResult.providerMessageId }, 'Message accepted by provider');
      return 'ACCEPTED';
    }

    if (sendResult.state === 'OUTCOME_UNKNOWN') {
      deliveryIntent.state = 'OUTCOME_UNKNOWN';
      await deliveryIntent.save();

      await CampaignExecutionModel.findOneAndUpdate(
        { id: executionId, state: 'DISPATCHING', planRevision: dispatching.planRevision },
        {
          $set: {
            state: 'OUTCOME_UNKNOWN',
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          },
          $inc: { planRevision: 1 }
        }
      );

      await updateContactReservationStatus(tenantId, customer.phone, executionId, 'UNKNOWN');
      logger.warn({ executionId }, 'Message outcome unknown; awaiting webhook correlation');
      return 'OUTCOME_UNKNOWN';
    }

    // Permanent Rejection
    deliveryIntent.state = 'REJECTED';
    deliveryIntent.errorCode = sendResult.errorCode || 'UNKNOWN_ERROR';
    await deliveryIntent.save();

    await CampaignExecutionModel.findOneAndUpdate(
      { id: executionId, state: 'DISPATCHING', planRevision: dispatching.planRevision },
      {
        $set: {
          state: 'FAILED',
          outcomeReason: sendResult.errorCode || undefined,
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        },
        $inc: { planRevision: 1 }
      }
    );

    await updateContactReservationStatus(tenantId, customer.phone, executionId, 'RELEASED');
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
        },
        $inc: { planRevision: 1 }
      }
    );
    return 'FAILED';
  }
}

/**
 * Runs a single polling cycle over due executions
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
 * Moves stale DISPATCHING attempts to OUTCOME_UNKNOWN (Handoff p.27).
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
      { id: exec.id, tenantId, state: 'DISPATCHING', planRevision: exec.planRevision },
      {
        $set: {
          state: 'OUTCOME_UNKNOWN',
          outcomeReason: 'DISPATCH_INTERRUPTED',
          'lease.token': null, 'lease.until': null, 'lease.claimedBy': null
        },
        $inc: { planRevision: 1 }
      },
      { new: true }
    );
    if (!moved) continue; // original worker finished meanwhile; leave it alone

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
 * Reconciles OUTCOME_UNKNOWN executions from provider EVIDENCE only.
 * NEVER requeues, retries, fails, or releases the contact reservation (tests C06/C07/C13).
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
    if (!intent) { result.stillUnknown++; continue; }

    const phone = await recipientPhoneOf(intent);
    const byIntentReceipt = Boolean(intent.deliveredAt || intent.readAt);

    const statusEvent = byIntentReceipt
      ? null
      : await CampaignEventInboxModel.findOne({
          tenantId,
          entityId: exec.id,
          type: { $in: ['whatsapp.status.delivered', 'whatsapp.status.read'] }
        }).sort({ occurredAt: -1 }).exec();

    if (byIntentReceipt || statusEvent) {
      const isRead = byIntentReceipt ? Boolean(intent.readAt) : statusEvent!.type === 'whatsapp.status.read';
      const deliveredAt = byIntentReceipt ? intent.deliveredAt ?? intent.readAt : statusEvent!.occurredAt;
      const moved = await CampaignExecutionModel.findOneAndUpdate(
        { id: exec.id, tenantId, state: 'OUTCOME_UNKNOWN', planRevision: exec.planRevision },
        {
          $set: {
            state: isRead ? 'READ' : 'DELIVERED',
            deliveredAt,
            readAt: isRead ? (byIntentReceipt ? intent.readAt : statusEvent!.occurredAt) : null,
            outcomeReason: null
          },
          $inc: { planRevision: 1 }
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
        { id: exec.id, tenantId, state: 'OUTCOME_UNKNOWN', planRevision: exec.planRevision },
        { $set: { state: 'PROVIDER_ACCEPTED', outcomeReason: null }, $inc: { planRevision: 1 } }
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

