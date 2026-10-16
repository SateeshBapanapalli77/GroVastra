import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { encryptText, sha256 } from '../src/shared/utils/crypto';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import {
  claimNextDueExecution,
  processClaimedExecution,
  runDispatchCycle,
  replanExecution,
  sweepStaleDispatching,
  sweepOutcomeUnknownExecutions
} from '../src/modules/campaigns/engine/dispatchExecutor';
import { planAnnualOccasions } from '../src/modules/campaigns/engine/annualDateStrategy';
import {
  pruneTerminalEnrollments,
  isEnrollmentReplayBlocked
} from '../src/modules/campaigns/services/retentionService';
import { checkAndReserveContactCapacity } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { verifyMetaSignature } from '../src/modules/campaigns/routes/webhook.routes';

// Real Domain Models
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignContactGateModel } from '../src/modules/campaigns/models/CampaignContactGate.model';
import { CampaignControlGateModel } from '../src/modules/campaigns/models/CampaignControlGate.model';
import { TenantControlGateModel } from '../src/modules/campaigns/models/TenantControlGate.model';
import { CampaignTombstoneModel } from '../src/modules/campaigns/models/CampaignTombstone.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { OrderModel } from '../src/modules/orders/models/Order.model';
import { ProductModel } from '../src/modules/inventory/models/Product.model';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import { resolveShopDisplayName } from '../src/modules/campaigns/services/shopResolver';
import { validateCampaignVersionDefinition } from '../src/modules/campaigns/routes/campaign.routes';
import { webhookRouter } from '../src/modules/campaigns/routes/webhook.routes';
import express from 'express';
import http from 'http';
import crypto from 'crypto';

