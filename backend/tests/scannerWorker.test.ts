import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDatabase } from './setupTestDb';
import {
  runScannerCycleForTenant,
  runScannerPass,
  detectStalledCheckpoints,
  DEFAULT_SCANNER_INTERVAL_MS
} from '../src/workers/scanner';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignCustomerFactModel } from '../src/modules/campaigns/models/CampaignCustomerFact.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignCheckpointModel } from '../src/modules/campaigns/models/CampaignCheckpoint.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { updateCustomerPurchaseFact, handleOrderRefundFact } from '../src/modules/campaigns/engine/lifecycleStrategy';
import { generateId } from '../src/shared/utils/id';

describe('Step 9: Scheduled Inactivity Scan Worker & Win-Back Strategy', () => {
  const tenantId = 'qa_tenant_scanner';
  const tenantB = 'qa_tenant_scanner_beta';

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CampaignVersionModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CampaignCustomerFactModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CampaignCheckpointModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } }),
      CustomerModel.deleteMany({ tenantId: { $in: [tenantId, tenantB] } })
    ]);
  });

  async function createActiveCustomer(id: string = 'cus_scan_01') {
    return CustomerModel.create({
      id,
      tenantId,
      firstName: 'Ananya',
      lastName: 'Rao',
      phone: '+919876543210',
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false
    });
  }

  async function setupWinbackCampaign(params?: {
    campaignId?: string;
    versionId?: string;
    inactivityDays?: number;
  }) {
    const campaignId = params?.campaignId || 'cmp_winback_pilot';
    const versionId = params?.versionId || 'cv_winback_pilot';
    const inactivityDays = params?.inactivityDays ?? 90;

    await CampaignModel.create({
      id: campaignId,
      tenantId,
      name: '90-Day Boutique Win-Back',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'ACTIVE',
      activeVersionId: versionId,
      presetId: 'preset_winback_inactive',
      draftVersion: 1,
      pauseGeneration: 0
    });

    return CampaignVersionModel.create({
      id: versionId,
      tenantId,
      campaignId,
      version: 1,
      name: '90-Day Boutique Win-Back',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: {
        type: 'INACTIVITY_SCAN',
        inactivityDays
      },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'winback_nudge',
          offsetDays: 0,
          localTime: '11:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
          bindings: {},
          stopOnReply: true,
          stopOnGoal: true,
          maxLatenessMinutes: 180
        }
      ],
      priority: 30,
      publishedBy: 'system',
      reviewFingerprint: `fp_${versionId}`
    });
  }

  describe('1. Checkpoint Leases & Concurrency Protection', () => {
    it('leases checkpoint in campaignCheckpoints so two instances never run the same scan twice', async () => {
      await setupWinbackCampaign();
      const customer = await createActiveCustomer();

      const orderDate = new Date(Date.now() - 120 * 24 * 3600 * 1000);
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_ancient_01',
        purchaseAt: orderDate,
        netPaise: 5000000
      });

      // Set nextEvaluationAt to be due now
      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customer.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Simulate Instance 1 claiming lease
      const instance1Promise = runScannerCycleForTenant(tenantId, {
        workerId: 'worker_node_1',
        leaseDurationMs: 10000 // 10s lease
      });

      // Simulate Instance 2 attempting concurrent scan while Instance 1 is running
      // By manually setting an active lease on checkpoint:
      await CampaignCheckpointModel.updateOne(
        { tenantId, workerType: 'INACTIVITY_EVALUATOR' },
        {
          $set: {
            'lease.token': 'lease_concurrent_held',
            'lease.until': new Date(Date.now() + 60000), // active for 60s
            'lease.claimedBy': 'worker_node_locked'
          }
        },
        { upsert: true }
      );

      const instance2Result = await runScannerCycleForTenant(tenantId, {
        workerId: 'worker_node_2'
      });

      // Instance 2 must be rejected with SKIPPED_ALREADY_LEASED
      expect(instance2Result.claimed).toBe(false);
      expect(instance2Result.checkpointStatus).toBe('SKIPPED_ALREADY_LEASED');
      expect(instance2Result.enrolledCount).toBe(0);

      // Now clear artificial lock and let real instance run
      await CampaignCheckpointModel.updateOne(
        { tenantId, workerType: 'INACTIVITY_EVALUATOR' },
        {
          $set: {
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null,
            completedAt: null
          }
        }
      );

      const realRun = await runScannerCycleForTenant(tenantId, {
        workerId: 'worker_real_node'
      });

      expect(realRun.claimed).toBe(true);
      expect(realRun.checkpointStatus).toBe('LEASED_AND_PROCESSED');
      expect(realRun.enrolledCount).toBe(1);

      // Assert DB state: checkpoint is marked completed and lease is freed
      const checkpoint = await CampaignCheckpointModel.findOne({ tenantId, workerType: 'INACTIVITY_EVALUATOR' });
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.completedAt).not.toBeNull();
      expect(checkpoint?.lease.token).toBeNull();
      expect(checkpoint?.cursor.enrolledCount).toBe(1);

      // Consecutive run within interval is skipped as SKIPPED_NOT_DUE
      const immediateRerun = await runScannerCycleForTenant(tenantId, {
        workerId: 'worker_node_1'
      });
      expect(immediateRerun.claimed).toBe(false);
      expect(immediateRerun.checkpointStatus).toBe('SKIPPED_NOT_DUE');
    });

    it('detects stalled checkpoint alert state and safely recovers execution', async () => {
      await setupWinbackCampaign();

      // Create a stalled checkpoint (lease expired 10 minutes ago, never completed)
      await CampaignCheckpointModel.create({
        id: generateId('chk'),
        tenantId,
        workerType: 'INACTIVITY_EVALUATOR',
        lastRunAt: new Date(Date.now() - 35 * 60 * 1000), // 35m ago
        completedAt: null,
        lease: {
          token: 'lease_dead_worker',
          until: new Date(Date.now() - 10 * 60 * 1000), // expired 10m ago
          claimedBy: 'dead_instance_pid_9999'
        }
      });

      // Detect stalled state
      const report = await detectStalledCheckpoints(tenantId);
      expect(report.count).toBe(1);
      expect(report.stalledTenantIds).toContain(tenantId);

      // Scanner execution recovers the stalled checkpoint
      const recoverResult = await runScannerCycleForTenant(tenantId, {
        workerId: 'rescuing_worker'
      });

      expect(recoverResult.isStalled).toBe(true);
      expect(recoverResult.checkpointStatus).toBe('STALLED_RECOVERED');
      expect(recoverResult.claimed).toBe(true);

      const refreshed = await CampaignCheckpointModel.findOne({ tenantId, workerType: 'INACTIVITY_EVALUATOR' });
      expect(refreshed?.completedAt).not.toBeNull();
      expect(refreshed?.lease.token).toBeNull();
    });
  });

  describe('2. Inactivity Evaluator Lifecycle Rules (A13, A14, B17)', () => {
    it('repeated scans create one win-back enrollment', async () => {
      await setupWinbackCampaign();
      const customer = await createActiveCustomer();

      const purchaseDate = new Date(Date.now() - 100 * 24 * 3600 * 1000); // 100d ago (exceeds 90d)
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_lapse_101',
        purchaseAt: purchaseDate,
        netPaise: 4500000
      });

      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customer.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Scan 1: creates enrollment and execution
      const pass1 = await runScannerCycleForTenant(tenantId, { forceDue: true });
      expect(pass1.enrolledCount).toBe(1);

      const enrollmentsCount = await CampaignEnrollmentModel.countDocuments({
        tenantId,
        customerId: customer.id
      });
      const executionsCount = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(enrollmentsCount).toBe(1);
      expect(executionsCount).toBe(1);

      const enr = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      expect(enr?.occurrenceId).toBe('winback:ord_lapse_101:cv_winback_pilot');
      expect(enr?.status).toBe('ACTIVE');

      // Scan 2 (repeated scan): must create nothing new (idempotent occurrence)
      const pass2 = await runScannerCycleForTenant(tenantId, { forceDue: true });
      expect(pass2.enrolledCount).toBe(0);

      expect(await CampaignEnrollmentModel.countDocuments({ tenantId, customerId: customer.id })).toBe(1);
      expect(await CampaignExecutionModel.countDocuments({ tenantId })).toBe(1);
    });

    it('a new purchase cancels the old one and resets the anchor', async () => {
      await setupWinbackCampaign();
      const customer = await createActiveCustomer();

      const initialOrderDate = new Date(Date.now() - 110 * 24 * 3600 * 1000);
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_old_inactive',
        purchaseAt: initialOrderDate,
        netPaise: 7500000
      });

      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customer.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Run scan: customer is enrolled in winback
      const pass = await runScannerCycleForTenant(tenantId, { forceDue: true });
      expect(pass.enrolledCount).toBe(1);

      const oldEnrollment = await CampaignEnrollmentModel.findOne({
        tenantId,
        customerId: customer.id,
        occurrenceId: 'winback:ord_old_inactive:cv_winback_pilot'
      });
      expect(oldEnrollment?.status).toBe('ACTIVE');

      const oldExecution = await CampaignExecutionModel.findOne({
        tenantId,
        enrollmentId: oldEnrollment?.id
      });
      expect(oldExecution?.state).toBe('SCHEDULED');

      // Customer makes a NEW purchase today before the winback step is delivered
      const newPurchaseDate = new Date();
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_new_recent_202',
        purchaseAt: newPurchaseDate,
        netPaise: 9000000
      });

      // Assert DB State: Old enrollment is CANCELLED, scheduled execution is SKIPPED
      const updatedOldEnrollment = await CampaignEnrollmentModel.findOne({
        tenantId,
        id: oldEnrollment?.id
      });
      expect(updatedOldEnrollment?.status).toBe('CANCELLED');
      expect(updatedOldEnrollment?.goalOrderRef).toBe('ord_new_recent_202');

      const updatedOldExecution = await CampaignExecutionModel.findOne({
        tenantId,
        id: oldExecution?.id
      });
      expect(updatedOldExecution?.state).toBe('SKIPPED');
      expect(updatedOldExecution?.outcomeReason).toBe('SKIPPED_GOAL_REACHED');

      // Assert Inactivity Anchor is reset to the new purchase date (90 days forward)
      const fact = await CampaignCustomerFactModel.findOne({ tenantId, customerId: customer.id });
      expect(fact?.lastQualifyingOrderId).toBe('ord_new_recent_202');
      expect(fact?.lastQualifyingPurchaseAt).toEqual(newPurchaseDate);
      expect(fact?.nextEvaluationAt?.getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);

      // Running scanner again does NOT enroll customer because they are not inactive
      const passAfterNewPurchase = await runScannerCycleForTenant(tenantId, { forceDue: true });
      expect(passAfterNewPurchase.enrolledCount).toBe(0);
    });

    it('a refund that restores an older anchor does not re-enroll a completed occurrence', async () => {
      await setupWinbackCampaign();
      const customer = await createActiveCustomer();

      const order1Date = new Date(Date.now() - 150 * 24 * 3600 * 1000);
      const order2Date = new Date(Date.now() - 20 * 24 * 3600 * 1000);

      // Order 1 was made 150 days ago and its win-back enrollment was already completed
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_prior_101',
        purchaseAt: order1Date,
        netPaise: 3000000
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_winback_completed',
        tenantId,
        campaignId: 'cmp_winback_pilot',
        campaignVersionId: 'cv_winback_pilot',
        customerId: customer.id,
        occurrenceId: 'winback:ord_prior_101:cv_winback_pilot',
        sourceRef: { type: 'ORDER_EVENT', id: 'ord_prior_101', version: 1 },
        planRevision: 1,
        status: 'COMPLETED',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Order 2 was made 20 days ago (active recent anchor)
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customer.id,
        orderId: 'ord_refund_target',
        purchaseAt: order2Date,
        netPaise: 6000000
      });

      const factBeforeRefund = await CampaignCustomerFactModel.findOne({ tenantId, customerId: customer.id });
      expect(factBeforeRefund?.lastQualifyingOrderId).toBe('ord_refund_target');

      // Order 2 is refunded! Order 1 is restored as remaining anchor
      const recomputedFact = await handleOrderRefundFact(
        tenantId,
        customer.id,
        'ord_refund_target',
        [{ orderId: 'ord_prior_101', purchaseAt: order1Date }]
      );

      expect(recomputedFact?.lastQualifyingOrderId).toBe('ord_prior_101');
      expect(recomputedFact?.lastQualifyingPurchaseAt).toEqual(order1Date);

      // Update nextEvaluationAt to be evaluated now
      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customer.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Run scanner pass: Order 1 win-back occurrence was already COMPLETED, so 0 new enrollments created
      const scanAfterRefund = await runScannerCycleForTenant(tenantId, { forceDue: true });
      expect(scanAfterRefund.enrolledCount).toBe(0);

      const totalWinbackEnrollments = await CampaignEnrollmentModel.countDocuments({
        tenantId,
        customerId: customer.id,
        occurrenceId: 'winback:ord_prior_101:cv_winback_pilot'
      });
      expect(totalWinbackEnrollments).toBe(1);

      const existingEnr = await CampaignEnrollmentModel.findOne({
        tenantId,
        customerId: customer.id,
        occurrenceId: 'winback:ord_prior_101:cv_winback_pilot'
      });
      expect(existingEnr?.status).toBe('COMPLETED');
    });

    it('runScannerPass iterates across multiple distinct tenants safely', async () => {
      // Tenant A setup
      await setupWinbackCampaign();
      const customerA = await createActiveCustomer('cus_tenant_a');
      await updateCustomerPurchaseFact({
        tenantId,
        customerId: customerA.id,
        orderId: 'ord_a_99',
        purchaseAt: new Date(Date.now() - 100 * 24 * 3600 * 1000),
        netPaise: 4000000
      });
      await CampaignCustomerFactModel.updateOne(
        { tenantId, customerId: customerA.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Tenant B setup
      await CampaignModel.create({
        id: 'cmp_winback_b',
        tenantId: tenantB,
        name: 'Tenant B Win-Back',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_winback_b',
        presetId: 'preset_winback_inactive',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_winback_b',
        tenantId: tenantB,
        campaignId: 'cmp_winback_b',
        version: 1,
        name: 'Tenant B Win-Back',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'INACTIVITY_SCAN', inactivityDays: 60 },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'winback_nudge',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
            bindings: {},
            maxLatenessMinutes: 180
          }
        ],
        priority: 30,
        publishedBy: 'system',
        reviewFingerprint: 'fp_b'
      });

      const customerB = await CustomerModel.create({
        id: 'cus_tenant_b',
        tenantId: tenantB,
        firstName: 'Divya',
        lastName: 'Menon',
        phone: '+919876543299',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      await updateCustomerPurchaseFact({
        tenantId: tenantB,
        customerId: customerB.id,
        orderId: 'ord_b_88',
        purchaseAt: new Date(Date.now() - 75 * 24 * 3600 * 1000),
        netPaise: 6500000
      });
      await CampaignCustomerFactModel.updateOne(
        { tenantId: tenantB, customerId: customerB.id },
        { $set: { nextEvaluationAt: new Date(Date.now() - 1000) } }
      );

      // Execute multi-tenant scanner pass
      const passSummary = await runScannerPass({ forceDue: true });

      expect(passSummary.tenantsEvaluated).toBeGreaterThanOrEqual(2);
      expect(passSummary.totalEnrolledCount).toBe(2);

      const chkA = await CampaignCheckpointModel.findOne({ tenantId, workerType: 'INACTIVITY_EVALUATOR' });
      const chkB = await CampaignCheckpointModel.findOne({ tenantId: tenantB, workerType: 'INACTIVITY_EVALUATOR' });
      expect(chkA?.completedAt).not.toBeNull();
      expect(chkB?.completedAt).not.toBeNull();
    });
  });
});
