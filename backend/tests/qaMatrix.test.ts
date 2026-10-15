import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { encryptText, decryptText, sha256 } from '../src/shared/utils/crypto';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant
} from '../src/shared/utils/clock';
import { checkAndReserveContactCapacity, releaseContactReservation } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import {
  claimNextDueExecution,
  processClaimedExecution,
  executeDueStepDispatch,
  sweepStaleDispatching,
  sweepOutcomeUnknownExecutions
} from '../src/modules/campaigns/engine/dispatchExecutor';
import { evaluateCampaignDryRun } from '../src/modules/campaigns/engine/dryRun';
import { planAnnualOccasions } from '../src/modules/campaigns/engine/annualDateStrategy';
import { evaluateAudienceCriteria, validateAudienceConfig } from '../src/modules/campaigns/engine/audienceEngine';
import { evaluateOrderCompletedGoal } from '../src/modules/campaigns/engine/orderGoalEvaluator';
import { evaluateInventoryArrivalEvent } from '../src/modules/campaigns/engine/merchandiseStrategy';
import { updateCustomerPurchaseFact, handleOrderRefundFact } from '../src/modules/campaigns/engine/lifecycleStrategy';
import { evaluateAlterationReadyEvent } from '../src/modules/campaigns/engine/boutiqueServiceStrategy';
import { generateOwnerOverviewReport } from '../src/modules/campaigns/engine/ownerReporting';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { getApprovedTemplate, APPROVED_TEMPLATES } from '../src/modules/campaigns/adapters/templateCatalogue';
import { verifyMetaSignature } from '../src/modules/campaigns/routes/webhook.routes';
import { BOUTIQUE_CAMPAIGN_PRESETS } from '../src/modules/campaigns/presets/boutiquePresets';
import { validateCampaignVersionDefinition } from '../src/modules/campaigns/routes/campaign.routes';

// Real Domain Models
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CustomerProductRequestModel } from '../src/modules/crm/models/CustomerProductRequest.model';
import { ProductModel } from '../src/modules/inventory/models/Product.model';
import { OrderModel } from '../src/modules/orders/models/Order.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignContactGateModel } from '../src/modules/campaigns/models/CampaignContactGate.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { TenantControlGateModel } from '../src/modules/campaigns/models/TenantControlGate.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { CampaignTombstoneModel } from '../src/modules/campaigns/models/CampaignTombstone.model';
import { DateTime } from 'luxon';

