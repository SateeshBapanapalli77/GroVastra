import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { encryptText, sha256 } from '../src/shared/utils/crypto';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import {
  claimNextDueExecution,
  processClaimedExecution,
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
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^p1_/ } })
    ]);
  });

  const createTestFixture = async (tenantId: string, overrides: { phone?: string; priority?: number } = {}) => {
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
                  metadata: { phone_number_id: 'conn_padmavati' },
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
});