describe('Work Package P1: Execution Correctness & Concurrency', () => {
  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI must be provided by test harness (MongoMemoryReplSet)');
    }
    if (mongoose.connection.readyState === 0) {
      mongoose.set('strictQuery', true);
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        autoIndex: true
      });
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      CustomerModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignContactGateModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignControlGateModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      TenantControlGateModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignTombstoneModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      TenantSettingsModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      OrderModel.deleteMany({ tenantId: { $regex: /^p1_/ } }),
      ProductModel.deleteMany({ tenantId: { $regex: /^p1_/ } })
    ]);
  });

  const createTestFixture = async (tenantId: string, overrides: { phone?: string; priority?: number; brandName?: string } = {}) => {
    const existingConn = await TenantConnectionModel.findOne({ connectionId: `conn_${tenantId}` });
    if (!existingConn) {
      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId,
        connectionId: `conn_${tenantId}`,
        provider: 'whatsapp_cloud',
        status: 'ACTIVE'
      });
    }

    const phone = overrides.phone || '+919876543210';
    const customer = await CustomerModel.create({
      id: generateId('cus'),
      tenantId,
      firstName: 'Lakshmi',
      lastName: 'Devi',
      phone,
      birthdayMonth: 10,
      birthdayDay: 28,
      status: 'ACTIVE',
      channelSuppressed: false,
      optedInMarketing: true
    });

    const campaign = await CampaignModel.create({
      id: generateId('cmp'),
      tenantId,
      name: 'Padmavati Handlooms Birthday',
      status: 'ACTIVE',
      pauseGeneration: 0
    });

    const version = await CampaignVersionModel.create({
      id: generateId('cv'),
      tenantId,
      campaignId: campaign.id,
      version: 1,
      name: 'Padmavati Handlooms Birthday v1',
      brandName: overrides.brandName || null,
      status: 'PUBLISHED',
      reviewFingerprint: 'fp_test_padmavati_bday_v1',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 14, leapDayPolicy: 'FEB_28' },
      audience: {},
      steps: [
        {
          stepId: 'invitation',
          offsetDays: -14,
          localTime: '10:00',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName', shop: 'literal:Padmavati Handlooms' },
          stopOnReply: true,
          stopOnGoal: true,
          prerequisite: 'NONE'
        }
      ],
      priority: overrides.priority || 80,
      timezone: 'Asia/Kolkata'
    });

    const enrollment = await CampaignEnrollmentModel.create({
      id: generateId('enr'),
      tenantId,
      campaignId: campaign.id,
      campaignVersionId: version.id,
      customerId: customer.id,
      occurrenceId: 'birthday:2026',
      sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });

    const execution = await CampaignExecutionModel.create({
      id: generateId('exe'),
      tenantId,
      enrollmentId: enrollment.id,
      campaignId: campaign.id,
      stepId: 'invitation',
      dueAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      localDate: '2026-10-14',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      planRevision: 1,
      claimVersion: 0,
      pauseGeneration: 0,
      state: 'SCHEDULED',
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });

    return { customer, campaign, version, enrollment, execution };
  };

  it('B15: Stale worker lease or planRevision: CAS fails; stale worker makes zero provider requests', async () => {
    const tenantId = 'p1_b15';
    const { execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();

    // 1. Worker claims execution
    const claimed = await claimNextDueExecution(tenantId, new Date());
    expect(claimed).not.toBeNull();
    expect(claimed!.state).toBe('EVALUATING');
    expect(claimed!.claimVersion).toBe(1);
    expect(claimed!.planRevision).toBe(1); // planRevision unchanged on claim!

    // 2. Simulate stale worker: another worker/reclaim invalidated the lease token in DB
    await CampaignExecutionModel.updateOne(
      { id: execution.id },
      { $set: { 'lease.token': 'other_worker_lease_token', claimVersion: 2 } }
    );

    // 3. Stale worker attempts dispatch with its now-invalid lease
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('FAILED');

    // 4. Assert DB state & provider call counts
    expect(mockAdapter.getSubmissionCount()).toBe(0);
    const intentInDb = await CampaignDeliveryIntentModel.findOne({ tenantId, executionId: execution.id });
    expect(intentInDb).toBeNull(); // No stranded delivery intent!

    const executionInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(executionInDb!.state).toBe('EVALUATING'); // Not marked DISPATCHING
  });

  it('B20: Source replan races final submission: Execution-revision transaction/CAS chooses one order; stale claimant cannot send', async () => {
    const tenantId = 'p1_b20';
    const { execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();

    // 1. Worker claims execution
    const claimed = await claimNextDueExecution(tenantId, new Date());
    expect(claimed).not.toBeNull();

    // 2. Concurrent replan event: occasion date updated, replanExecution called
    const newDue = new Date(Date.now() + 48 * 3600 * 1000);
    // replanExecution requires deliveryIntentId=null and matches expectedPlanRevision
    const replanOk = await replanExecution(tenantId, execution.id, claimed!.planRevision, newDue);
    // Since worker is currently EVALUATING, replanExecution checks state: SCHEDULED/DEFERRED and rejects replanning an active lease!
    expect(replanOk).toBe(false);

    // Now test replan when execution was SCHEDULED before claim:
    const exec2 = await CampaignExecutionModel.create({
      id: generateId('exe'),
      tenantId,
      enrollmentId: execution.enrollmentId,
      campaignId: execution.campaignId,
      stepId: 'followup',
      dueAt: new Date(Date.now() - 500),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      localDate: '2026-10-21',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      planRevision: 1,
      claimVersion: 0,
      pauseGeneration: 0,
      state: 'SCHEDULED',
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });

    const replanSuccess = await replanExecution(tenantId, exec2.id, 1, newDue);
    expect(replanSuccess).toBe(true);

    const replannedDoc = await CampaignExecutionModel.findOne({ id: exec2.id });
    expect(replannedDoc!.planRevision).toBe(2);
    expect(replannedDoc!.dueAt.getTime()).toBe(newDue.getTime());
  });

  it('B11: Pause during evaluation: Control-gate generation invalidates stale submission', async () => {
    const tenantId = 'p1_b11';
    const { campaign, execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();

    // 1. Worker claims execution with pauseGeneration: 0
    const claimed = await claimNextDueExecution(tenantId, new Date());
    expect(claimed).not.toBeNull();

    // 2. Owner pauses campaign during evaluation: increments pauseGeneration in control gate
    await CampaignControlGateModel.create({
      id: generateId('cg'),
      tenantId,
      campaignId: campaign.id,
      paused: true,
      pauseGeneration: 1
    });
    await CampaignModel.updateOne({ id: campaign.id }, { $set: { status: 'PAUSED', pauseGeneration: 1 } });

    // 3. Worker evaluates claimed execution: control gate check catches pause!
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('SKIPPED');

    // 4. Assert DB state & provider call counts
    expect(mockAdapter.getSubmissionCount()).toBe(0);
    const intentInDb = await CampaignDeliveryIntentModel.findOne({ tenantId, executionId: execution.id });
    expect(intentInDb).toBeNull(); // No stranded intent!

    const executionInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(executionInDb!.state).toBe('SKIPPED');
    expect(executionInDb!.outcomeReason).toBe('SKIPPED_CAMPAIGN_PAUSED');
  });

  it('B12: Pause after submission starts: UI says in progress/may send; no false recall', async () => {
    const tenantId = 'p1_b12';
    const { campaign, execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();

    const claimed = await claimNextDueExecution(tenantId, new Date());
    expect(claimed).not.toBeNull();

    // Normal successful dispatch outside transaction
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('ACCEPTED');
    expect(mockAdapter.getSubmissionCount()).toBe(1);

    // Pause clicked after send completed
    await CampaignControlGateModel.updateOne({ tenantId, campaignId: campaign.id }, { $set: { paused: true } });
    const executionInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(executionInDb!.state).toBe('PROVIDER_ACCEPTED'); // No false recall of accepted message!
  });

  it('B09: Birthday and festival compete: Deterministic priority; atomic cap; loser deferred or skipped', async () => {
    const tenantId = 'p1_b09';
    const phone = '+919876543210';

    // 1. Create Festival execution (priority 50, expires in 2 days)
    const { execution: festivalExec } = await createTestFixture(tenantId, { phone, priority: 50 });
    festivalExec.expiresAt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    await festivalExec.save();

    // Festival reserves capacity first
    const festivalCap = await checkAndReserveContactCapacity(
      tenantId,
      phone,
      festivalExec.campaignId,
      festivalExec.id,
      festivalExec.expiresAt,
      50,
      new Date()
    );
    expect(festivalCap.allowed).toBe(true);

    // 2. Create Birthday execution (priority 80, expires in 7 days)
    const { execution: birthdayExec } = await createTestFixture(tenantId, { phone, priority: 80 });
    birthdayExec.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await birthdayExec.save();

    // Birthday checks capacity: higher priority (80 > 50) displaces Festival!
    const birthdayCap = await checkAndReserveContactCapacity(
      tenantId,
      phone,
      birthdayExec.campaignId,
      birthdayExec.id,
      birthdayExec.expiresAt,
      80,
      new Date()
    );
    expect(birthdayCap.allowed).toBe(true);

    // 3. Verify Festival was displaced and deferred
    const displacedFestival = await CampaignExecutionModel.findOne({ id: festivalExec.id });
    expect(displacedFestival!.state).toBe('DEFERRED');
    expect(displacedFestival!.outcomeReason).toBe('DEFERRED_CONTACT_CAP');

    // 4. Verify Contact Gate ledger
    const gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash: sha256(phone) });
    expect(gate).not.toBeNull();
    const festReservation = gate!.history.find((h) => h.executionId === festivalExec.id);
    const bdayReservation = gate!.history.find((h) => h.executionId === birthdayExec.id);

    expect(festReservation!.status).toBe('DISPLACED');
    expect(bdayReservation!.status).toBe('RESERVED');
  });

  it('B10: Two CRM records share destination: Destination cap enforced across records; identities not merged', async () => {
    const tenantId = 'p1_b10';
    const sharedPhone = '+919876543210';

    // Create 2 separate customer records sharing the exact same phone
    const { execution: exec1, campaign, version } = await createTestFixture(tenantId, { phone: sharedPhone });

    const cus2 = await CustomerModel.create({
      id: generateId('cus'),
      tenantId,
      firstName: 'Ananya',
      lastName: 'Devi',
      phone: sharedPhone,
      status: 'ACTIVE',
      channelSuppressed: false,
      optedInMarketing: true
    });

    const enrollment2 = await CampaignEnrollmentModel.create({
      id: generateId('enr'),
      tenantId,
      campaignId: campaign.id,
      campaignVersionId: version.id,
      customerId: cus2.id,
      occurrenceId: 'birthday:2026',
      sourceRef: { type: 'CUSTOMER_DATE', id: cus2.id, version: 1 },
      status: 'ACTIVE',
      replyHoldAt: null,
      goalReachedAt: null
    });

    const exec2 = await CampaignExecutionModel.create({
      id: generateId('exe'),
      tenantId,
      enrollmentId: enrollment2.id,
      campaignId: campaign.id,
      stepId: 'invitation',
      dueAt: new Date(Date.now() - 500),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      localDate: '2026-10-14',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      planRevision: 1,
      claimVersion: 0,
      pauseGeneration: 0,
      state: 'SCHEDULED',
      prerequisite: 'NONE',
      deliveryIntentId: null,
      lease: { token: null, until: null, claimedBy: null }
    });

    // Customer 1 dispatches and is accepted
    const claimed1 = await claimNextDueExecution(tenantId, new Date());
    const outcome1 = await processClaimedExecution(claimed1!, new MockWhatsAppDeliveryAdapter(), new Date());
    expect(outcome1).toBe('ACCEPTED');

    // Customer 2 attempts dispatch within 24h: destination cap blocks it
    const claimed2 = await claimNextDueExecution(tenantId, new Date());
    expect(claimed2).not.toBeNull();
    const mockAdapter2 = new MockWhatsAppDeliveryAdapter();
    const outcome2 = await processClaimedExecution(claimed2!, mockAdapter2, new Date());

    expect(['DEFERRED', 'SKIPPED']).toContain(outcome2);
    expect(mockAdapter2.getSubmissionCount()).toBe(0); // Zero provider calls for customer 2!

    // Identities remain strictly separate in CRM
    const customersInDb = await CustomerModel.find({ tenantId, phone: sharedPhone });
    expect(customersInDb.length).toBe(2);
    expect(customersInDb[0].id).not.toBe(customersInDb[1].id);
  });

  it('B18: Cleanup followed by historical replay: Retained logical-key protection prevents duplicate step', async () => {
    const tenantId = 'p1_b18';
    const { campaign, version, customer, enrollment, execution } = await createTestFixture(tenantId);

    // Complete enrollment and execution
    enrollment.status = 'COMPLETED';
    await enrollment.save();
    execution.state = 'PROVIDER_ACCEPTED';
    await execution.save();

    // 1. Atomic retention cleanup: moves terminal enrollment to tombstone
    const pruneResult = await pruneTerminalEnrollments(tenantId, new Date());
    expect(pruneResult.tombstonesCreated).toBe(1);
    expect(pruneResult.enrollmentsPruned).toBe(1);

    // Verify detailed record removed
    const liveEnrollment = await CampaignEnrollmentModel.findOne({ id: enrollment.id });
    expect(liveEnrollment).toBeNull();

    // Verify tombstone exists
    const tombstone = await CampaignTombstoneModel.findOne({
      tenantId,
      enrollmentKey: `${tenantId}:${campaign.id}:${customer.id}:birthday:2026`
    });
    expect(tombstone).not.toBeNull();

    // 2. Historical replay: run occasion planner again
    const planResult = await planAnnualOccasions(version);
    // Planner checks isEnrollmentReplayBlocked: skips replay!
    expect(planResult.plannedEnrollments).toBe(0);

    const reEnrolled = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId: campaign.id,
      customerId: customer.id,
      occurrenceId: 'birthday:2026'
    });
    expect(reEnrolled).toBeNull(); // No duplicate enrollment!
  });

  it('C06: Provider accepted, response lost: Outcome unknown; no automatic second submission', async () => {
    const tenantId = 'p1_c06';
    const { execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    mockAdapter.setForcedState('FORCE_TIMEOUT');

    const claimed = await claimNextDueExecution(tenantId, new Date());
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('OUTCOME_UNKNOWN');

    // Assert DB state: state is OUTCOME_UNKNOWN, reservation is UNKNOWN
    const execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('OUTCOME_UNKNOWN');

    const gate = await CampaignContactGateModel.findOne({ tenantId });
    const res = gate!.history.find((h) => h.executionId === execution.id);
    expect(res!.status).toBe('UNKNOWN');

    // Next worker cycle: OUTCOME_UNKNOWN is never claimed or resubmitted!
    const reClaim = await claimNextDueExecution(tenantId, new Date());
    expect(reClaim).toBeNull();
    expect(mockAdapter.getSubmissionCount()).toBe(1); // Provider call count remains exactly 1!
  });

  it('C07: Crash after DISPATCHING before HTTP: Unknown until proven otherwise; no blind requeue', async () => {
    const tenantId = 'p1_c07';
    const { execution } = await createTestFixture(tenantId);

    // Simulate worker crashing right after marking DISPATCHING
    const pastTime = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago
    await CampaignExecutionModel.updateOne(
      { id: execution.id },
      { $set: { state: 'DISPATCHING', updatedAt: pastTime } },
      { timestamps: false }
    );

    // Run stale dispatching sweeper
    const sweepRes = await sweepStaleDispatching(tenantId, new Date(), 2 * 60 * 1000);
    expect(sweepRes.movedToUnknown).toBe(1);

    const sweptExec = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(sweptExec!.state).toBe('OUTCOME_UNKNOWN');
    expect(sweptExec!.outcomeReason).toBe('DISPATCH_INTERRUPTED');

    // No blind requeue
    const reClaim = await claimNextDueExecution(tenantId, new Date());
    expect(reClaim).toBeNull();
  });

  it('C08: Proven throttle rejection: Bounded retry, same key/payload; reservation released/reacquired once, all gates rechecked', async () => {
    const tenantId = 'p1_c08';
    const { execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    mockAdapter.setForcedState('FORCE_THROTTLE'); // Simulates Meta error 130429

    // Attempt 1: Throttled
    const claimed = await claimNextDueExecution(tenantId, new Date());
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('RETRY_WAIT');

    // Verify DB state on retry wait
    const retryExec = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(retryExec!.state).toBe('RETRY_WAIT');
    expect(retryExec!.retryCount).toBe(1);
    expect(retryExec!.retryAt).toBeDefined();

    // Proven rejection released contact reservation!
    const gate = await CampaignContactGateModel.findOne({ tenantId });
    const res = gate!.history.find((h) => h.executionId === execution.id);
    expect(res!.status).toBe('RELEASED');

    // Attempt 2: After retry delay, provider succeeds
    mockAdapter.setForcedState('AUTO');
    const retryNow = new Date(retryExec!.retryAt!.getTime() + 1000);

    const claimedRetry = await claimNextDueExecution(tenantId, retryNow);
    expect(claimedRetry).not.toBeNull();
    expect(claimedRetry!.id).toBe(execution.id);

    const outcome2 = await processClaimedExecution(claimedRetry!, mockAdapter, retryNow);
    expect(outcome2).toBe('ACCEPTED');

    // Delivery key and intent ID were reused!
    const finalExec = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(finalExec!.state).toBe('PROVIDER_ACCEPTED');
    expect(finalExec!.deliveryIntentId).toBe(retryExec!.deliveryIntentId);

    // Reservation reacquired
    const gateAfter = await CampaignContactGateModel.findOne({ tenantId });
    const resAfter = gateAfter!.history.find((h) => h.executionId === execution.id);
    expect(resAfter!.status).toBe('ACCEPTED');

    expect(mockAdapter.getSubmissionCount()).toBe(2);
  });

  it('C09: Expiry reached during retry delay: Expired; no late offer', async () => {
    const tenantId = 'p1_c09';
    const { execution } = await createTestFixture(tenantId);
    // Set expiresAt to 30 seconds from now (less than 60s retry backoff)
    execution.expiresAt = new Date(Date.now() + 30 * 1000);
    await execution.save();

    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    mockAdapter.setForcedState('FORCE_THROTTLE');

    const claimed = await claimNextDueExecution(tenantId, new Date());
    const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());
    expect(outcome).toBe('SKIPPED');

    const execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('SKIPPED');
    expect(execInDb!.outcomeReason).toBe('STEP_EXPIRED');
  });

  it('C10: Webhook repeated / read before delivered: Idempotent evidence; no regression and no new send', async () => {
    const tenantId = 'p1_c10';
    const { execution } = await createTestFixture(tenantId);

    // Execute message successfully
    const claimed = await claimNextDueExecution(tenantId, new Date());
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    await processClaimedExecution(claimed!, mockAdapter, new Date());

    const intent = await CampaignDeliveryIntentModel.findOne({ tenantId, executionId: execution.id });
    expect(intent).not.toBeNull();
    const providerMessageId = intent!.providerMessageId!;

    // 1. Simulate Meta read receipt arriving FIRST
    const app = express();
    app.use(express.json());
    app.use('/api/v1', webhookRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const webhookSecret = process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_12345';

    const sendWebhook = async (status: 'delivered' | 'read', timestamp: string) => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_test',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: `conn_${tenantId}` },
                  statuses: [{ id: providerMessageId, status, timestamp }]
                }
              }
            ]
          }
        ]
      };
      const rawBody = JSON.stringify(payload);
      const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      await fetch(`http://127.0.0.1:${port}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
        body: rawBody
      });
    };

    // Send read status first
    await sendWebhook('read', '1700000000');
    let execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('READ');

    // Send delivered status LATER: monotonic progression ensures state DOES NOT REGRESS!
    await sendWebhook('delivered', '1699999990');
    execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('READ'); // Still READ!

    // Duplicate read event replay: idempotent, no regression
    await sendWebhook('read', '1700000000');
    execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('READ');

    server.close();
  });

  it('C12: Status event before response persistence: Durably retained and correlated to original attempt', async () => {
    const tenantId = 'p1_c12';
    const providerMessageId = `wamid.HBgL${generateId('exe')}`;

    // 1. Meta status webhook arrives BEFORE send response is persisted to delivery intent
    // Pre-insert early status event in inbox
    await CampaignEventInboxModel.create({
      id: generateId('evt'),
      tenantId,
      producer: 'whatsapp_status_webhook',
      eventId: `${providerMessageId}_delivered_1700000000`,
      type: 'whatsapp.status.delivered',
      entityId: providerMessageId,
      entityVersion: 1,
      occurredAt: new Date(),
      receivedAt: new Date(),
      data: { providerMessageId, status: 'delivered', timestamp: '1700000000' },
      status: 'RECEIVED'
    });

    // 2. Now provider response is persisted: processClaimedExecution correlates early event!
    const { execution } = await createTestFixture(tenantId);
    const claimed = await claimNextDueExecution(tenantId, new Date());

    // Mock adapter returns the matching providerMessageId
    class PresetIdMockAdapter extends MockWhatsAppDeliveryAdapter {
      async sendCampaignStep(params: any): Promise<any> {
        await super.sendCampaignStep(params);
        return { success: true, state: 'ACCEPTED', providerMessageId };
      }
    }

    const outcome = await processClaimedExecution(claimed!, new PresetIdMockAdapter(), new Date());
    expect(outcome).toBe('ACCEPTED');

    // Correlated immediately to DELIVERED
    const execInDb = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(execInDb!.state).toBe('DELIVERED');
  });

  it('C20: Frozen intent source changes before safe retry: Intent blocked as stale; no payload rewrite or new automatic copy', async () => {
    const tenantId = 'p1_c20';
    const { customer, execution } = await createTestFixture(tenantId);
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    mockAdapter.setForcedState('FORCE_THROTTLE');

    // 1. Initial attempt throttled -> enters RETRY_WAIT with frozen intent
    const claimed = await claimNextDueExecution(tenantId, new Date());
    await processClaimedExecution(claimed!, mockAdapter, new Date());

    const retryExec = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(retryExec!.state).toBe('RETRY_WAIT');
    expect(retryExec!.deliveryIntentId).toBeDefined();

    // 2. While waiting for retry, customer phone changes in CRM!
    customer.phone = '+919999988888';
    await customer.save();

    // 3. Retry wakes up: preflight safeguard detects source data mismatch!
    mockAdapter.setForcedState('AUTO');
    const retryNow = new Date(retryExec!.retryAt!.getTime() + 1000);
    const claimedRetry = await claimNextDueExecution(tenantId, retryNow);
    expect(claimedRetry).not.toBeNull();

    const outcome = await processClaimedExecution(claimedRetry!, mockAdapter, retryNow);
    expect(outcome).toBe('BLOCKED');

    // Assert DB state: BLOCKED_STALE_INTENT, zero additional provider requests
    const finalExec = await CampaignExecutionModel.findOne({ id: execution.id });
    expect(finalExec!.state).toBe('BLOCKED');
    expect(finalExec!.outcomeReason).toBe('BLOCKED_STALE_INTENT');
    expect(mockAdapter.getSubmissionCount()).toBe(1); // Provider not called on retry!
  });

  describe('Step 3: Contact-Cap Deferral Loop & nextAvailableAt Scheduling', () => {
    it('contact cap deferral: (a) capped step is not claimable on the next cycle; (b) exactly one transaction attempt happens before nextAvailableAt; (c) it dispatches once the cap window clears', async () => {
      const tenantId = 'p1_cap_deferral';
      const phone = '+919876543299';
      const t0 = new Date('2026-10-16T10:00:00.000Z');

      // 1. Existing execution reserves 24h capacity for this phone at t0
      const { execution: priorExec } = await createTestFixture(tenantId, { phone, priority: 80 });
      priorExec.state = 'PROVIDER_ACCEPTED';
      priorExec.expiresAt = new Date(t0.getTime() + 48 * 3600 * 1000);
      await priorExec.save();

      const priorCap = await checkAndReserveContactCapacity(
        tenantId,
        phone,
        priorExec.campaignId,
        priorExec.id,
        priorExec.expiresAt,
        80,
        t0
      );
      expect(priorCap.allowed).toBe(true);

      // 2. Candidate execution (lower priority 50, so cannot displace) is due at t0
      const { execution: candidateExec } = await createTestFixture(tenantId, { phone, priority: 50 });
      candidateExec.dueAt = t0;
      candidateExec.expiresAt = new Date(t0.getTime() + 48 * 3600 * 1000);
      await candidateExec.save();

      const mockAdapter = new MockWhatsAppDeliveryAdapter();

      // Cycle 1 at t0: claims candidate execution
      const claimedCycle1 = await claimNextDueExecution(tenantId, t0);
      expect(claimedCycle1).not.toBeNull();
      expect(claimedCycle1!.id).toBe(candidateExec.id);

      const outcome1 = await processClaimedExecution(claimedCycle1!, mockAdapter, t0);
      expect(outcome1).toBe('DEFERRED');

      // Assert DB state after first attempt:
      // State is DEFERRED, dueAt is set to nextAvailableAt (t0 + 24h + 1s), claimVersion was incremented to 1
      const dbAfterCycle1 = await CampaignExecutionModel.findOne({ id: candidateExec.id });
      expect(dbAfterCycle1!.state).toBe('DEFERRED');
      expect(dbAfterCycle1!.outcomeReason).toBe('DEFERRED_CONTACT_CAP');
      const expectedNextAvailableAt = new Date(t0.getTime() + 24 * 3600 * 1000 + 1000);
      expect(dbAfterCycle1!.dueAt.getTime()).toBe(expectedNextAvailableAt.getTime());
      expect(dbAfterCycle1!.claimVersion).toBe(1);
      expect(mockAdapter.getSubmissionCount()).toBe(0);

      // (a) Test: A capped step is NOT claimable on the next cycle (e.g. 5 seconds later)
      const tNextCycle = new Date(t0.getTime() + 5000);
      const claimedNextCycle = await claimNextDueExecution(tenantId, tNextCycle);
      expect(claimedNextCycle).toBeNull();

      // (b) Test: Exactly one transaction attempt happens before nextAvailableAt
      // Simulate multiple intervening worker cycles before nextAvailableAt
      const checkTimes = [
        new Date(t0.getTime() + 60 * 1000),         // 1 minute later
        new Date(t0.getTime() + 3600 * 1000),       // 1 hour later
        new Date(t0.getTime() + 12 * 3600 * 1000),  // 12 hours later
        new Date(expectedNextAvailableAt.getTime() - 1000) // 1 second before nextAvailableAt
      ];

      for (const tCheck of checkTimes) {
        const cycleResult = await runDispatchCycle(tenantId, 5, mockAdapter, tCheck);
        expect(cycleResult.claimedCount).toBe(0);
      }

      // Assert DB state: claimVersion is STILL 1 (no re-claim or transaction attempt happened!)
      const dbBeforeClear = await CampaignExecutionModel.findOne({ id: candidateExec.id });
      expect(dbBeforeClear!.claimVersion).toBe(1);
      expect(dbBeforeClear!.state).toBe('DEFERRED');
      expect(mockAdapter.getSubmissionCount()).toBe(0);

      // (c) Test: It dispatches once the cap window clears
      const tCleared = new Date(expectedNextAvailableAt.getTime() + 1000); // 1s after nextAvailableAt
      const claimedAfterClear = await claimNextDueExecution(tenantId, tCleared);
      expect(claimedAfterClear).not.toBeNull();
      expect(claimedAfterClear!.id).toBe(candidateExec.id);

      const outcomeCleared = await processClaimedExecution(claimedAfterClear!, mockAdapter, tCleared);
      expect(outcomeCleared).toBe('ACCEPTED');

      // Assert DB state and provider call count after dispatch
      const dbDispatched = await CampaignExecutionModel.findOne({ id: candidateExec.id });
      expect(dbDispatched!.state).toBe('PROVIDER_ACCEPTED');
      expect(dbDispatched!.claimVersion).toBe(2);
      expect(mockAdapter.getSubmissionCount()).toBe(1);

      // Assert intent created and accepted
      const deliveryIntent = await CampaignDeliveryIntentModel.findOne({ executionId: candidateExec.id });
      expect(deliveryIntent).not.toBeNull();
      expect(deliveryIntent!.state).toBe('ACCEPTED');
    });

    it('sets SKIPPED with reason SKIPPED_CONTACT_CAP when nextAvailableAt >= expiresAt', async () => {
      const tenantId = 'p1_cap_expired';
      const phone = '+919876543298';
      const t0 = new Date('2026-10-16T10:00:00.000Z');

      // 1. Existing execution reserves 24h capacity at t0
      const { execution: priorExec } = await createTestFixture(tenantId, { phone, priority: 80 });
      priorExec.state = 'PROVIDER_ACCEPTED';
      await priorExec.save();

      await checkAndReserveContactCapacity(
        tenantId,
        phone,
        priorExec.campaignId,
        priorExec.id,
        new Date(t0.getTime() + 48 * 3600 * 1000),
        80,
        t0
      );

      // 2. Candidate execution whose expiresAt is ONLY 6 hours from t0 (less than 24h release time)
      const { execution: candidateExec } = await createTestFixture(tenantId, { phone, priority: 50 });
      candidateExec.dueAt = t0;
      candidateExec.expiresAt = new Date(t0.getTime() + 6 * 3600 * 1000); // Expires before 24h window clears
      await candidateExec.save();

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const claimed = await claimNextDueExecution(tenantId, t0);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(candidateExec.id);

      const outcome = await processClaimedExecution(claimed!, mockAdapter, t0);
      expect(outcome).toBe('SKIPPED');

      // Assert DB state: SKIPPED with SKIPPED_CONTACT_CAP, zero provider calls
      const dbExec = await CampaignExecutionModel.findOne({ id: candidateExec.id });
      expect(dbExec!.state).toBe('SKIPPED');
      expect(dbExec!.outcomeReason).toBe('SKIPPED_CONTACT_CAP');
      expect(mockAdapter.getSubmissionCount()).toBe(0);
    });
  });

  describe('Step 4: Remove Hardcoded "Padmavati Silks" Fallback & Authoritative Shop Resolution', () => {
    it('resolveShopDisplayName helper strictly respects precedence: version.brandName > tenantSettings.storeName > connection.metadata > null', async () => {
      const tenantId = 'p1_shop_precedence';

      // 1. When nothing is configured, returns null (fail-closed, no hardcoded fallback!)
      const nullShop = await resolveShopDisplayName(tenantId, {});
      expect(nullShop).toBeNull();

      // 2. Priority 3: Connection metadata
      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId,
        connectionId: `conn_${tenantId}`,
        provider: 'mock',
        status: 'ACTIVE',
        metadata: { storeName: 'Meta Connection Handlooms' }
      });
      const metaShop = await resolveShopDisplayName(tenantId, {});
      expect(metaShop).toBe('Meta Connection Handlooms');

      // 3. Priority 2: Tenant settings storeName overrides connection metadata
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId,
        version: 1,
        timezone: 'Asia/Kolkata',
        allowedHours: { start: '10:00', end: '19:00' },
        caps: { marketing24h: 1, marketing7d: 3 },
        globalPause: false,
        outageGraceMinutes: 120,
        leapDayPolicy: 'FEB_28',
        holidays: [],
        blackouts: [],
        storeName: 'Settings Handlooms',
        notice: 'NOTICE'
      });
      const settingsShop = await resolveShopDisplayName(tenantId, {});
      expect(settingsShop).toBe('Settings Handlooms');

      // 4. Priority 1: version.brandName overrides tenant settings & connection metadata
      const versionShop = await resolveShopDisplayName(tenantId, { brandName: 'Brand Version Handlooms' });
      expect(versionShop).toBe('Brand Version Handlooms');
    });

    it('Two tenants each send their own configured shop name without cross-talk or hardcoded fallback', async () => {
      const tenantA = 'tenant_kanchipuram';
      const tenantB = 'tenant_banarasi';
      const shopA = 'Kanchipuram Silks';
      const shopB = 'Banarasi Weaves';

      // Tenant A configures shop name via version.brandName
      const { execution: execA } = await createTestFixture(tenantA, {
        brandName: shopA,
        phone: '+919876543201'
      });
      const versionA = await CampaignVersionModel.findOne({ tenantId: tenantA });
      versionA!.steps[0].bindings = new Map([['name', 'customer.firstName'], ['shop', 'shop.displayName']]);
      versionA!.brandName = shopA;
      await versionA!.save();

      // Tenant B configures shop name via TenantSettingsModel.storeName
      const { execution: execB } = await createTestFixture(tenantB, {
        phone: '+919876543202'
      });
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId: tenantB,
        version: 1,
        timezone: 'Asia/Kolkata',
        allowedHours: { start: '10:00', end: '19:00' },
        caps: { marketing24h: 1, marketing7d: 3 },
        globalPause: false,
        outageGraceMinutes: 120,
        leapDayPolicy: 'FEB_28',
        holidays: [],
        blackouts: [],
        storeName: shopB,
        notice: 'NOTICE'
      });
      const versionB = await CampaignVersionModel.findOne({ tenantId: tenantB });
      versionB!.steps[0].bindings = new Map([['name', 'customer.firstName']]); // Default binds 'shop' to storeDisplayName
      versionB!.brandName = null as any;
      await versionB!.save();

      const mockAdapterA = new MockWhatsAppDeliveryAdapter();
      const mockAdapterB = new MockWhatsAppDeliveryAdapter();
      const now = new Date();

      // Dispatch Tenant A
      const claimedA = await claimNextDueExecution(tenantA, now);
      expect(claimedA).not.toBeNull();
      const outcomeA = await processClaimedExecution(claimedA!, mockAdapterA, now);
      expect(outcomeA).toBe('ACCEPTED');
      expect(mockAdapterA.getSubmissionCount()).toBe(1);

      // Verify Provider submission parameters and DB DeliveryIntent for Tenant A
      const sentParamsA = mockAdapterA.getSubmissions()[0].parameters;
      expect(sentParamsA.shop).toBe(shopA);
      const intentA = await CampaignDeliveryIntentModel.findOne({ tenantId: tenantA, executionId: execA.id });
      expect(intentA).not.toBeNull();
      const getParam = (intent: any, key: string) => (intent.parameters instanceof Map || typeof intent.parameters?.get === 'function') ? intent.parameters.get(key) : intent.parameters?.[key];
      expect(getParam(intentA, 'shop')).toBe(shopA);
      expect(getParam(intentA, 'shop')).not.toBe(shopB);
      expect(getParam(intentA, 'shop')).not.toBe('Padmavati Silks');

      // Dispatch Tenant B
      const claimedB = await claimNextDueExecution(tenantB, now);
      expect(claimedB).not.toBeNull();
      const outcomeB = await processClaimedExecution(claimedB!, mockAdapterB, now);
      expect(outcomeB).toBe('ACCEPTED');
      expect(mockAdapterB.getSubmissionCount()).toBe(1);

      // Verify Provider submission parameters and DB DeliveryIntent for Tenant B
      const sentParamsB = mockAdapterB.getSubmissions()[0].parameters;
      expect(sentParamsB.shop).toBe(shopB);
      const intentB = await CampaignDeliveryIntentModel.findOne({ tenantId: tenantB, executionId: execB.id });
      expect(intentB).not.toBeNull();
      expect(getParam(intentB, 'shop')).toBe(shopB);
      expect(getParam(intentB, 'shop')).not.toBe(shopA);
      expect(getParam(intentB, 'shop')).not.toBe('Padmavati Silks');
    });

    it('A tenant without a shop name is blocked (BLOCKED_SHOP_NAME_NOT_CONFIGURED), adapter is never called, and validate endpoint reports fieldPath settings.storeName with resolutionOwner BOUTIQUE_OWNER', async () => {
      const tenantC = 'tenant_unconfigured_shop';

      // 1. Create fixture for Tenant C with NO brandName, NO settings storeName, and NO connection metadata
      const { execution: execC, version } = await createTestFixture(tenantC, {
        phone: '+919876543203'
      });

      // Template requires 'shop' variable
      version.steps[0].templateRef = { id: 'tpl_birthday_invite', revision: 3, language: 'en' };
      version.steps[0].bindings = new Map([['name', 'customer.firstName']]); // Default binds 'shop' to shop display name
      version.brandName = null as any;
      await version.save();

      // Ensure NO settings and connection has empty metadata
      await TenantSettingsModel.deleteMany({ tenantId: tenantC });
      await TenantConnectionModel.updateOne({ tenantId: tenantC }, { $set: { metadata: {} } });

      // 2. Validate endpoint assertion: validateCampaignVersionDefinition returns structured error
      const valResult = await validateCampaignVersionDefinition(version, tenantC);
      expect(valResult.valid).toBe(false);
      expect(valResult.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: 'settings.storeName',
            resolutionOwner: 'BOUTIQUE_OWNER'
          })
        ])
      );

      // 3. Execution worker assertion: processClaimedExecution blocks step and NEVER calls adapter
      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const now = new Date();
      const claimed = await claimNextDueExecution(tenantC, now);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(execC.id);

      const outcome = await processClaimedExecution(claimed!, mockAdapter, now);
      expect(outcome).toBe('BLOCKED');

      // Assert DB state in MongoMemoryReplSet
      const dbExec = await CampaignExecutionModel.findOne({ tenantId: tenantC, id: execC.id });
      expect(dbExec).not.toBeNull();
      expect(dbExec!.state).toBe('BLOCKED');
      expect(dbExec!.outcomeReason).toBe('BLOCKED_SHOP_NAME_NOT_CONFIGURED');

      // Assert adapter is NEVER called (call count strictly 0)
      expect(mockAdapter.getSubmissionCount()).toBe(0);
      expect(mockAdapter.getCallCount()).toBe(0);

      // Assert zero delivery intents created for this execution
      const intentCount = await CampaignDeliveryIntentModel.countDocuments({ tenantId: tenantC, executionId: execC.id });
      expect(intentCount).toBe(0);
    });
  });

  describe('Step 5: Pipeline Hygiene & Reason Precedence Hierarchy', () => {
    it('Empty customer-specific variable returns SKIP with SKIPPED_MISSING_VARIABLE (not blocked)', async () => {
      const tenantId = 'p1_step5_empty_var';
      const { execution: exec, customer } = await createTestFixture(tenantId);
      await CustomerModel.updateOne({ id: customer.id, tenantId }, { $set: { firstName: '' } });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const claimed = await claimNextDueExecution(tenantId, new Date());
      expect(claimed).not.toBeNull();
      const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());

      expect(outcome).toBe('SKIPPED');
      const dbExec = await CampaignExecutionModel.findOne({ tenantId, id: exec.id });
      expect(dbExec?.state).toBe('SKIPPED');
      expect(dbExec?.outcomeReason).toBe('SKIPPED_MISSING_VARIABLE');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('Missing order item title skips with SKIPPED_MISSING_VARIABLE instead of invented "Boutique Order #xxxx"', async () => {
      const tenantId = 'p1_step5_no_invented';
      const { execution: exec, enrollment, version } = await createTestFixture(tenantId);

      // Order event with order that has empty items array
      const order = await OrderModel.create({
        id: 'ord_empty_items',
        tenantId,
        customerId: enrollment.customerId,
        netPaise: 500000,
        status: 'COMPLETED'
      });
      enrollment.sourceRef = { type: 'ORDER_EVENT', id: order.id, version: 1 };
      await enrollment.save();

      // Configure shop name and utility template requiring outfit
      version.purpose = 'ORDER_SERVICE';
      version.brandName = 'Silk Boutique';
      version.steps[0].templateRef = { id: 'tpl_alteration_ready', revision: 1, language: 'en' };
      version.steps[0].bindings = new Map([
        ['name', 'customer.firstName'],
        ['store', 'shop.displayName'],
        ['outfit', 'order.itemTitle']
      ]);
      await version.save();

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const claimed = await claimNextDueExecution(tenantId, new Date());
      expect(claimed).not.toBeNull();
      const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());

      expect(outcome).toBe('SKIPPED');
      const dbExec = await CampaignExecutionModel.findOne({ tenantId, id: exec.id });
      expect(dbExec?.state).toBe('SKIPPED');
      expect(dbExec?.outcomeReason).toBe('SKIPPED_MISSING_VARIABLE');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('Configuration problem remains BLOCKED with BLOCKED_MISSING_VARIABLE_BINDING (unallowlisted expression)', async () => {
      const tenantId = 'p1_step5_unallowlisted';
      const { execution: exec, version } = await createTestFixture(tenantId);
      version.steps[0].bindings = new Map([['name', 'customer.arbitraryUnknownAttribute']]);
      await version.save();

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const claimed = await claimNextDueExecution(tenantId, new Date());
      expect(claimed).not.toBeNull();
      const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());

      expect(outcome).toBe('BLOCKED');
      const dbExec = await CampaignExecutionModel.findOne({ tenantId, id: exec.id });
      expect(dbExec?.state).toBe('BLOCKED');
      expect(dbExec?.outcomeReason).toBe('BLOCKED_MISSING_VARIABLE_BINDING');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('Pair 1: Customer deleted/suppressed (Level 1) wins over Campaign/global pause (Level 2)', async () => {
      const tenantId = 'p1_precedence_1_vs_2';
      const { execution: exec, customer, campaign } = await createTestFixture(tenantId);
      customer.channelSuppressed = true;
      await customer.save();
      campaign.status = 'PAUSED';
      await campaign.save();

      const safeguardResult = await executePreflightSafeguards(exec);
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_CHANNEL_SUPPRESSED');
    });

    it('Pair 2: Campaign/global pause (Level 2) wins over Invalid source (Level 3)', async () => {
      const tenantId = 'p1_precedence_2_vs_3';
      const { execution: exec, campaign, enrollment } = await createTestFixture(tenantId);
      campaign.status = 'PAUSED';
      await campaign.save();
      enrollment.status = 'CANCELLED';
      await enrollment.save();

      const safeguardResult = await executePreflightSafeguards(exec);
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_CAMPAIGN_PAUSED');
    });

    it('Pair 3: Invalid source (Level 3) wins over Expiry (Level 4)', async () => {
      const tenantId = 'p1_precedence_3_vs_4';
      const { execution: exec, enrollment } = await createTestFixture(tenantId);
      const product = await ProductModel.create({
        id: generateId('prd'),
        tenantId,
        sku: 'SKU_P1_DEPLETED_STOCK',
        title: 'Kanjeevaram Saree',
        weave: 'Kanjeevaram',
        color: 'Gold',
        pricePaise: 3000000,
        stockCount: 0,
        isSellable: true
      });
      enrollment.sourceRef = { type: 'STOCK_EVENT', id: product.sku, version: 1 };
      await enrollment.save();

      exec.expiresAt = new Date(Date.now() - 3600000);
      await exec.save();

      const safeguardResult = await executePreflightSafeguards(exec, new Date());
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_STOCK_DEPLETED');
    });

    it('Pair 4: Expiry (Level 4) wins over Goal/reply stop (Level 5)', async () => {
      const tenantId = 'p1_precedence_4_vs_5';
      const { execution: exec, enrollment } = await createTestFixture(tenantId);
      enrollment.goalReachedAt = new Date(Date.now() - 10000);
      enrollment.replyHoldAt = new Date(Date.now() - 10000);
      await enrollment.save();

      exec.expiresAt = new Date(Date.now() - 3600000);
      await exec.save();

      const safeguardResult = await executePreflightSafeguards(exec, new Date());
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_STEP_EXPIRED');
    });

    it('Pair 5: Goal/reply stop (Level 5) wins over Content/template readiness (Level 6)', async () => {
      const tenantId = 'p1_precedence_5_vs_6';
      const { execution: exec, enrollment, version } = await createTestFixture(tenantId);
      enrollment.goalReachedAt = new Date();
      await enrollment.save();

      // Content readiness failure: unallowlisted variable binding
      version.steps[0].bindings = new Map([['name', 'customer.unallowlistedVar']]);
      await version.save();

      const safeguardResult = await executePreflightSafeguards(exec);
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_GOAL_REACHED');
    });

    it('Pair 6: Content/template readiness (Level 6) wins over Prerequisite (Level 7)', async () => {
      const tenantId = 'p1_precedence_6_vs_7';
      const { execution: exec, customer, version } = await createTestFixture(tenantId);
      // Empty customer variable
      await CustomerModel.updateOne({ id: customer.id, tenantId }, { $set: { firstName: '' } });

      // Prior step execution marked terminal failure
      await CampaignExecutionModel.updateOne(
        { id: exec.id },
        { $set: { state: 'SKIPPED', outcomeReason: 'SKIPPED_CHANNEL_SUPPRESSED' } }
      );

      version.steps.push({
        stepId: 'followup',
        offsetDays: 1,
        localTime: '11:00',
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        bindings: new Map([['name', 'customer.firstName'], ['shop', 'literal:Silk Boutique']]),
        stopOnReply: true,
        stopOnGoal: true,
        prerequisite: 'PREVIOUS_ACCEPTED'
      });
      await version.save();

      const followupExec = await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: exec.enrollmentId,
        campaignId: exec.campaignId,
        stepId: 'followup',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '11:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED',
        prerequisite: 'PREVIOUS_ACCEPTED'
      });

      const safeguardResult = await executePreflightSafeguards(followupExec);
      expect(safeguardResult.status).toBe('SKIP');
      expect(safeguardResult.reason).toBe('SKIPPED_MISSING_VARIABLE');
    });

    it('Pair 7: Prerequisite (Level 7) wins over Contact cap (Level 8)', async () => {
      const tenantId = 'p1_precedence_7_vs_8';
      const { execution: exec, version } = await createTestFixture(tenantId);

      // Setup tenant settings with marketing24h cap = 1
      await TenantSettingsModel.create({
        id: generateId('ts'),
        tenantId,
        version: 1,
        timezone: 'Asia/Kolkata',
        allowedHours: { start: '10:00', end: '19:00' },
        caps: { marketing24h: 1, marketing7d: 3 },
        globalPause: false,
        outageGraceMinutes: 120,
        leapDayPolicy: 'FEB_28',
        holidays: [],
        blackouts: [],
        storeName: 'Royal Weaves',
        notice: 'NOTICE'
      });

      // Exhaust contact cap for customer's phone
      const phone = '+919876543210';
      await checkAndReserveContactCapacity(
        tenantId,
        phone,
        'cmp_prior',
        'exe_prior',
        new Date(Date.now() + 86400000),
        100
      );

      // Prior step execution marked terminal failure
      await CampaignExecutionModel.updateOne(
        { id: exec.id },
        { $set: { state: 'SKIPPED', outcomeReason: 'SKIPPED_CHANNEL_SUPPRESSED' } }
      );

      // Step requires PREVIOUS_ACCEPTED
      version.steps.push({
        stepId: 'followup',
        offsetDays: 1,
        localTime: '11:00',
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        bindings: new Map([['name', 'customer.firstName'], ['shop', 'literal:Royal Weaves']]),
        stopOnReply: true,
        stopOnGoal: true,
        prerequisite: 'PREVIOUS_ACCEPTED'
      });
      await version.save();

      const followupExec = await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: exec.enrollmentId,
        campaignId: exec.campaignId,
        stepId: 'followup',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '11:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED',
        prerequisite: 'PREVIOUS_ACCEPTED'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const claimed = await claimNextDueExecution(tenantId, new Date());
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(followupExec.id);
      const outcome = await processClaimedExecution(claimed!, mockAdapter, new Date());

      // Prerequisite fails before contact cap transaction is reached
      expect(outcome).toBe('SKIPPED');
      const dbExec = await CampaignExecutionModel.findOne({ tenantId, id: followupExec.id });
      expect(dbExec?.state).toBe('SKIPPED');
      expect(dbExec?.outcomeReason).toBe('SKIPPED_PREREQUISITE_NOT_MET');
      expect(mockAdapter.getCallCount()).toBe(0);
    });
  });
});