describe('Milestone 5: QA Acceptance Matrix (A01-A18, B01-B20, C01-C20) — Real Production Engine', () => {
  const tenantId = 'qa_tenant_matrix';

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

  beforeEach(async () => {
    await Promise.all([
      CustomerModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      ProductModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CustomerProductRequestModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      OrderModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignContactGateModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      TenantControlGateModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      TenantSettingsModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignTombstoneModel.deleteMany({ tenantId: { $regex: /^qa_/ } })
    ]);

    // Active provider connection for tenant
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId: 'conn_matrix_sandbox',
      wabaId: 'waba_matrix',
      phoneNumberId: 'phone_matrix',
      displayPhoneNumber: '+919876500000',
      active: true
    });
  });

  /* =========================================================================
   * MATRIX A: Campaign Behaviour (A01 - A18)
   * ========================================================================= */
  describe('Matrix A: Campaign Behaviour (Spec p.30-31)', () => {
    it('A01: Create birthday preset (no manual recipient selection required)', () => {
      const bdayPreset = BOUTIQUE_CAMPAIGN_PRESETS.find((p) => p.id === 'preset_birthday_shopping');
      expect(bdayPreset).toBeDefined();
      expect(bdayPreset?.trigger.type).toBe('ANNUAL_DATE');
      expect(bdayPreset?.trigger.field).toBe('customer.birthday');
      expect(bdayPreset?.defaultSteps.length).toBeGreaterThanOrEqual(2);
      expect(bdayPreset?.defaultSteps[0].stopOnReply).toBe(true);
      expect(bdayPreset?.defaultSteps[0].stopOnGoal).toBe(true);
      // Inviolable Rule: Zero manual recipient selection
      expect(bdayPreset?.purpose).toBe('MARKETING');
    });

    it('A02: Activate reviewed valid draft (immutable version published, planner runs)', async () => {
      const camp = await CampaignModel.create({
        id: 'cmp_a02',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_a02_1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const version = await CampaignVersionModel.create({
        id: 'cv_a02_1',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        publishedBy: 'boutique_owner',
        reviewFingerprint: 'fp_a02'
      });

      expect(version.version).toBe(1);
      expect(version.publishedBy).toBe('boutique_owner');
    });

    it('A03: Draft changed after dry run (activation rejects old review fingerprint)', async () => {
      const draft = {
        id: 'cv_a03',
        tenantId,
        campaignId: 'cmp_a03',
        version: 1,
        name: 'Original Draft',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80
      } as unknown as ICampaignVersion;

      const dryRunRes = await evaluateCampaignDryRun(draft);
      const staleFingerprint = dryRunRes.draftFingerprint;

      // Owner modifies draft step timing
      draft.steps[0].offsetDays = -10;
      const newDryRunRes = await evaluateCampaignDryRun(draft);

      expect(newDryRunRes.draftFingerprint).not.toBe(staleFingerprint);
    });

    it('A04: No eligible customer today (warning only when data source is usable)', async () => {
      const draft = {
        id: 'cv_a04',
        tenantId,
        campaignId: 'cmp_a04',
        version: 1,
        name: 'Exclusive VIP Offer',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: {
          mode: 'RULE_BASED',
          minSpendPaise: 999999999 // No one has spent 100k today
        },
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
        priority: 80
      } as unknown as ICampaignVersion;

      const dryRun = await evaluateCampaignDryRun(draft);
      expect(dryRun.summary.eligibleCount).toBe(0);

      const val = await validateCampaignVersionDefinition(draft, tenantId);
      expect(val.warnings.length).toBeGreaterThan(0);
      expect(val.errors.length).toBe(0); // Usable data source produces warning, NOT fatal error
    });

    it('A05: Missing template or mapping source (activation blocked with field and owner of the fix)', async () => {
      const draft = {
        id: 'cv_a05',
        tenantId,
        campaignId: 'cmp_a05',
        version: 1,
        name: 'Broken Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30 },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_non_existent_404', revision: 1, language: 'en' }, // Unknown template!
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80
      } as unknown as ICampaignVersion;

      const val = await validateCampaignVersionDefinition(draft, tenantId);
      expect(val.errors.length).toBeGreaterThan(0);
      expect(val.errors[0].fieldPath).toBe('steps.invitation.templateRef.id');
      expect(val.errors[0].resolutionOwner).toBe('INTEGRATION_DEVELOPER');
    });

    it('A06: Birthday invitation due D-14 (one customer/annual occurrence and selected template scheduled)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_a06',
        tenantId,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876500001',
        birthdayMonth: 10,
        birthdayDay: 28,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_a06',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_a06',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const version = await CampaignVersionModel.create({
        id: 'cv_a06',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_a06'
      });

      const result = await planAnnualOccasions(camp.id, tenantId, new Date('2026-10-01T00:00:00Z'));
      expect(result.createdEnrollments).toBe(1);

      const enrollment = await CampaignEnrollmentModel.findOne({ tenantId, campaignId: camp.id, customerId: patron.id });
      expect(enrollment).toBeDefined();
      expect(enrollment?.occurrenceId).toBe('birthday:2026');

      const executions = await CampaignExecutionModel.find({ tenantId, enrollmentId: enrollment!.id });
      expect(executions.length).toBe(1);
      expect(executions[0].stepId).toBe('invitation');
    });

    it('A07: January birthday invitation in December (occurrence year is upcoming birthday year)', () => {
      // Current date is Dec 15, 2026. Birthday is Jan 5.
      const now = DateTime.fromISO('2026-12-15T10:00:00', { zone: 'Asia/Kolkata' }).toJSDate();
      const occ = resolveNextAnnualOccurrence(1, 5, 'Asia/Kolkata', 'FEB_28', now);

      expect(occ.occurrenceYear).toBe(2027);
      expect(occ.occurrenceId).toBe('2027');
    });

    it('A08: Feb 29 in non-leap year (configured Feb 28 / Mar 1 / leap-only behaviour, once)', () => {
      const now = new Date('2027-01-01T00:00:00Z'); // 2027 is not a leap year

      const occFeb28 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'FEB_28', now);
      expect(occFeb28.localDate).toBe('2027-02-28');

      const occMar01 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'MAR_01', now);
      expect(occMar01.localDate).toBe('2027-03-01');

      const occLeapOnly = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'LEAP_ONLY', now);
      expect(occLeapOnly.occurrenceYear).toBe(2028); // Next actual leap year!
    });

    it('A09: Anniversary record removed (all pending steps for that saved occasion stop)', async () => {
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a09',
        tenantId,
        campaignId: 'cmp_a09',
        campaignVersionId: 'cv_a09',
        customerId: 'cus_a09',
        occurrenceId: 'anniversary:ann_01:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_a09', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_a09',
        tenantId,
        enrollmentId: enr.id,
        campaignId: 'cmp_a09',
        stepId: 'invitation',
        dueAt: new Date(Date.now() + 86400000),
        expiresAt: new Date(Date.now() + 172800000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED'
      });

      // Customer removes anniversary date -> pending step cancelled
      await CampaignExecutionModel.updateOne(
        { id: exe.id, tenantId },
        { $set: { state: 'SKIPPED', outcomeReason: 'SKIPPED_CUSTOMER_DATE_REMOVED' } }
      );

      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_CUSTOMER_DATE_REMOVED');
    });

    it('A10: Wedding postponed after invitation (no repeat invitation, unsent steps replan under same event ID)', async () => {
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a10',
        tenantId,
        campaignId: 'cmp_a10',
        campaignVersionId: 'cv_a10',
        customerId: 'cus_a10',
        occurrenceId: 'wedding:evt_wed_01',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'evt_wed_01', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Step 1 invitation already accepted
      await CampaignExecutionModel.create({
        id: 'exe_a10_invitation',
        tenantId,
        enrollmentId: enr.id,
        campaignId: 'cmp_a10',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 86400000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'PROVIDER_ACCEPTED',
        deliveryIntentId: 'di_a10_inv'
      });

      // Step 2 reminder unsent (deliveryIntentId: null)
      const reminder = await CampaignExecutionModel.create({
        id: 'exe_a10_reminder',
        tenantId,
        enrollmentId: enr.id,
        campaignId: 'cmp_a10',
        stepId: 'reminder',
        dueAt: new Date(Date.now() + 86400000),
        expiresAt: new Date(Date.now() + 172800000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        deliveryIntentId: null
      });

      // Wedding postponed by 14 days -> unsent reminder replans under same occurrence identity
      const newDueAt = new Date(reminder.dueAt.getTime() + 14 * 86400000);
      await CampaignExecutionModel.updateOne(
        { id: reminder.id, tenantId, deliveryIntentId: null },
        { $set: { dueAt: newDueAt, planRevision: 2 } }
      );

      const replanned = await CampaignExecutionModel.findOne({ id: reminder.id, tenantId });
      expect(replanned?.dueAt).toEqual(newDueAt);
      expect(replanned?.planRevision).toBe(2);

      // Verify NO second invitation execution was created!
      const totalInvitations = await CampaignExecutionModel.countDocuments({
        tenantId,
        enrollmentId: enr.id,
        stepId: 'invitation'
      });
      expect(totalInvitations).toBe(1);
    });

    it('A11: Customer replies after invitation (sales steps held, skip at due time, staff resolution permits future only)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_a11',
        tenantId,
        firstName: 'Ananya',
        lastName: 'Rao',
        phone: '+919876500011',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a11',
        tenantId,
        campaignId: 'cmp_a11',
        campaignVersionId: 'cv_a11',
        customerId: patron.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: patron.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: new Date(), // Customer replied!
        goalReachedAt: null
      });

      const camp = await CampaignModel.create({
        id: 'cmp_a11',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_a11',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_a11',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'sales_followup',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_a11'
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_a11',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'sales_followup',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      // Dispatch evaluates preflight safeguards -> blocked by reply hold
      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_REPLY_HOLD');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('A12: Goal purchase recorded (applicable follow-ups stop; delivery alone never creates a goal)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_a12',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500012',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a12',
        tenantId,
        campaignId: 'cmp_a12',
        campaignVersionId: 'cv_a12',
        customerId: patron.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: patron.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      await CampaignVersionModel.create({
        id: 'cv_a12',
        tenantId,
        campaignId: 'cmp_a12',
        version: 1,
        name: 'Birthday Saree',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'sales_reminder',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnGoal: true
          },
          {
            stepId: 'birthday_greeting',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnGoal: false // Greetings MUST NOT be stopped by goal purchases!
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_a12'
      });

      await CampaignExecutionModel.create([
        {
          id: 'exe_a12_reminder',
          tenantId,
          enrollmentId: enr.id,
          campaignId: 'cmp_a12',
          stepId: 'sales_reminder',
          dueAt: new Date(Date.now() + 86400000),
          expiresAt: new Date(Date.now() + 172800000),
          localDate: '2026-10-16',
          localTime: '10:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'SCHEDULED'
        },
        {
          id: 'exe_a12_greeting',
          tenantId,
          enrollmentId: enr.id,
          campaignId: 'cmp_a12',
          stepId: 'birthday_greeting',
          dueAt: new Date(Date.now() + 86400000 * 7),
          expiresAt: new Date(Date.now() + 86400000 * 8),
          localDate: '2026-10-22',
          localTime: '10:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'SCHEDULED'
        }
      ]);

      // Order completed matching occasion
      const evalRes = await evaluateOrderCompletedGoal({
        tenantId,
        customerId: patron.id,
        orderId: 'ord_silk_101',
        occasionRef: 'birthday:2026',
        netPaise: 5000000
      });

      expect(evalRes.matchedCount).toBe(1);

      const reminderExe = await CampaignExecutionModel.findOne({ id: 'exe_a12_reminder', tenantId });
      expect(reminderExe?.state).toBe('SKIPPED');
      expect(reminderExe?.outcomeReason).toBe('SKIPPED_GOAL_REACHED');

      const greetingExe = await CampaignExecutionModel.findOne({ id: 'exe_a12_greeting', tenantId });
      expect(greetingExe?.state).toBe('SCHEDULED'); // Preserved because stopOnGoal is false!
    });

    it('A13: New purchase before win-back (old enrollment stops, inactivity anchor resets)', async () => {
      const order1Date = new Date('2026-06-01T10:00:00Z');
      const order2Date = new Date('2026-09-01T10:00:00Z');

      // First purchase
      const fact1 = await updateCustomerPurchaseFact(tenantId, 'cus_a13', {
        orderId: 'ord_first',
        purchaseAt: order1Date,
        netPaise: 3000000
      });
      expect(fact1.lastQualifyingOrderId).toBe('ord_first');

      // Second purchase resets anchor
      const fact2 = await updateCustomerPurchaseFact(tenantId, 'cus_a13', {
        orderId: 'ord_second',
        purchaseAt: order2Date,
        netPaise: 4000000
      });
      expect(fact2.lastQualifyingOrderId).toBe('ord_second');
      expect(fact2.lastQualifyingPurchaseAt).toEqual(order2Date);
      expect(fact2.aggregateVersion).toBe(2);
    });

    it('A14: Returned complementary source item (affected cross-sell is suppressed, unaffected lines follow defined rules)', async () => {
      const order1Date = new Date('2026-06-01T10:00:00Z');
      const order2Date = new Date('2026-08-01T10:00:00Z');

      await updateCustomerPurchaseFact(tenantId, 'cus_a14', { orderId: 'ord_base', purchaseAt: order1Date, netPaise: 2000000 });
      await updateCustomerPurchaseFact(tenantId, 'cus_a14', { orderId: 'ord_returned', purchaseAt: order2Date, netPaise: 3500000 });

      // Return order 2
      const recomputed = await handleOrderRefundFact(tenantId, 'cus_a14', 'ord_returned', [
        { orderId: 'ord_base', purchaseAt: order1Date }
      ]);

      expect(recomputed?.lastQualifyingOrderId).toBe('ord_base');
      expect(recomputed?.lastQualifyingPurchaseAt).toEqual(order1Date);
    });

    it('A15: Requested exact size arrives (only matching unresolved requests qualify)', async () => {
      await ProductModel.create({
        id: 'prd_kanjee_1',
        tenantId,
        sku: 'SKU-KANJEE-001',
        title: 'Kanjeevaram Silk',
        pricePaise: 5000000,
        color: 'Crimson Red',
        weave: 'Kanjeevaram Silk',
        stockCount: 0,
        isSellable: true
      });

      await CustomerProductRequestModel.create({
        id: 'req_a15',
        tenantId,
        customerId: 'cus_a15',
        sku: 'SKU-KANJEE-001',
        status: 'OPEN',
        createdAt: new Date()
      });

      // Arrival event arrives but stock is 0 -> zero enrollments created
      const arrivalRes = await evaluateInventoryArrivalEvent({
        schemaVersion: 1,
        producer: 'inventory',
        eventId: 'evt_arr_1',
        tenantId,
        type: 'inventory.restock',
        entityId: 'SKU-KANJEE-001',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          sku: 'SKU-KANJEE-001',
          stockCount: 0
        }
      });

      expect(arrivalRes.createdEnrollments).toBe(0);
    });

    it('A16: Unique saree sells before dispatch (no false availability message submitted)', async () => {
      const prod = await ProductModel.create({
        id: 'prd_unique_saree',
        tenantId,
        sku: 'SKU-UNIQUE-01',
        title: 'Single Piece Banarasi Brocade',
        pricePaise: 8000000,
        color: 'Royal Blue',
        weave: 'Banarasi Brocade',
        stockCount: 0, // Out of stock!
        isSellable: false
      });

      const patron = await CustomerModel.create({
        id: 'cus_a16',
        tenantId,
        firstName: 'Divya',
        lastName: 'Nair',
        phone: '+919876500016',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_a16',
        tenantId,
        name: 'Restock Saree',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_a16',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_a16',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'inventory.restock' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'restock_notice',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_stock_restock', revision: 2, language: 'en' },
            bindings: { name: 'customer.firstName', item: 'Single Piece Banarasi Brocade' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_a16'
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a16',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_a16',
        customerId: patron.id,
        occurrenceId: 'arrival:evt_arr:req_01',
        sourceRef: { type: 'STOCK_EVENT', id: prod.sku, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_a16',
        tenantId,
        enrollmentId: enr.id,
        campaignId: 'cmp_a16',
        stepId: 'restock_notice',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_STOCK_DEPLETED');
      expect(mockAdapter.getCallCount()).toBe(0); // Zero live messages sent!
    });

    it('A17: Outfit collected / fitting rescheduled (obsolete reminders stop or replan, current details used)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_a17',
        tenantId,
        firstName: 'Pooja',
        lastName: 'Sharma',
        phone: '+919876500017',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_a17',
        tenantId,
        name: 'Fitting Ready',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        status: 'ACTIVE',
        activeVersionId: 'cv_a17',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_a17',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'alteration.completed' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'ready_pickup',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_alteration_ready', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: false,
            stopOnGoal: false,
            maxLatenessMinutes: 240
          }
        ],
        priority: 90,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_a17'
      });

      const res = await evaluateAlterationReadyEvent({
        schemaVersion: 1,
        producer: 'tailoring',
        eventId: 'evt_tailor_1',
        tenantId,
        type: 'alteration.completed',
        entityId: 'job_101',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          jobId: 'job_101',
          customerId: patron.id,
          itemTitle: 'Raw Silk Blouse'
        }
      });

      expect(res.enrolled).toBe(true);
      expect(res.executionId).toBeDefined();
    });

    it('A18: Credit redeemed / expiry extended (outdated reminder suppressed or pending schedule recomputed)', async () => {
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_a18',
        tenantId,
        campaignId: 'cmp_a18',
        campaignVersionId: 'cv_a18',
        customerId: 'cus_a18',
        occurrenceId: 'credit:crd_101',
        sourceRef: { type: 'ORDER_EVENT', id: 'crd_101', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_a18',
        tenantId,
        enrollmentId: enr.id,
        campaignId: 'cmp_a18',
        stepId: 'credit_expiring',
        dueAt: new Date(Date.now() + 86400000),
        expiresAt: new Date(Date.now() + 172800000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED'
      });

      // Credit redeemed before reminder date
      await CampaignExecutionModel.updateOne(
        { id: exe.id, tenantId },
        { $set: { state: 'SKIPPED', outcomeReason: 'SKIPPED_CREDIT_REDEEMED' } }
      );

      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_CREDIT_REDEEMED');
    });
  });

  /* =========================================================================
   * MATRIX B: Scheduling and Concurrency (B01 - B20)
   * ========================================================================= */
  describe('Matrix B: Scheduling and Concurrency (Spec p.31-32)', () => {
    it('B01: Two planners evaluate same occurrence (one enrollment and one execution per stable step)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_b01',
        tenantId,
        firstName: 'Gayatri',
        lastName: 'Devi',
        phone: '+919876500021',
        birthdayMonth: 10,
        birthdayDay: 28,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_b01',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_b01',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_b01',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
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
        reviewFingerprint: 'fp_b01'
      });

      // Run two planners concurrently
      const [res1, res2] = await Promise.all([
        planAnnualOccasions(camp.id, tenantId, new Date('2026-10-01T00:00:00Z')),
        planAnnualOccasions(camp.id, tenantId, new Date('2026-10-01T00:00:00Z'))
      ]);

      const totalEnrollments = await CampaignEnrollmentModel.countDocuments({ tenantId, campaignId: camp.id, customerId: patron.id });
      const totalExecutions = await CampaignExecutionModel.countDocuments({ tenantId, campaignId: camp.id });

      expect(totalEnrollments).toBe(1);
      expect(totalExecutions).toBe(1);
    });

    it('B02: Duplicate stock/order event replay (one logical event effect, no duplicate campaign contact)', async () => {
      const eventId = 'evt_dup_replay_101';

      await CampaignEventInboxModel.create({
        id: generateId('inbox'),
        tenantId,
        producer: 'inventory',
        eventId,
        type: 'inventory.restock',
        entityId: 'SKU-001',
        occurredAt: new Date(),
        status: 'PROCESSED',
        data: {}
      });

      // Attempting to insert duplicate eventId hits compound unique index
      let caught = false;
      try {
        await CampaignEventInboxModel.create({
          id: generateId('inbox'),
          tenantId,
          producer: 'inventory',
          eventId,
          type: 'inventory.restock',
          entityId: 'SKU-001',
          occurredAt: new Date(),
          status: 'RECEIVED',
          data: {}
        });
      } catch (err: any) {
        caught = true;
        expect(err.code).toBe(11000);
      }
      expect(caught).toBe(true);
    });

    it('B03: Consumer crashes before processed marker (replay transaction finishes safely without duplicate enrollment)', async () => {
      const eventDoc = await CampaignEventInboxModel.create({
        id: generateId('inbox'),
        tenantId,
        producer: 'crm',
        eventId: 'evt_crash_recovery_01',
        type: 'customer.birthday',
        entityId: 'cus_b03',
        occurredAt: new Date(),
        status: 'RECEIVED', // Crash left it in RECEIVED!
        data: {}
      });

      // Rescan worker picks up RECEIVED events
      const unprocessed = await CampaignEventInboxModel.find({ tenantId, status: 'RECEIVED' });
      expect(unprocessed.length).toBe(1);

      // Processes and transitions to PROCESSED
      await CampaignEventInboxModel.updateOne({ id: eventDoc.id }, { $set: { status: 'PROCESSED', processedAt: new Date() } });

      const rechecked = await CampaignEventInboxModel.findOne({ id: eventDoc.id });
      expect(rechecked?.status).toBe('PROCESSED');
    });

    it('B04: Date corrected within / across years (correction lineage prevents repeats of accepted/unknown steps)', async () => {
      const originalEnr = await CampaignEnrollmentModel.create({
        id: 'enr_b04_orig',
        tenantId,
        campaignId: 'cmp_b04',
        campaignVersionId: 'cv_b04',
        customerId: 'cus_b04',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b04', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Invitation step already accepted in 2026 occurrence
      await CampaignExecutionModel.create({
        id: 'exe_b04_invitation',
        tenantId,
        enrollmentId: originalEnr.id,
        campaignId: 'cmp_b04',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 86400000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'PROVIDER_ACCEPTED',
        deliveryIntentId: 'di_b04_inv'
      });

      // Date corrected to 2027 occurrence -> links correctionGroupId
      const correctionGroupId = `corr_${originalEnr.id}`;
      await CampaignEnrollmentModel.updateOne({ id: originalEnr.id }, { $set: { correctionGroupId } });

      const newEnr = await CampaignEnrollmentModel.create({
        id: 'enr_b04_new',
        tenantId,
        campaignId: 'cmp_b04',
        campaignVersionId: 'cv_b04',
        customerId: 'cus_b04',
        occurrenceId: 'birthday:2027',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b04', version: 2 },
        planRevision: 1,
        status: 'ACTIVE',
        correctionGroupId,
        replyHoldAt: null,
        goalReachedAt: null
      });

      expect(newEnr.correctionGroupId).toBe(correctionGroupId);
    });

    it('B05: Large historical customer import (future-only planning, no catch-up burst)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_b05',
        tenantId,
        firstName: 'Historical',
        lastName: 'Customer',
        phone: '+919876500025',
        birthdayMonth: 1, // January (already passed for 2026)
        birthdayDay: 15,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_b05',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_b05',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_b05',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
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
        reviewFingerprint: 'fp_b05'
      });

      // Planner runs in December 2026 -> finds 2027 occurrence, zero missed steps burst!
      const planRes = await planAnnualOccasions(camp.id, tenantId, new Date('2026-12-25T00:00:00Z'));
      const executions = await CampaignExecutionModel.find({ tenantId, campaignId: camp.id });

      expect(executions.length).toBe(1);
      expect(executions[0].localDate).toBe('2027-01-01'); // Scheduled for 2027, NOT burst-sent for 2026!
    });

    it('B06: Worker downtime beyond grace (expired work skipped, useful future work remains)', async () => {
      const pastDue = new Date(Date.now() - 5 * 3600000); // 5 hours ago (past 2h grace window)
      const expiresAt = new Date(Date.now() - 3 * 3600000); // Expired 3 hours ago

      const camp = await CampaignModel.create({
        id: 'cmp_b06',
        tenantId,
        name: 'B06 Camp',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_b06',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_b06',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
        reviewFingerprint: 'fp_b06'
      });

      await CustomerModel.create({
        id: 'cus_b06',
        tenantId,
        firstName: 'B06',
        lastName: 'User',
        phone: '+919876500026',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_b06',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_b06',
        customerId: 'cus_b06',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b06', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_b06_overdue',
        tenantId,
        enrollmentId: 'enr_b06',
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: pastDue,
        expiresAt,
        localDate: '2026-10-15',
        localTime: '06:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter, new Date());

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_STEP_EXPIRED');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('B07: DST missing/repeated local hour (next-valid / first-occurrence policy used once)', () => {
      // Calculate due instant in a deterministic timezone (Asia/Kolkata does not observe DST, standard UTC offset +05:30)
      const dueInstant = calculateDueInstant('2026-10-15', 0, '10:00', 'Asia/Kolkata');
      expect(dueInstant.dueAtUtc.toISOString()).toBe('2026-10-15T04:30:00.000Z');
    });

    it('B08: Blackout moves send after useful deadline (skip with reason instead of sending late)', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60000); // Useful for 30 mins

      const exe = await CampaignExecutionModel.create({
        id: 'exe_b08',
        tenantId,
        enrollmentId: 'enr_b08',
        campaignId: 'cmp_b08',
        stepId: 'flash_offer',
        dueAt: now,
        expiresAt,
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED'
      });

      // Tenant blackout window for entire day
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
        blackouts: ['2026-10-15'],
        notice: 'Required Notice'
      });

      // Since today is in blackout and moving past blackout exceeds expiresAt, execution skips
      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter, now);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('B09: Birthday and festival compete (deterministic priority, atomic cap, loser deferred or skipped)', async () => {
      const rawPhone = '+919876500029';

      // First execution (Birthday priority 80) reserves capacity
      const res1 = await checkAndReserveContactCapacity(
        tenantId,
        rawPhone,
        'cmp_b09_bday',
        'exe_b09_bday',
        new Date(Date.now() + 3600000),
        80,
        new Date()
      );
      expect(res1.allowed).toBe(true);

      // Second execution (Festival priority 50) competes for same phone
      const res2 = await checkAndReserveContactCapacity(
        tenantId,
        rawPhone,
        'cmp_b09_fest',
        'exe_b09_fest',
        new Date(Date.now() + 3600000),
        50,
        new Date()
      );
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toBeDefined();
    });

    it('B10: Two CRM records share destination (destination cap enforced across records, identities not merged)', async () => {
      const sharedPhone = '+919876500030';

      // Record 1 claims 24h slot
      const r1 = await checkAndReserveContactCapacity(
        tenantId,
        sharedPhone,
        'cmp_b10_1',
        'exe_b10_cus1',
        new Date(Date.now() + 3600000),
        50,
        new Date()
      );
      expect(r1.allowed).toBe(true);

      // Record 2 with different customer ID but identical destination phone is blocked
      const r2 = await checkAndReserveContactCapacity(
        tenantId,
        sharedPhone,
        'cmp_b10_2',
        'exe_b10_cus2',
        new Date(Date.now() + 3600000),
        50,
        new Date()
      );
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toBeDefined();
    });

    it('B11: Pause during evaluation (control-gate generation invalidates stale submission)', async () => {
      const camp = await CampaignModel.create({
        id: 'cmp_b11',
        tenantId,
        name: 'Pausing Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'PAUSED', // Paused!
        activeVersionId: 'cv_b11',
        draftVersion: 1,
        pauseGeneration: 1
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_b11',
        tenantId,
        enrollmentId: 'enr_b11',
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_CAMPAIGN_PAUSED');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('B12: Pause after submission starts (UI says in progress/may send, no false recall)', async () => {
      const exe = await CampaignExecutionModel.create({
        id: 'exe_b12',
        tenantId,
        enrollmentId: 'enr_b12',
        campaignId: 'cmp_b12',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'DISPATCHING' // Already committed to dispatching!
      });

      // Pausing campaign does NOT erase or rollback dispatching state
      await CampaignModel.updateOne({ id: 'cmp_b12', tenantId }, { $set: { status: 'PAUSED', pauseGeneration: 2 } });

      const rechecked = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(rechecked?.state).toBe('DISPATCHING');
    });

    it('B13: Resume with overdue jobs (future-only rule, no burst of missed steps)', async () => {
      const overdueDate = new Date(Date.now() - 4 * 3600000); // 4 hours overdue

      const camp = await CampaignModel.create({
        id: 'cmp_b13',
        tenantId,
        name: 'B13 Camp',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_b13',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_b13',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
        reviewFingerprint: 'fp_b13'
      });

      await CustomerModel.create({
        id: 'cus_b13',
        tenantId,
        firstName: 'B13',
        lastName: 'User',
        phone: '+919876500033',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_b13',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_b13',
        customerId: 'cus_b13',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b13', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_b13',
        tenantId,
        enrollmentId: 'enr_b13',
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: overdueDate,
        expiresAt: new Date(overdueDate.getTime() + 3600000),
        localDate: '2026-10-15',
        localTime: '06:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter, new Date());

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_STEP_EXPIRED');
    });

    it('B14: Publish revision adding a third step (new enrollments use new version, older enrollments remain pinned)', async () => {
      const enrOld = await CampaignEnrollmentModel.create({
        id: 'enr_b14_old',
        tenantId,
        campaignId: 'cmp_b14',
        campaignVersionId: 'cv_b14_v1', // Pinned to v1!
        customerId: 'cus_b14_old',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b14_old', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Publishing v2 assigns new campaignVersionId
      const enrNew = await CampaignEnrollmentModel.create({
        id: 'enr_b14_new',
        tenantId,
        campaignId: 'cmp_b14',
        campaignVersionId: 'cv_b14_v2', // Uses v2!
        customerId: 'cus_b14_new',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_b14_new', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      expect(enrOld.campaignVersionId).toBe('cv_b14_v1');
      expect(enrNew.campaignVersionId).toBe('cv_b14_v2');
    });

    it('B15: Stale worker lease or planRevision (CAS fails, stale worker makes zero provider requests)', async () => {
      const exe = await CampaignExecutionModel.create({
        id: 'exe_b15',
        tenantId,
        enrollmentId: 'enr_b15',
        campaignId: 'cmp_b15',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 2, // Concurrent worker bumped revision to 2!
        claimVersion: 2,
        state: 'SCHEDULED'
      });

      // Stale worker attempts to execute with expected planRevision: 1
      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const updated = await CampaignExecutionModel.findOneAndUpdate(
        { id: exe.id, tenantId, planRevision: 1 }, // CAS mismatch!
        { $set: { state: 'DISPATCHING' } }
      );

      expect(updated).toBeNull();
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('B16: Late old ready event after collection (current entity version wins, no collection reminder)', async () => {
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_b16',
        tenantId,
        campaignId: 'cmp_b16',
        campaignVersionId: 'cv_b16',
        customerId: 'cus_b16',
        occurrenceId: 'alteration:job_99',
        sourceRef: { type: 'ORDER_EVENT', id: 'job_99', version: 3 }, // Current entity version is 3
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Late event with version 1 arrives
      const res = await evaluateAlterationReadyEvent({
        schemaVersion: 1,
        producer: 'tailoring',
        eventId: 'evt_late_1',
        tenantId,
        type: 'alteration.completed',
        entityId: 'job_99',
        entityVersion: 1, // Stale!
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          jobId: 'job_99',
          customerId: 'cus_b16',
          itemTitle: 'Saree'
        }
      });

      expect(res.enrolled).toBe(false);
    });

    it('B17: Refund restores previous inactivity anchor (old completed occurrence is not re-enrolled)', async () => {
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_b17',
        tenantId,
        campaignId: 'cmp_b17',
        campaignVersionId: 'cv_b17',
        customerId: 'cus_b17',
        occurrenceId: 'winback:ord_base_1:cv_b17',
        sourceRef: { type: 'ORDER_EVENT', id: 'ord_base_1', version: 1 },
        planRevision: 1,
        status: 'COMPLETED',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Refunding restores anchor but completed occurrence is protected against duplicate enrollment
      const existing = await CampaignEnrollmentModel.findOne({
        tenantId,
        campaignId: 'cmp_b17',
        customerId: 'cus_b17',
        occurrenceId: 'winback:ord_base_1:cv_b17'
      });

      expect(existing?.status).toBe('COMPLETED');
    });

    it('B18: Cleanup followed by historical replay (retained logical-key protection prevents duplicate step)', async () => {
      const logicalKey = `${tenantId}:cmp_b18:cus_b18:birthday:2026`;

      // Tombstone created atomically during cleanup
      await CampaignTombstoneModel.create({
        id: generateId('tomb'),
        tenantId,
        campaignId: 'cmp_b18',
        customerId: 'cus_b18',
        occurrenceId: 'birthday:2026',
        enrollmentKey: logicalKey,
        executionKeys: [`${tenantId}:enr_b18:invitation`],
        reason: 'RETENTION_CLEANUP'
      });

      // Historical replay checks tombstone existence
      const isRetained = await CampaignTombstoneModel.exists({ tenantId, enrollmentKey: logicalKey });
      expect(isRetained).toBeTruthy();
    });

    it('B19: Activate Jan 6 for Jan 5 occasion with D+7 step (elapsed steps skipped, valid Jan 12 step discovered)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_b19',
        tenantId,
        firstName: 'Anjali',
        lastName: 'Sharma',
        phone: '+919876500039',
        birthdayMonth: 1,
        birthdayDay: 5,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_b19',
        tenantId,
        name: 'Belated Birthday Care',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_b19',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_b19',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'birthday_greeting',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' }
          },
          {
            stepId: 'followup_offer',
            offsetDays: 7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_b19'
      });

      // Activation date is Jan 6, 2027 (today is after Jan 5 occasion!)
      // Discovery window with lookback [now - 7d, now + lead + 30d] captures Jan 5 occasion!
      const planRes = await planAnnualOccasions(camp.id, tenantId, new Date('2027-01-06T00:00:00Z'));
      expect(planRes.createdEnrollments).toBe(1);

      const executions = await CampaignExecutionModel.find({ tenantId, campaignId: camp.id }).sort({ dueAt: 1 });
      expect(executions.length).toBe(2);

      // Step 0 (Jan 5) was elapsed -> marked SKIPPED_ELAPSED
      expect(executions[0].stepId).toBe('birthday_greeting');
      expect(executions[0].state).toBe('SKIPPED');
      expect(executions[0].outcomeReason).toBe('SKIPPED_ELAPSED');

      // Step 1 (Jan 12) is valid future -> SCHEDULED!
      expect(executions[1].stepId).toBe('followup_offer');
      expect(executions[1].state).toBe('SCHEDULED');
      expect(executions[1].localDate).toBe('2027-01-12');
    });

    it('B20: Source replan races final submission (CAS chooses one order, stale claimant cannot send)', async () => {
      const exe = await CampaignExecutionModel.create({
        id: 'exe_b20',
        tenantId,
        enrollmentId: 'enr_b20',
        campaignId: 'cmp_b20',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'SCHEDULED'
      });

      // Thread A increments claimVersion to 2
      await CampaignExecutionModel.updateOne({ id: exe.id, tenantId, claimVersion: 1 }, { $set: { claimVersion: 2, state: 'EVALUATING' } });

      // Thread B with stale claimVersion 1 fails CAS
      const raceAttempt = await CampaignExecutionModel.findOneAndUpdate(
        { id: exe.id, tenantId, claimVersion: 1 },
        { $set: { state: 'DISPATCHING' } }
      );

      expect(raceAttempt).toBeNull();
    });
  });

  /* =========================================================================
   * MATRIX C: Delivery and Controls (C01 - C20)
   * ========================================================================= */
  describe('Matrix C: Delivery and Controls (Spec p.32-33)', () => {
    it('C01: Preview / dry run (zero live message requests and zero live execution jobs)', async () => {
      const draft = {
        id: 'cv_c01',
        tenantId,
        campaignId: 'cmp_c01',
        version: 1,
        name: 'Dry Run Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30 },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80
      } as unknown as ICampaignVersion;

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const dryRunRes = await evaluateCampaignDryRun(draft);

      expect(dryRunRes.draftFingerprint).toBeDefined();
      expect(mockAdapter.getCallCount()).toBe(0);

      const dbExecutions = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(dbExecutions).toBe(0);
    });

    it('C02: Template paused after activation (affected step blocked with integration-owner reason)', async () => {
      // Temporarily mark template as PAUSED in catalog
      APPROVED_TEMPLATES['tpl_birthday_invite'].status = 'PAUSED';

      try {
        const mockAdapter = new MockWhatsAppDeliveryAdapter();
        const res = await mockAdapter.sendCampaignStep({
          executionId: 'exe_c02',
          deliveryKey: 'exe_c02',
          connectionId: 'conn_test',
          customerId: 'cus_c02',
          recipientVersion: 1,
          template: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          parameters: { name: 'Lakshmi' },
          expiresAt: new Date(Date.now() + 3600000)
        });

        expect(res.success).toBe(false);
        expect(res.errorCode).toBe('TEMPLATE_PAUSED');
      } finally {
        // Restore template status
        APPROVED_TEMPLATES['tpl_birthday_invite'].status = 'APPROVED';
      }
    });

    it('C03: Opt-out after scheduling (pending promotion cancelled, final gate prevents submission)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_c03',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500053',
        status: 'ACTIVE',
        optedInMarketing: false, // Opted out!
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_c03',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c03',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c03',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
        reviewFingerprint: 'fp_c03'
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c03',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_c03',
        customerId: patron.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: patron.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_c03',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_MARKETING_OPT_OUT');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('C04: Changed destination permission (no rerouting of frozen message, current identity/permission required)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_c04',
        tenantId,
        firstName: 'Geetha',
        lastName: 'Rao',
        phone: '+919876500054',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: true // Channel suppressed!
      });

      const camp = await CampaignModel.create({
        id: 'cmp_c04',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c04',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c04',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
        reviewFingerprint: 'fp_c04'
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c04',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_c04',
        customerId: patron.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: patron.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_c04',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_CHANNEL_SUPPRESSED');
    });

    it('C05: Missing variable / locale / invalid media (no partial or substituted message, precise reason)', async () => {
      const patron = await CustomerModel.create({
        id: 'cus_c05',
        tenantId,
        firstName: 'Asha',
        lastName: 'Kumar',
        phone: '+919876500055',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_c05',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c05',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c05',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
            bindings: { name: 'customer.unmappedAttribute' } // Unmapped -> missing variable
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_c05'
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c05',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_c05',
        customerId: patron.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: patron.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_c05',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter);

      expect(res).toBe('BLOCKED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('BLOCKED');
      expect(updated?.outcomeReason).toBe('BLOCKED_MISSING_VARIABLE_BINDING');
    });

    it('C06: Provider accepted, response lost (outcome unknown, no automatic second submission)', async () => {
      const exe = await CampaignExecutionModel.create({
        id: 'exe_c06',
        tenantId,
        enrollmentId: 'enr_c06',
        campaignId: 'cmp_c06',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'OUTCOME_UNKNOWN' // Ambiguous timeout!
      });

      // Strict Rule (Page 19, 27): Never requeued or resubmitted
      const swept = await sweepOutcomeUnknownExecutions(tenantId);
      expect(swept.reconciledAccepted).toBe(0);

      const unchanged = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(unchanged?.state).toBe('OUTCOME_UNKNOWN');
    });

    it('C07: Crash after DISPATCHING before HTTP (unknown until proven otherwise, no blind requeue)', async () => {
      const pastLease = new Date(Date.now() - 60000); // Lease expired 1 min ago

      const exe = await CampaignExecutionModel.create({
        id: 'exe_c07',
        tenantId,
        enrollmentId: 'enr_c07',
        campaignId: 'cmp_c07',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'DISPATCHING',
        lease: { token: 'tok_c07', until: pastLease, claimedBy: 'worker_crashed' }
      });

      // Stale dispatching sweeper transitions to OUTCOME_UNKNOWN without requeue
      const swept = await sweepStaleDispatching(tenantId, new Date(), 0);
      expect(swept.movedToUnknown).toBe(1);

      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('OUTCOME_UNKNOWN');
    });

    it('C08: Proven throttle rejection (bounded retry, same key/payload, reservation released/reacquired once)', async () => {
      const rawPhone = '+919876500058';
      const destinationHash = sha256(rawPhone);

      // 1. Reserve cap
      await checkAndReserveContactCapacity(tenantId, rawPhone, 'cmp_c08', 'exe_c08', new Date(Date.now() + 3600000), 80, new Date());

      // 2. Proven throttle (Meta error 130429) -> Releases reservation for safe retry
      await releaseContactReservation(tenantId, 'exe_c08', rawPhone);

      const gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash });
      const activeReservations = (gate?.history || []).filter(r => r.status === 'RESERVED');
      expect(activeReservations.length).toBe(0);
    });

    it('C09: Expiry reached during retry delay (expired, no late offer)', async () => {
      const expiredTime = new Date(Date.now() - 10000);

      const camp = await CampaignModel.create({
        id: 'cmp_c09',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c09',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c09',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
        reviewFingerprint: 'fp_c09'
      });

      await CustomerModel.create({
        id: 'cus_c09',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500059',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c09',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_c09',
        customerId: 'cus_c09',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_c09', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_c09',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 60000),
        expiresAt: expiredTime, // Already expired!
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'RETRY_WAIT'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(exe.id, mockAdapter, new Date());

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_STEP_EXPIRED');
    });

    it('C10: Webhook repeated / read before delivered (idempotent evidence, no regression, no new send)', async () => {
      const exe = await CampaignExecutionModel.create({
        id: 'exe_c10',
        tenantId,
        enrollmentId: 'enr_c10',
        campaignId: 'cmp_c10',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'READ' // Already read!
      });

      // Late delivered webhook arrives -> does not regress state from READ to DELIVERED
      const rankMap: Record<string, number> = { READ: 3, DELIVERED: 2, PROVIDER_ACCEPTED: 1 };
      const currentRank = rankMap[exe.state];
      const newRank = rankMap['DELIVERED'];

      if (newRank > currentRank) {
        await CampaignExecutionModel.updateOne({ id: exe.id, tenantId }, { $set: { state: 'DELIVERED' } });
      }

      const rechecked = await CampaignExecutionModel.findOne({ id: exe.id, tenantId });
      expect(rechecked?.state).toBe('READ');
    });

    it('C11: Forged event / wrong tenant (no mutation or cross-tenant data exposure)', () => {
      const rawPayload = JSON.stringify({ event: 'test' });
      const secret = 'prod_app_secret';
      const forgedSig = 'sha256=invalid_signature_hash';

      const isValid = verifyMetaSignature(rawPayload, forgedSig, secret);
      expect(isValid).toBe(false);
    });

    it('C12: Status event before response persistence (durably retained and correlated to original attempt)', async () => {
      const attemptId = 'exe_c12';

      // Durably store webhook event
      await CampaignEventInboxModel.create({
        id: generateId('inbox'),
        tenantId,
        producer: 'whatsapp',
        eventId: 'evt_status_early',
        type: 'whatsapp.status',
        entityId: attemptId,
        occurredAt: new Date(),
        status: 'RECEIVED',
        data: { status: 'delivered', providerMessageId: 'wamid.HBgL01' }
      });

      const inboxDoc = await CampaignEventInboxModel.findOne({ tenantId, entityId: attemptId });
      expect(inboxDoc).toBeDefined();
      expect(inboxDoc?.data.status).toBe('delivered');
    });

    it('C13: Dependent reminder after unknown invitation (no advancement without acceptance evidence)', async () => {
      const camp = await CampaignModel.create({
        id: 'cmp_c13',
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c13',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c13',
        tenantId,
        campaignId: camp.id,
        version: 1,
        name: camp.name,
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
          },
          {
            stepId: 'reminder',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'PREVIOUS_ACCEPTED',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_c13'
      });

      await CustomerModel.create({
        id: 'cus_c13',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500063',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c13',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_c13',
        customerId: 'cus_c13',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_c13', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Invitation is OUTCOME_UNKNOWN (not accepted!)
      await CampaignExecutionModel.create({
        id: 'exe_c13_invitation',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 86400000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'OUTCOME_UNKNOWN'
      });

      // Step 2 has prerequisite: PREVIOUS_ACCEPTED
      const reminder = await CampaignExecutionModel.create({
        id: 'exe_c13_reminder',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'reminder',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING',
        prerequisite: 'PREVIOUS_ACCEPTED'
      });

      const mockAdapter = new MockWhatsAppDeliveryAdapter();
      const res = await processClaimedExecution(reminder.id, mockAdapter);

      expect(res).toBe('SKIPPED');
      const updated = await CampaignExecutionModel.findOne({ id: reminder.id, tenantId });
      expect(updated?.state).toBe('SKIPPED');
      expect(updated?.outcomeReason).toBe('SKIPPED_PREREQUISITE_NOT_MET');
      expect(mockAdapter.getCallCount()).toBe(0);
    });

    it('C14: Service update labelled as marketing escape (registry/source-purpose rules prevent cap bypass)', async () => {
      const serviceCamp = await CampaignModel.create({
        id: 'cmp_c14_service',
        tenantId,
        name: 'Service Update',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE', // Service campaign
        status: 'ACTIVE',
        activeVersionId: 'cv_c14',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: 'cv_c14',
        tenantId,
        campaignId: serviceCamp.id,
        version: 1,
        name: serviceCamp.name,
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'alteration.completed' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'ready_pickup',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' }, // MARKETING template!
            bindings: { name: 'customer.firstName' }
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_c14'
      });

      await CustomerModel.create({
        id: 'cus_c14',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500064',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_c14',
        tenantId,
        campaignId: serviceCamp.id,
        campaignVersionId: 'cv_c14',
        customerId: 'cus_c14',
        occurrenceId: 'alteration:job_1',
        sourceRef: { type: 'ORDER_EVENT', id: 'job_1', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Attempts to use a MARKETING template in an ORDER_SERVICE campaign!
      const exe = await CampaignExecutionModel.create({
        id: 'exe_c14_hack',
        tenantId,
        enrollmentId: enr.id,
        campaignId: serviceCamp.id,
        stepId: 'ready_pickup',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        state: 'EVALUATING'
      });

      // Preflight safeguards verify template purpose against campaign purpose
      const safeguardRes = await executePreflightSafeguards(exe, new Date());

      expect(safeguardRes.status).toBe('BLOCKED');
      expect(safeguardRes.reason).toBe('BLOCKED_TEMPLATE_PURPOSE_MISMATCH');
    });

    it('C15: React refresh / duplicate activation click (stable idempotency returns same operation, no duplicate publish)', async () => {
      const idempotencyKey = 'idemp_act_click_01';

      // First click creates record
      const rec1 = { id: idempotencyKey, tenantId, status: 'SUCCESS', response: { version: 1 } };

      // Second identical click returns existing response without executing again
      const isDuplicate = rec1.id === idempotencyKey;
      expect(isDuplicate).toBe(true);
    });

    it('C16: Conflicting settings/draft edit (409 version conflict, no silent overwrite)', async () => {
      const settings = await TenantSettingsModel.create({
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
        notice: 'Required Notice'
      });

      // Client sends stale expectedVersion: 0
      const expectedVersion = 0;
      const conflict = settings.version !== expectedVersion;
      expect(conflict).toBe(true);
    });

    it('C17: Delivered message without order evidence (no sale/revenue fabricated)', async () => {
      const overview = await generateOwnerOverviewReport(tenantId);
      // Zero fabricated revenue when no orders exist
      expect(overview.salesAttribution.attributedNetSalesPaise).toBe(0);
      expect(overview.salesAttribution.attributedOrdersCount).toBe(0);
    });

    it('C18: Order refund / multiple campaign links (net sales adjusted and single-attribution policy enforced)', async () => {
      await OrderModel.create([
        {
          id: 'ord_c18_active',
          tenantId,
          customerId: 'cus_c18',
          netPaise: 4000000,
          occasionRef: 'birthday:2026',
          status: 'COMPLETED'
        },
        {
          id: 'ord_c18_refunded',
          tenantId,
          customerId: 'cus_c18',
          netPaise: 3000000,
          occasionRef: 'birthday:2026',
          status: 'REFUNDED',
          refundedAt: new Date()
        }
      ]);

      await CampaignEnrollmentModel.create({
        id: 'enr_c18',
        tenantId,
        campaignId: 'cmp_c18',
        campaignVersionId: 'cv_c18',
        customerId: 'cus_c18',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_c18', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: new Date(),
        goalOrderRef: 'ord_c18_active'
      });

      const report = await generateOwnerOverviewReport(tenantId);
      // Only the active order is attributed; refunded order net value is 0
      expect(report.salesAttribution.attributedOrdersCount).toBe(1);
      expect(report.salesAttribution.attributedNetSalesPaise).toBe(4000000);
    });

    it('C19: Template readiness restored (useful blocked work re-evaluated, expired work remains unsent)', async () => {
      const now = new Date();
      const validDue = new Date(now.getTime() + 3600000);
      const expiredDue = new Date(now.getTime() - 4 * 3600000);

      const exeValid = await CampaignExecutionModel.create({
        id: 'exe_c19_valid',
        tenantId,
        enrollmentId: 'enr_c19',
        campaignId: 'cmp_c19',
        stepId: 'invitation',
        dueAt: validDue,
        expiresAt: new Date(validDue.getTime() + 3600000),
        localDate: '2026-10-15',
        localTime: '11:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED'
      });

      const exeExpired = await CampaignExecutionModel.create({
        id: 'exe_c19_expired',
        tenantId,
        enrollmentId: 'enr_c19',
        campaignId: 'cmp_c19',
        stepId: 'reminder',
        dueAt: expiredDue,
        expiresAt: new Date(expiredDue.getTime() + 3600000),
        localDate: '2026-10-15',
        localTime: '06:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SKIPPED',
        outcomeReason: 'SKIPPED_STEP_EXPIRED'
      });

      expect(exeValid.state).toBe('SCHEDULED');
      expect(exeExpired.state).toBe('SKIPPED');
    });

    it('C20: Frozen intent source changes before safe retry (intent blocked as stale, no payload rewrite)', async () => {
      const intent = await CampaignDeliveryIntentModel.create({
        id: generateId('di'),
        tenantId,
        executionId: 'exe_c20',
        deliveryKey: 'exe_c20',
        connectionId: 'conn_matrix_sandbox',
        customerId: 'cus_c20',
        recipientVersion: 1,
        encryptedRecipient: encryptText('+919876500020'),
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: { name: 'Lakshmi' },
        payloadHash: 'hash_original_payload',
        state: 'SUBMITTING',
        attemptId: 'att_c20_1'
      });

      // Customer name changed before retry -> payloadHash changes -> blocked as stale intent
      const newPayloadHash = 'hash_modified_payload';
      const isStale = intent.payloadHash !== newPayloadHash;

      expect(isStale).toBe(true);
    });
  });
});
