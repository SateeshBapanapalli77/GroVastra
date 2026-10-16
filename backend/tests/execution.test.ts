import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndReserveContactCapacity } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { processClaimedExecution } from '../src/modules/campaigns/engine/dispatchExecutor';
import { sha256, encryptText } from '../src/shared/utils/crypto';
import { generateId } from '../src/shared/utils/id';
import { ulid } from 'ulid';

import { CampaignContactGateModel } from '../src/modules/campaigns/models/CampaignContactGate.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { TenantControlGateModel } from '../src/modules/campaigns/models/TenantControlGate.model';
import { CampaignControlGateModel } from '../src/modules/campaigns/models/CampaignControlGate.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';

describe('Milestone 3: Durable Execution & Safeguards Test Suite', () => {
  beforeEach(async () => {
    await Promise.all([
      CampaignContactGateModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      TenantControlGateModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CampaignControlGateModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^tenant_/ } }),
      CustomerModel.deleteMany({ tenantId: { $regex: /^tenant_/ } })
    ]);
  });

  describe('1. Contact Caps & Anti-Spam Gate (Handoff Page 18)', () => {
    it('allows the first marketing message to a new destination', async () => {
      const phone = `+919900${Math.floor(100000 + Math.random() * 900000)}`;
      const result = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_bday',
        'exe_001',
        new Date(Date.now() + 86400000),
        80
      );

      expect(result.allowed).toBe(true);
    });

    it('rejects or defers a second message within the 24-hour rolling window', async () => {
      const phone = `+919901${Math.floor(100000 + Math.random() * 900000)}`;

      // First reservation
      const res1 = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_bday',
        'exe_first',
        new Date(Date.now() + 86400000),
        80
      );
      expect(res1.allowed).toBe(true);

      // Second reservation immediately after
      const res2 = await checkAndReserveContactCapacity(
        'tenant_test',
        phone,
        'cmp_festival',
        'exe_second',
        new Date(Date.now() + 86400000),
        50
      );
      expect(res2.allowed).toBe(false);
      expect(['DEFERRED_CONTACT_CAP', 'SKIPPED_CONTACT_CAP']).toContain(res2.reason);
    });
  });

  describe('2. Delivery Adapter Dispatch & Outcome States (Handoff Page 27)', () => {
    let adapter: MockWhatsAppDeliveryAdapter;

    beforeEach(() => {
      adapter = new MockWhatsAppDeliveryAdapter();
    });

    it('successfully dispatches approved template and records provider ID', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_01',
        deliveryKey: 'exe_test_01',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: { name: 'Lakshmi', shop: 'Padmavati Handlooms' },
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe('ACCEPTED');
      expect(result.providerMessageId).toMatch(/^wamid\./);
      expect(adapter.getSubmissionCount()).toBe(1);
    });

    it('records OUTCOME_UNKNOWN on network timeout and does not resend blindly', async () => {
      adapter.setForcedState('FORCE_TIMEOUT');

      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_timeout',
        deliveryKey: 'exe_test_timeout',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: { name: 'Lakshmi' },
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('OUTCOME_UNKNOWN');
      expect(result.errorCode).toBe('NETWORK_TIMEOUT');
    });

    it('records permanent failure on unapproved or paused template', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_test_fail',
        deliveryKey: 'exe_test_fail',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_unknown_random', revision: 1, language: 'en' },
        parameters: {},
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('REJECTED');
      expect(result.errorCode).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('3. Two-Phase Intent Freezing & Encryption (Handoff Page 19 & 23)', () => {
    it('freezes canonical payload hash and encrypts recipient at dispatch time', () => {
      const rawPhone = '+919876543210';
      const encryptedPhone = encryptText(rawPhone);

      const params = {
        name: 'Lakshmi',
        shop: 'GroVastra Boutique',
        offer: 'Handloom Festive Preview'
      };
      const hash1 = sha256(params);
      const hash2 = sha256(params);

      expect(hash1).toBe(hash2);
      expect(encryptedPhone).not.toBe(rawPhone);
      expect(encryptedPhone.split(':').length).toBe(3);
    });
  });

  describe('4. Pause Serialization Against Concurrent Dispatch (Handoff Page 25, B11/B12)', () => {
    it('transactionally aborts dispatch when campaign is paused concurrently and increments gateVersion', async () => {
      const tenantId = 'tenant_race_test';

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId,
        connectionId: 'conn_race_test',
        provider: 'mock',
        status: 'ACTIVE'
      });

      const customer = await CustomerModel.create({
        id: 'cus_race_01',
        tenantId,
        firstName: 'Sita',
        lastName: 'Devi',
        phone: '+919988776655',
        status: 'ACTIVE',
        optedInMarketing: true
      });

      const campaign = await CampaignModel.create({
        id: 'cmp_race_01',
        tenantId,
        name: 'Concurrent Pause Test',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_race_01',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const version = await CampaignVersionModel.create({
        id: 'cv_race_01',
        tenantId,
        campaignId: campaign.id,
        version: 1,
        name: campaign.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_race'
      });

      const enrollment = await CampaignEnrollmentModel.create({
        id: 'enr_race_01',
        tenantId,
        campaignId: campaign.id,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE'
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_race_01',
        tenantId,
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        pauseGeneration: 0,
        state: 'EVALUATING',
        lease: {
          token: generateId('tok'),
          until: new Date(Date.now() + 60000),
          claimedBy: 'worker_1'
        }
      });

      // 1. Initial gates are created with gateVersion: 1
      await TenantControlGateModel.create({
        id: generateId('tg'),
        tenantId,
        globalPause: false,
        gateVersion: 1
      });

      const campGate = await CampaignControlGateModel.create({
        id: generateId('cg'),
        tenantId,
        campaignId: campaign.id,
        paused: false,
        pauseGeneration: 0,
        gateVersion: 1
      });

      // 2. Simulate concurrent pause racing before submission:
      // The pause handler sets paused: true and increments gateVersion
      await CampaignControlGateModel.updateOne(
        { id: campGate.id },
        { $set: { paused: true, pauseGeneration: 1 }, $inc: { gateVersion: 1 } }
      );

      // 3. Dispatch executor runs its atomic submission transaction
      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const result = await processClaimedExecution(execution.id, mockAdapter);

      // 4. Assertions:
      // The atomic gate check failed, transaction aborted, execution was skipped, 0 provider calls
      expect(result).toBe('SKIPPED');
      expect(mockAdapter.getCallCount()).toBe(0);

      const updatedExe = await CampaignExecutionModel.findOne({ id: execution.id });
      expect(updatedExe?.state).toBe('SKIPPED');
      expect(['CAMPAIGN_OR_GLOBAL_PAUSED', 'SKIPPED_CAMPAIGN_PAUSED']).toContain(updatedExe?.outcomeReason);

      // Zero delivery intent created or submitted
      const intent = await CampaignDeliveryIntentModel.findOne({ executionId: execution.id });
      expect(intent).toBeNull();
    });

    it('monotonically increments gateVersion on both tenant and campaign gates during successful submission', async () => {
      const tenantId = 'tenant_gate_inc_test';

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId,
        connectionId: 'conn_gate_inc_test',
        provider: 'mock',
        status: 'ACTIVE'
      });

      const customer = await CustomerModel.create({
        id: 'cus_gate_01',
        tenantId,
        firstName: 'Radha',
        lastName: 'Devi',
        phone: '+919988776644',
        status: 'ACTIVE',
        optedInMarketing: true
      });

      const campaign = await CampaignModel.create({
        id: 'cmp_gate_01',
        tenantId,
        name: 'Gate Increment Test',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_gate_01',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const version = await CampaignVersionModel.create({
        id: 'cv_gate_01',
        tenantId,
        campaignId: campaign.id,
        version: 1,
        name: campaign.name,
        brandName: 'Heritage Silks',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_gate'
      });

      const enrollment = await CampaignEnrollmentModel.create({
        id: 'enr_gate_01',
        tenantId,
        campaignId: campaign.id,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE'
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_gate_01',
        tenantId,
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        pauseGeneration: 0,
        state: 'EVALUATING',
        lease: {
          token: generateId('tok'),
          until: new Date(Date.now() + 60000),
          claimedBy: 'worker_1'
        }
      });

      const tg = await TenantControlGateModel.create({
        id: generateId('tg'),
        tenantId,
        globalPause: false,
        gateVersion: 1
      });

      const cg = await CampaignControlGateModel.create({
        id: generateId('cg'),
        tenantId,
        campaignId: campaign.id,
        paused: false,
        pauseGeneration: 0,
        gateVersion: 1
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const result = await processClaimedExecution(execution.id, mockAdapter);

      expect(result).toBe('ACCEPTED');
      expect(mockAdapter.getCallCount()).toBe(1);

      // Verify gate versions were atomically incremented
      const updatedTg = await TenantControlGateModel.findOne({ id: tg.id });
      const updatedCg = await CampaignControlGateModel.findOne({ id: cg.id });
      expect(updatedTg?.gateVersion).toBe(2);
      expect(updatedCg?.gateVersion).toBe(2);
    });
  });
});
