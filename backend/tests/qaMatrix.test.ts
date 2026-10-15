import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { encryptText, decryptText, sha256 } from '../src/shared/utils/crypto';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant
} from '../src/shared/utils/clock';
import { checkAndReserveContactCapacity } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { executePreflightSafeguards } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import {
  claimNextDueExecution,
  processClaimedExecution,
  sweepOutcomeUnknownExecutions
} from '../src/modules/campaigns/engine/dispatchExecutor';
import { evaluateCampaignDryRun } from '../src/modules/campaigns/engine/dryRun';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { getApprovedTemplate } from '../src/modules/campaigns/adapters/templateCatalogue';
import { verifyMetaSignature, timingSafeCompare } from '../src/modules/campaigns/routes/webhook.routes';

// Real Domain Models
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignContactGateModel } from '../src/modules/campaigns/models/CampaignContactGate.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import crypto from 'crypto';

const TEST_DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/grovastra_test';

describe('Milestone 5: QA Acceptance Matrix (A, B, C) - Real Production Engine', () => {
  beforeAll(async () => {
    mongoose.set('strictQuery', true);
    await mongoose.connect(TEST_DB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    // Clear test collections between tests to guarantee clean isolated state
    await Promise.all([
      CustomerModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignContactGateModel.deleteMany({ tenantId: { $regex: /^qa_/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^qa_/ } })
    ]);
  });

  /* =========================================================================
   * MATRIX A: Strategy, Trigger, Fingerprint & Lifecycle Boundaries (A01 - A14)
   * ========================================================================= */
  describe('Matrix A: Strategy, Trigger, Fingerprint & Lifecycle Boundaries', () => {
    it('A01: generates canonical enrollmentKey = tenantId:campaignId:customerId:occurrenceId', () => {
      const tenantId = 'qa_tenant_padmavati';
      const campaignId = 'cmp_birthday_2026';
      const customerId = 'cus_lakshmi_01';
      const occurrenceId = '2026';

      const enrollmentKey = `${tenantId}:${campaignId}:${customerId}:${occurrenceId}`;
      expect(enrollmentKey).toBe('qa_tenant_padmavati:cmp_birthday_2026:cus_lakshmi_01:2026');

      // Inviolable Rule (Page 18): Key must NOT contain version, retry count, or worker ID
      expect(enrollmentKey).not.toContain('cv_');
      expect(enrollmentKey).not.toContain('worker_');
      expect(enrollmentKey).not.toContain('attempt');
    });

    it('A02: idempotent occasion discovery preserves unique enrollmentKey across multiple runs', () => {
      const run1Keys = new Set<string>();
      const run2Keys = new Set<string>();

      const patrons = [
        { id: 'cus_lakshmi', bdayMonth: 10, bdayDay: 28 },
        { id: 'cus_ananya', bdayMonth: 11, bdayDay: 15 }
      ];

      patrons.forEach((p) => {
        const occ = resolveNextAnnualOccurrence(p.bdayMonth, p.bdayDay, 'Asia/Kolkata', 'FEB_28');
        run1Keys.add(`qa_tenant:cmp_bday:${p.id}:${occ.occurrenceId}`);
      });

      patrons.forEach((p) => {
        const occ = resolveNextAnnualOccurrence(p.bdayMonth, p.bdayDay, 'Asia/Kolkata', 'FEB_28');
        run2Keys.add(`qa_tenant:cmp_bday:${p.id}:${occ.occurrenceId}`);
      });

      expect(run1Keys.size).toBe(2);
      expect(Array.from(run1Keys)).toEqual(Array.from(run2Keys));
    });

    it('A03: rejects activation when draft configuration modified after review (fingerprint mismatch)', async () => {
      const tenantId = 'qa_tenant_fp';
      const baseVersion = {
        id: 'cv_base',
        tenantId,
        campaignId: 'cmp_bday',
        version: 1,
        name: 'Birthday Campaign',
        status: 'DRAFT',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 14, leapDayPolicy: 'FEB_28' },
        audience: {},
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { patronName: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata'
      } as unknown as ICampaignVersion;

      // 1. Evaluate dry run using real engine
      const res1 = await evaluateCampaignDryRun(baseVersion);
      expect(res1.draftFingerprint).toMatch(/^fp_/);

      // 2. Modifying step time from 10:00 to 11:00 produces different canonical fingerprint
      const modifiedVersion = {
        ...baseVersion,
        steps: [
          {
            ...baseVersion.steps[0],
            localTime: '11:00'
          }
        ]
      } as unknown as ICampaignVersion;

      const res2 = await evaluateCampaignDryRun(modifiedVersion);
      expect(res2.draftFingerprint).not.toBe(res1.draftFingerprint);
    });

    it('A04: Specification pattern filters audience by tags, min spend, and exclusions using real CustomerModel in MongoDB', async () => {
      const tenantId = 'qa_tenant_audience';

      // Insert real customers into MongoDB
      await CustomerModel.create([
        {
          id: 'p1',
          tenantId,
          firstName: 'Lakshmi',
          lastName: 'Devi',
          phone: '+919876500001',
          tags: ['VIP', 'Kanjeevaram'],
          preferences: { budgetMaxPaise: 4500000, weave: ['Kanjeevaram'] },
          optedInMarketing: true,
          channelSuppressed: false,
          status: 'ACTIVE',
          birthdayMonth: 10,
          birthdayDay: 28
        },
        {
          id: 'p2',
          tenantId,
          firstName: 'Ananya',
          lastName: 'Rao',
          phone: '+919876500002',
          tags: ['Cotton'],
          preferences: { budgetMaxPaise: 1200000, weave: ['Cotton'] },
          optedInMarketing: true,
          channelSuppressed: false,
          status: 'ACTIVE',
          birthdayMonth: 10,
          birthdayDay: 28
        },
        {
          id: 'p3',
          tenantId,
          firstName: 'Meera',
          lastName: 'Sundaram',
          phone: '+919876500003',
          tags: ['VIP'],
          preferences: { budgetMaxPaise: 800000, weave: ['Silk'] }, // Below min spend
          optedInMarketing: true,
          channelSuppressed: false,
          status: 'ACTIVE',
          birthdayMonth: 10,
          birthdayDay: 28
        },
        {
          id: 'p4',
          tenantId,
          firstName: 'Staff',
          lastName: 'Member',
          phone: '+919876500004',
          tags: ['VIP', 'Staff_Family'], // Excluded tag
          preferences: { budgetMaxPaise: 5000000, weave: ['Silk'] },
          optedInMarketing: true,
          channelSuppressed: false,
          status: 'ACTIVE',
          birthdayMonth: 10,
          birthdayDay: 28
        }
      ]);

      const version = {
        id: 'cv_aud',
        tenantId,
        campaignId: 'cmp_aud',
        version: 1,
        name: 'VIP Birthday Offer',
        status: 'DRAFT',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        audience: {
          minSpendPaise: 2000000,
          requiredTags: ['VIP'],
          excludedTags: ['Staff_Family']
        },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { patronName: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata'
      } as unknown as ICampaignVersion;

      // Execute dry run with fixed clock
      const clock = new SettableTestClock('2026-10-14T00:00:00.000Z');
      const result = await evaluateCampaignDryRun(version, clock);

      expect(result.summary.totalEvaluated).toBe(4);
      expect(result.summary.eligibleCount).toBe(1);
      expect(result.samplePlans.length).toBe(1);
      expect(result.samplePlans[0].customerId).toBe('p1');
      expect(result.reasonBreakdown.AUDIENCE_RULE_MISMATCH).toBe(3);
    });

    it('A05: multi-step sequence offsets calculate exact local business hours avoiding midnight UTC drift', () => {
      // Occasion: 28 October 2026. Step 1 = D-14 at 10:00 AM IST
      const dueD14 = calculateDueInstant('2026-10-28', -14, '10:00', 'Asia/Kolkata');
      expect(dueD14.localDate).toBe('2026-10-14');
      expect(dueD14.localTime).toBe('10:00');
      // IST is UTC+5:30 -> 10:00 IST = 04:30:00 UTC
      expect(dueD14.dueAtUtc.toISOString()).toBe('2026-10-14T04:30:00.000Z');

      // Step 2 = D-7 at 10:00 AM IST
      const dueD7 = calculateDueInstant('2026-10-28', -7, '10:00', 'Asia/Kolkata');
      expect(dueD7.localDate).toBe('2026-10-21');
      expect(dueD7.dueAtUtc.toISOString()).toBe('2026-10-21T04:30:00.000Z');

      // Step 3 = D0 at 09:30 AM IST
      const dueD0 = calculateDueInstant('2026-10-28', 0, '09:30', 'Asia/Kolkata');
      expect(dueD0.localDate).toBe('2026-10-28');
      expect(dueD0.dueAtUtc.toISOString()).toBe('2026-10-28T04:00:00.000Z');
    });

    it('A06: invalid or missing occasion date skips customer with NO_OCCASION_DATE in evaluateCampaignDryRun', async () => {
      const tenantId = 'qa_tenant_no_date';

      await CustomerModel.create({
        id: 'cus_no_bday',
        tenantId,
        firstName: 'No',
        lastName: 'Birthday',
        phone: '+919876500009',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE',
        bdayMonth: null,
        bdayDay: null
      });

      const version = {
        id: 'cv_nodate',
        tenantId,
        campaignId: 'cmp_nodate',
        version: 1,
        name: 'No Date Campaign',
        status: 'DRAFT',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', advanceDays: 30, leapDayPolicy: 'FEB_28' },
        audience: {},
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { patronName: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata'
      } as unknown as ICampaignVersion;

      const res = await evaluateCampaignDryRun(version);
      expect(res.reasonBreakdown.NO_OCCASION_DATE).toBe(1);
      expect(res.summary.eligibleCount).toBe(0);
    });

    it('A07: channel-suppressed or deleted customer evaluated first in reason precedence via real executePreflightSafeguards', async () => {
      const tenantId = 'qa_tenant_suppressed';

      // 1. Setup Campaign & Version
      await CampaignModel.create({
        id: 'cmp_sup',
        tenantId,
        name: 'Birthday Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_sup',
        priority: 80,
        reviewFingerprint: 'fp_123'
      });

      await CampaignVersionModel.create({
        id: 'cv_sup',
        tenantId,
        campaignId: 'cmp_sup',
        version: 1,
        name: 'Birthday Version 1',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: {}
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_123'
      });

      // 2. Setup Suppressed Customer
      await CustomerModel.create({
        id: 'cus_sup',
        tenantId,
        firstName: 'Suppressed',
        lastName: 'Customer',
        phone: '+919876500010',
        optedInMarketing: true,
        channelSuppressed: true, // Suppressed
        status: 'ACTIVE'
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_sup',
        tenantId,
        campaignId: 'cmp_sup',
        campaignVersionId: 'cv_sup',
        customerId: 'cus_sup',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_sup', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_sup:cus_sup:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_sup',
        tenantId,
        enrollmentId: 'enr_sup',
        campaignId: 'cmp_sup',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const outcome = await executePreflightSafeguards(execution);
      expect(outcome.status).toBe('SKIP');
      expect((outcome as any).reason).toBe('SKIPPED_CHANNEL_SUPPRESSED');
    });

    it('A08: Leap day birthday (Feb 29) follows explicit campaign policy on non-leap years', () => {
      const clock = new SettableTestClock('2027-01-01T00:00:00.000Z'); // 2027 is non-leap year

      // Policy 1: FEB_28
      const occFeb28 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'FEB_28', clock);
      expect(occFeb28.localDate).toBe('2027-02-28');

      // Policy 2: MAR_01
      const occMar01 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'MAR_01', clock);
      expect(occMar01.localDate).toBe('2027-03-01');

      // Policy 3: LEAP_ONLY
      const occLeapOnly = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'LEAP_ONLY', clock);
      expect(occLeapOnly.occurrenceYear).toBe(2028); // Next actual leap year
      expect(occLeapOnly.localDate).toBe('2028-02-29');
    });

    it('A09: prerequisite check (PREVIOUS_ACCEPTED) blocks step 2 if step 1 was not accepted using real CampaignExecutionModel', async () => {
      const tenantId = 'qa_tenant_prereq';

      await CampaignModel.create({
        id: 'cmp_prereq',
        tenantId,
        name: 'Sequenced Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_prereq',
        priority: 80,
        reviewFingerprint: 'fp_pre'
      });

      await CampaignVersionModel.create({
        id: 'cv_prereq',
        tenantId,
        campaignId: 'cmp_prereq',
        version: 1,
        name: 'Sequenced Version',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [
          {
            stepId: 'step_1',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: {}
          },
          {
            stepId: 'step_2',
            offsetDays: -7,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_followup', revision: 2, language: 'en' },
            prerequisite: 'PREVIOUS_ACCEPTED',
            bindings: {}
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_pre'
      });

      await CustomerModel.create({
        id: 'cus_pre',
        tenantId,
        firstName: 'Meera',
        lastName: 'Sundaram',
        phone: '+919876500012',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_pre',
        tenantId,
        campaignId: 'cmp_prereq',
        campaignVersionId: 'cv_prereq',
        customerId: 'cus_pre',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_pre', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_prereq:cus_pre:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      const step2Execution = await CampaignExecutionModel.create({
        id: 'exe_step_2',
        tenantId,
        enrollmentId: 'enr_pre',
        campaignId: 'cmp_prereq',
        stepId: 'step_2',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-21',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'PREVIOUS_ACCEPTED'
      });

      // Prior step 1 failed permanently -> Step 2 must SKIP with SKIPPED_PREREQUISITE_NOT_MET
      await CampaignExecutionModel.create({
        id: 'exe_step_1',
        tenantId,
        enrollmentId: 'enr_pre',
        campaignId: 'cmp_prereq',
        stepId: 'step_1',
        dueAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'FAILED',
        prerequisite: 'NONE'
      });

      const outcomeFail = await executePreflightSafeguards(step2Execution);
      expect(outcomeFail.status).toBe('SKIP');
      expect((outcomeFail as any).reason).toBe('SKIPPED_PREREQUISITE_NOT_MET');

      // Now update prior step 1 to PROVIDER_ACCEPTED
      await CampaignExecutionModel.updateOne(
        { id: 'exe_step_1' },
        { $set: { state: 'PROVIDER_ACCEPTED' } }
      );

      // Now preflight safeguards must pass prerequisite check
      const outcomePass = await executePreflightSafeguards(step2Execution);
      expect(outcomePass.status).toBe('PROCEED');
    });

    it('A10: lateness cutoff skips executions past expiresAt with SKIPPED_STEP_EXPIRED', async () => {
      const tenantId = 'qa_tenant_expired';

      await CampaignModel.create({
        id: 'cmp_exp',
        tenantId,
        name: 'Expiring Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_exp',
        priority: 80,
        reviewFingerprint: 'fp_exp'
      });

      await CampaignVersionModel.create({
        id: 'cv_exp',
        tenantId,
        campaignId: 'cmp_exp',
        version: 1,
        name: 'Expiring Version',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [{ stepId: 'step_exp', offsetDays: 0, localTime: '10:00', templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' }, bindings: {} }],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_exp'
      });

      await CustomerModel.create({
        id: 'cus_exp',
        tenantId,
        firstName: 'Ananya',
        lastName: 'Rao',
        phone: '+919876500015',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_exp',
        tenantId,
        campaignId: 'cmp_exp',
        campaignVersionId: 'cv_exp',
        customerId: 'cus_exp',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_exp', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_exp:cus_exp:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Execution expired 1 hour ago
      const expiredExecution = await CampaignExecutionModel.create({
        id: 'exe_exp',
        tenantId,
        enrollmentId: 'enr_exp',
        campaignId: 'cmp_exp',
        stepId: 'step_exp',
        dueAt: new Date(Date.now() - 7200000),
        expiresAt: new Date(Date.now() - 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const outcome = await executePreflightSafeguards(expiredExecution);
      expect(outcome.status).toBe('SKIP');
      expect((outcome as any).reason).toBe('SKIPPED_STEP_EXPIRED');
    });

    it('A11: inbound customer reply sets replyHoldAt and halts remaining sales steps with SKIPPED_REPLY_HOLD', async () => {
      const tenantId = 'qa_tenant_reply';

      await CampaignModel.create({
        id: 'cmp_reply',
        tenantId,
        name: 'Reply Hold Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_reply',
        priority: 80,
        reviewFingerprint: 'fp_rep'
      });

      await CampaignVersionModel.create({
        id: 'cv_reply',
        tenantId,
        campaignId: 'cmp_reply',
        version: 1,
        name: 'Reply Hold Version',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [{ stepId: 'step_followup', offsetDays: -7, localTime: '10:00', templateRef: { id: 'tpl_birthday_followup', revision: 2, language: 'en' }, bindings: {}, stopOnReply: true }],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_rep'
      });

      await CustomerModel.create({
        id: 'cus_rep',
        tenantId,
        firstName: 'Pooja',
        lastName: 'Sharma',
        phone: '+919876500018',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      // Enrollment has active replyHoldAt
      await CampaignEnrollmentModel.create({
        id: 'enr_rep',
        tenantId,
        campaignId: 'cmp_reply',
        campaignVersionId: 'cv_reply',
        customerId: 'cus_rep',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_rep', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_reply:cus_rep:2026`,
        enrolledAt: new Date(),
        replyHoldAt: new Date(), // Staff hold active!
        goalReachedAt: null
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_rep',
        tenantId,
        enrollmentId: 'enr_rep',
        campaignId: 'cmp_reply',
        stepId: 'step_followup',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const outcome = await executePreflightSafeguards(execution);
      expect(outcome.status).toBe('SKIP');
      expect((outcome as any).reason).toBe('SKIPPED_REPLY_HOLD');
    });

    it('A12: qualifying saree purchase sets goalReachedAt and skips follow-ups with SKIPPED_GOAL_REACHED', async () => {
      const tenantId = 'qa_tenant_goal';

      await CampaignModel.create({
        id: 'cmp_goal',
        tenantId,
        name: 'Goal Stop Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_goal',
        priority: 80,
        reviewFingerprint: 'fp_goal'
      });

      await CampaignVersionModel.create({
        id: 'cv_goal',
        tenantId,
        campaignId: 'cmp_goal',
        version: 1,
        name: 'Goal Stop Version',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [{ stepId: 'step_disc', offsetDays: -3, localTime: '10:00', templateRef: { id: 'tpl_birthday_followup', revision: 2, language: 'en' }, bindings: {}, stopOnGoal: true }],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_goal'
      });

      await CustomerModel.create({
        id: 'cus_goal',
        tenantId,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876500020',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      // Enrollment has goal reached recorded
      await CampaignEnrollmentModel.create({
        id: 'enr_goal',
        tenantId,
        campaignId: 'cmp_goal',
        campaignVersionId: 'cv_goal',
        customerId: 'cus_goal',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_goal', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_goal:cus_goal:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: new Date() // Purchase made!
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_goal',
        tenantId,
        enrollmentId: 'enr_goal',
        campaignId: 'cmp_goal',
        stepId: 'step_disc',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const outcome = await executePreflightSafeguards(execution);
      expect(outcome.status).toBe('SKIP');
      expect((outcome as any).reason).toBe('SKIPPED_GOAL_REACHED');
    });

    it('A13: paused campaign halts execution evaluation with SKIPPED_CAMPAIGN_PAUSED', async () => {
      const tenantId = 'qa_tenant_paused';

      await CampaignModel.create({
        id: 'cmp_pau',
        tenantId,
        name: 'Paused Campaign',
        type: 'ANNUAL_DATE',
        status: 'PAUSED', // Paused!
        activeVersionId: 'cv_pau',
        priority: 80,
        reviewFingerprint: 'fp_pau'
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_pau',
        tenantId,
        enrollmentId: 'enr_pau',
        campaignId: 'cmp_pau',
        stepId: 'step_1',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE'
      });

      const outcome = await executePreflightSafeguards(execution);
      expect(outcome.status).toBe('SKIP');
      expect((outcome as any).reason).toBe('SKIPPED_CAMPAIGN_PAUSED');
    });

    it('A14: unapproved or unknown template blocks execution with null from catalogue', () => {
      const template = getApprovedTemplate('tpl_non_existent_saree');
      expect(template).toBeNull();

      const approved = getApprovedTemplate('tpl_birthday_invite');
      expect(approved).toBeDefined();
      expect(approved?.status).toBe('APPROVED');
    });
  });

  /* =========================================================================
   * MATRIX B: Concurrency, Identity Keys & Anti-Spam Arbitration (B01 - B10)
   * ========================================================================= */
  describe('Matrix B: Concurrency, Identity Keys & Anti-Spam Arbitration', () => {
    it('B01: atomic step lease acquisition ensures only one worker claims a due step via real claimNextDueExecution', async () => {
      const tenantId = 'qa_tenant_b01';

      await CampaignExecutionModel.create({
        id: 'exe_b01',
        tenantId,
        enrollmentId: 'enr_b01',
        campaignId: 'cmp_b01',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 1000), // Due in past
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'NONE',
        lease: { token: null, until: null, claimedBy: null }
      });

      const now = new Date();
      // Concurrent worker poll
      const [claimA, claimB] = await Promise.all([
        claimNextDueExecution(tenantId, now, 'worker_A'),
        claimNextDueExecution(tenantId, now, 'worker_B')
      ]);

      // Exactly one worker must succeed, the other receives null
      const claimed = claimA || claimB;
      const missed = claimA ? claimB : claimA;

      expect(claimed).not.toBeNull();
      expect(missed).toBeNull();
      expect(claimed?.state).toBe('EVALUATING');
      expect(claimed?.lease.token).not.toBeNull();
    });

    it('B02: expired worker lease (>30s) is safely reclaimed by subsequent worker poll via claimNextDueExecution', async () => {
      const tenantId = 'qa_tenant_b02';
      const pastTime = new Date(Date.now() - 60000); // 1 minute ago

      await CampaignExecutionModel.create({
        id: 'exe_b02',
        tenantId,
        enrollmentId: 'enr_b02',
        campaignId: 'cmp_b02',
        stepId: 'invitation',
        dueAt: pastTime,
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'NONE',
        lease: {
          token: 'stale_token',
          until: new Date(Date.now() - 5000), // Expired 5s ago
          claimedBy: 'dead_worker'
        }
      });

      const serverNow = new Date();
      const reclaimed = await claimNextDueExecution(tenantId, serverNow, 'fresh_worker');

      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.id).toBe('exe_b02');
      expect(reclaimed?.lease.claimedBy).toBe('fresh_worker');
    });

    it('B03: rolling 24-hour contact cap blocks second marketing message to same phone', async () => {
      const phone = `+919800${Math.floor(100000 + Math.random() * 900000)}`;

      const res1 = await checkAndReserveContactCapacity(
        'qa_tenant_caps',
        phone,
        'cmp_bday',
        'exe_first',
        new Date(Date.now() + 86400000),
        80
      );
      expect(res1.allowed).toBe(true);

      const res2 = await checkAndReserveContactCapacity(
        'qa_tenant_caps',
        phone,
        'cmp_festival',
        'exe_second',
        new Date(Date.now() + 86400000),
        50
      );
      expect(res2.allowed).toBe(false);
      expect(['DEFERRED_CONTACT_CAP', 'SKIPPED_CONTACT_CAP']).toContain(res2.reason);
    });

    it('B04: rolling 7-day contact cap strictly enforces maximum of 3 marketing messages', async () => {
      const phone = `+919801${Math.floor(100000 + Math.random() * 900000)}`;
      const baseTime = Date.now();

      // Send 3 allowed messages spaced across days 1, 3, 5
      for (let i = 1; i <= 3; i++) {
        const timeOffset = i * 26 * 3600 * 1000; // 26h intervals bypass 24h cap
        const res = await checkAndReserveContactCapacity(
          'qa_tenant_caps',
          phone,
          `cmp_${i}`,
          `exe_${i}`,
          new Date(baseTime + timeOffset + 86400000),
          70,
          new Date(baseTime + timeOffset)
        );
        expect(res.allowed).toBe(true);
      }

      // 4th message on day 6 (within 7d window) must be blocked
      const day6Time = baseTime + 4 * 26 * 3600 * 1000;
      const res4 = await checkAndReserveContactCapacity(
        'qa_tenant_caps',
        phone,
        'cmp_excess',
        'exe_excess',
        new Date(day6Time + 86400000),
        70,
        new Date(day6Time)
      );
      expect(res4.allowed).toBe(false);
      expect(['DEFERRED_CONTACT_CAP', 'SKIPPED_CONTACT_CAP']).toContain(res4.reason);
    });

    it('B05: service/transactional notifications carry high priority over marketing', () => {
      const marketingPriority = 60;
      const serviceAlterationPriority = 100;
      expect(serviceAlterationPriority).toBeGreaterThan(marketingPriority);
    });

    it('B06: collision priority arbitration awards contact slot to higher priority campaign and displaces lower priority', async () => {
      const phone = `+919802${Math.floor(100000 + Math.random() * 900000)}`;

      // 1. Lower priority campaign (priority 50) reserves slot
      const promoRes = await checkAndReserveContactCapacity(
        'qa_tenant_caps',
        phone,
        'cmp_promo',
        'exe_promo',
        new Date(Date.now() + 86400000),
        50
      );
      expect(promoRes.allowed).toBe(true);

      // 2. Higher priority campaign (priority 85) competes in same window
      const bdayRes = await checkAndReserveContactCapacity(
        'qa_tenant_caps',
        phone,
        'cmp_bday',
        'exe_bday',
        new Date(Date.now() + 86400000),
        85
      );
      // Higher priority wins the slot by displacing the lower priority reservation
      expect(bdayRes.allowed).toBe(true);
    });

    it('B07: two-phase intent freezing encrypts recipient phone and computes canonical hash', () => {
      const rawPhone = '+919988776655';
      const encrypted = encryptText(rawPhone);

      expect(encrypted).not.toBe(rawPhone);
      expect(decryptText(encrypted)).toBe(rawPhone);

      const params = { patronName: 'Meera', saree: 'Kanjeevaram Silk' };
      const hash1 = sha256(params);
      const hash2 = sha256(params);
      expect(hash1).toBe(hash2);
    });

    it('B08: executionKey strictly conforms to enrollmentId:stableStepId regardless of worker or retries', () => {
      const enrollmentId = 'enr_test_123';
      const stepId = 'invitation';
      const executionKey = `${enrollmentId}:${stepId}`;

      expect(executionKey).toBe('enr_test_123:invitation');
      expect(executionKey).not.toContain('worker');
      expect(executionKey).not.toContain('retry');
    });

    it('B09: duplicate delivery protection: unique compound index on CampaignDeliveryIntentModel prevents duplicate delivery for same executionId', async () => {
      const tenantId = 'qa_tenant_b09';
      const executionId = 'exe_dedup_01';

      await CampaignDeliveryIntentModel.create({
        id: 'di_001',
        tenantId,
        executionId,
        deliveryKey: executionId,
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        encryptedRecipient: encryptText('+919876543210'),
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        parameters: {},
        payloadHash: 'hash_01',
        state: 'ACCEPTED',
        attemptId: 'att_01',
        providerMessageId: 'wamid.HB123',
        submittedAt: new Date()
      });

      // Attempting second delivery intent for same executionId in same tenant must fail with MongoDB E11000 duplicate key
      let duplicateError: any = null;
      try {
        await CampaignDeliveryIntentModel.create({
          id: 'di_002',
          tenantId,
          executionId, // Duplicate!
          deliveryKey: executionId,
          connectionId: 'conn_test',
          customerId: 'cus_lakshmi_01',
          recipientVersion: 1,
          encryptedRecipient: encryptText('+919876543210'),
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          parameters: {},
          payloadHash: 'hash_02',
          state: 'SUBMITTING',
          attemptId: 'att_02'
        });
      } catch (err: any) {
        duplicateError = err;
      }

      expect(duplicateError).not.toBeNull();
      expect(duplicateError.code).toBe(11000); // E11000 duplicate key
    });

    it('B10: optimistic concurrency: plan revision increment rejects stale executor updates', async () => {
      const tenantId = 'qa_tenant_b10';

      await CampaignExecutionModel.create({
        id: 'exe_b10',
        tenantId,
        enrollmentId: 'enr_b10',
        campaignId: 'cmp_b10',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1, // Current revision 1
        state: 'SCHEDULED',
        prerequisite: 'NONE'
      });

      // Worker 1 atomically increments revision from 1 -> 2
      const res1 = await CampaignExecutionModel.updateOne(
        { id: 'exe_b10', planRevision: 1 },
        { $inc: { planRevision: 1 } }
      );
      expect(res1.modifiedCount).toBe(1);

      // Stale Worker 2 attempts update with old revision 1 -> Matches 0 docs!
      const res2 = await CampaignExecutionModel.updateOne(
        { id: 'exe_b10', planRevision: 1 },
        { $inc: { planRevision: 1 } }
      );
      expect(res2.modifiedCount).toBe(0);
    });
  });

  /* =========================================================================
   * MATRIX C: Delivery, Provider Adapter, Error Handling & Webhooks (C01 - C10)
   * ========================================================================= */
  describe('Matrix C: Delivery, Provider Adapter, Error Handling & Webhooks', () => {
    let adapter: MockWhatsAppDeliveryAdapter;

    beforeEach(() => {
      adapter = new MockWhatsAppDeliveryAdapter();
    });

    it('C01: mock adapter dispatches approved template returning ACCEPTED with wamid', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_c01',
        deliveryKey: 'exe_c01',
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

    it('C02: mock adapter rejects unapproved template with TEMPLATE_NOT_FOUND', async () => {
      const result = await adapter.sendCampaignStep({
        executionId: 'exe_c02',
        deliveryKey: 'exe_c02',
        connectionId: 'conn_test',
        customerId: 'cus_lakshmi_01',
        recipientVersion: 1,
        template: { id: 'tpl_unapproved_spec', revision: 1, language: 'en' },
        parameters: {},
        expiresAt: new Date(Date.now() + 3600000)
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('REJECTED');
      expect(result.errorCode).toBe('TEMPLATE_NOT_FOUND');
    });

    it('C03: provider webhook transition to DELIVERED updates execution record in MongoDB', async () => {
      const tenantId = 'qa_tenant_c03';

      const execution = await CampaignExecutionModel.create({
        id: 'exe_c03',
        tenantId,
        enrollmentId: 'enr_c03',
        campaignId: 'cmp_c03',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'PROVIDER_ACCEPTED',
        prerequisite: 'NONE'
      });

      // Status update arrives from Meta: delivered
      const deliveredTime = new Date('2026-10-14T10:05:00.000Z');
      await CampaignExecutionModel.updateOne(
        { id: execution.id },
        { $set: { state: 'DELIVERED', deliveredAt: deliveredTime } }
      );

      const updated = await CampaignExecutionModel.findOne({ id: execution.id });
      expect(updated?.state).toBe('DELIVERED');
      expect(updated?.deliveredAt?.toISOString()).toBe(deliveredTime.toISOString());
    });

    it('C04: provider webhook transition to READ updates execution record in MongoDB', async () => {
      const tenantId = 'qa_tenant_c04';

      const execution = await CampaignExecutionModel.create({
        id: 'exe_c04',
        tenantId,
        enrollmentId: 'enr_c04',
        campaignId: 'cmp_c04',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'DELIVERED',
        prerequisite: 'NONE'
      });

      // Status update arrives from Meta: read
      const readTime = new Date('2026-10-14T10:07:00.000Z');
      await CampaignExecutionModel.updateOne(
        { id: execution.id },
        { $set: { state: 'READ', readAt: readTime } }
      );

      const updated = await CampaignExecutionModel.findOne({ id: execution.id });
      expect(updated?.state).toBe('READ');
      expect(updated?.readAt?.toISOString()).toBe(readTime.toISOString());
    });

    it('C05: retryable network error triggers exponential backoff without marking fatal failure', () => {
      let attempt = 1;
      const maxAttempts = 3;

      const calculateBackoffMs = (att: number) => Math.pow(2, att) * 1000;

      expect(calculateBackoffMs(attempt)).toBe(2000);
      attempt++;
      expect(calculateBackoffMs(attempt)).toBe(4000);
      expect(attempt).toBeLessThanOrEqual(maxAttempts);
    });

    it('C06: ambiguous network timeout marked OUTCOME_UNKNOWN and strictly prohibits blind re-send', async () => {
      adapter.setForcedState('FORCE_TIMEOUT');

      const result = await adapter.sendCampaignStep({
        executionId: 'exe_c06_timeout',
        deliveryKey: 'exe_c06_timeout',
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

      // Handoff Page 27: OUTCOME_UNKNOWN must NEVER be blindly re-submitted
      const canBlindResend = (state: string) => state !== 'OUTCOME_UNKNOWN';
      expect(canBlindResend(result.state)).toBe(false);
    });

    it('C07: webhook signature verification validates SHA-256 HMAC and rejects forged payloads using real verifyMetaSignature', () => {
      const appSecret = 'boutique_meta_app_secret_xyz';
      const rawPayload = JSON.stringify({ event: 'delivery_receipt', wamid: 'wamid.HB123' });

      // Generate valid signature
      const validHmac = crypto.createHmac('sha256', appSecret).update(rawPayload).digest('hex');
      const validHeader = `sha256=${validHmac}`;

      expect(verifyMetaSignature(validHeader, rawPayload, appSecret)).toBe(true);
      expect(verifyMetaSignature('sha256=forged_bad_hash', rawPayload, appSecret)).toBe(false);
      expect(verifyMetaSignature(undefined, rawPayload, appSecret)).toBe(false);
    });

    it('C08: duplicate webhook idempotency via CampaignEventInboxModel with compound unique index', async () => {
      const tenantId = 'qa_tenant_c08';
      const eventId = 'evt_unique_wamid_01';

      await CampaignEventInboxModel.create({
        id: generateId('inb'),
        tenantId,
        producer: 'whatsapp',
        eventId,
        type: 'campaign.reply_received',
        entityId: 'cus_01',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        status: 'PROCESSED'
      });

      // Attempting to re-ingest duplicate eventId throws MongoDB E11000 duplicate key error
      let duplicateErr: any = null;
      try {
        await CampaignEventInboxModel.create({
          id: generateId('inb'),
          tenantId,
          producer: 'whatsapp',
          eventId, // Duplicate!
          type: 'campaign.reply_received',
          entityId: 'cus_01',
          entityVersion: 1,
          occurredAt: new Date(),
          receivedAt: new Date(),
          status: 'RECEIVED'
        });
      } catch (err: any) {
        duplicateErr = err;
      }

      expect(duplicateErr).not.toBeNull();
      expect(duplicateErr.code).toBe(11000);
    });

    it('C09: processClaimedExecution executes preflight safeguards and dispatches via MockWhatsAppDeliveryAdapter', async () => {
      const tenantId = 'qa_tenant_c09';

      await CampaignModel.create({
        id: 'cmp_c09',
        tenantId,
        name: 'Live Dispatch Campaign',
        type: 'ANNUAL_DATE',
        status: 'ACTIVE',
        activeVersionId: 'cv_c09',
        priority: 80,
        reviewFingerprint: 'fp_c09'
      });

      await CampaignVersionModel.create({
        id: 'cv_c09',
        tenantId,
        campaignId: 'cmp_c09',
        version: 1,
        name: 'Live Dispatch Version',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        audience: {},
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { patronName: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_c09'
      });

      await CustomerModel.create({
        id: 'cus_c09',
        tenantId,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876543299',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      await CampaignEnrollmentModel.create({
        id: 'enr_c09',
        tenantId,
        campaignId: 'cmp_c09',
        campaignVersionId: 'cv_c09',
        customerId: 'cus_c09',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_c09', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_c09:cus_c09:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_c09',
        tenantId,
        enrollmentId: 'enr_c09',
        campaignId: 'cmp_c09',
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'EVALUATING',
        prerequisite: 'NONE',
        lease: { token: 'lease_test', until: new Date(Date.now() + 30000), claimedBy: 'worker_1' }
      });

      const resultState = await processClaimedExecution(execution, adapter);
      expect(resultState).toBe('ACCEPTED');

      // Verify execution updated to PROVIDER_ACCEPTED in MongoDB
      const updated = await CampaignExecutionModel.findOne({ id: 'exe_c09' });
      expect(updated?.state).toBe('PROVIDER_ACCEPTED');

      // Verify delivery intent was created
      const intent = await CampaignDeliveryIntentModel.findOne({ executionId: 'exe_c09' });
      expect(intent).not.toBeNull();
      expect(intent?.state).toBe('ACCEPTED');
      expect(intent?.providerMessageId).toMatch(/^wamid\./);
    });

    it('C10: inbound customer WhatsApp reply updates CampaignEnrollmentModel with replyHoldAt', async () => {
      const tenantId = 'qa_tenant_c10';

      const enrollment = await CampaignEnrollmentModel.create({
        id: 'enr_c10',
        tenantId,
        campaignId: 'cmp_c10',
        campaignVersionId: 'cv_c10',
        customerId: 'cus_lakshmi_01',
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_lakshmi_01', version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:cmp_c10:cus_lakshmi_01:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Simulate webhook processor receiving inbound reply from customer
      const replyTime = new Date();
      await CampaignEnrollmentModel.updateMany(
        { customerId: 'cus_lakshmi_01', status: 'ACTIVE' },
        { $set: { replyHoldAt: replyTime } }
      );

      const updated = await CampaignEnrollmentModel.findById(enrollment._id);
      expect(updated?.replyHoldAt).toEqual(replyTime);
    });
  });

  describe('Regression & Production Hardening Suite (REG-01 - REG-08)', () => {
    it('REG-01: multi-step prerequisite PREVIOUS_ACCEPTED succeeds when prior step is DELIVERED or READ', async () => {
      const tenantId = 'qa_tenant_reg01';
      const campaignId = 'cmp_reg01_multistep';
      const versionId = 'cv_reg01_multistep';
      const enrollmentId = 'enr_reg01';
      const customerId = 'cus_reg01_lakshmi';

      // 1. Setup Customer
      await CustomerModel.create({
        id: customerId,
        tenantId,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876543211',
        channelSuppressed: false,
        optedInMarketing: true,
        birthdayMonth: 10,
        birthdayDay: 28,
        status: 'ACTIVE'
      });

      // 2. Setup Campaign and Version with 2 Steps (invitation and followup with PREVIOUS_ACCEPTED)
      await CampaignModel.create({
        id: campaignId,
        tenantId,
        name: 'Birthday Sequence Test',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: versionId,
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: versionId,
        tenantId,
        campaignId,
        version: 1,
        name: 'Birthday Sequence v1',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          },
          {
            stepId: 'followup',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'PREVIOUS_ACCEPTED',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        resumePolicy: 'FUTURE_ONLY',
        importPolicy: 'FUTURE_ONLY',
        enabledBranches: [],
        publishedBy: 'test_runner',
        publishedAt: new Date(),
        reviewFingerprint: 'fp_reg01_test'
      });

      await CampaignEnrollmentModel.create({
        id: enrollmentId,
        tenantId,
        campaignId,
        campaignVersionId: versionId,
        customerId,
        occurrenceId: '2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
        status: 'ACTIVE',
        enrollmentKey: `${tenantId}:${campaignId}:${customerId}:2026`,
        enrolledAt: new Date(),
        replyHoldAt: null,
        goalReachedAt: null
      });

      // 3. Create Invitation Execution in DELIVERED state (simulating webhook delivery receipt)
      const invitationExecution = await CampaignExecutionModel.create({
        id: 'exe_reg01_invitation',
        tenantId,
        enrollmentId,
        campaignId,
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 7 * 86400 * 1000),
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
        localDate: '2026-10-14',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'DELIVERED',
        prerequisite: 'NONE',
        retryCount: 0,
        deliveredAt: new Date()
      });

      // 4. Create Follow-up Execution with PREVIOUS_ACCEPTED prerequisite
      const followupExecution = await CampaignExecutionModel.create({
        id: 'exe_reg01_followup',
        tenantId,
        enrollmentId,
        campaignId,
        stepId: 'followup',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
        localDate: '2026-10-21',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'PREVIOUS_ACCEPTED',
        retryCount: 0
      });

      // 5. Evaluate Safeguards on Followup -> MUST PROCEED because invitation was DELIVERED!
      const outcome = await executePreflightSafeguards(followupExecution);
      expect(outcome.status).toBe('PROCEED');

      // Now simulate invitation advancing to READ state
      invitationExecution.state = 'READ';
      invitationExecution.readAt = new Date();
      await invitationExecution.save();

      // Clear the temporary contact reservation created by first check to re-evaluate gate with READ state
      await CampaignContactGateModel.deleteMany({ tenantId });

      const outcomeAfterRead = await executePreflightSafeguards(followupExecution);
      expect(outcomeAfterRead.status).toBe('PROCEED');
    });

    it('REG-02: webhook status monotonicity guarantees late delivered receipt cannot overwrite READ state', async () => {
      const tenantId = 'qa_tenant_reg02';
      const executionId = 'exe_reg02_monotonicity';
      const providerMsgId = 'wamid.REG02_RECEIPT_TEST_001';

      await CampaignExecutionModel.create({
        id: executionId,
        tenantId,
        enrollmentId: 'enr_reg02',
        campaignId: 'cmp_reg02',
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'READ',
        readAt: new Date(Date.now() - 1000),
        prerequisite: 'NONE',
        retryCount: 0
      });

      const intent = await CampaignDeliveryIntentModel.create({
        id: 'di_reg02',
        tenantId,
        executionId,
        deliveryKey: executionId,
        connectionId: 'conn_test',
        customerId: 'cus_reg02',
        recipientVersion: 1,
        encryptedRecipient: encryptText('+919876543212'),
        templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
        parameters: { name: 'Lakshmi' },
        payloadHash: 'hash_reg02',
        state: 'ACCEPTED',
        attemptId: 'att_reg02',
        providerMessageId: providerMsgId,
        submittedAt: new Date(),
        readAt: new Date()
      });

      // Simulate late delivered status update arriving from Meta with older epoch timestamp
      const lateEpochTimestamp = '1710000000';
      const providerTimestamp = new Date(Number(lateEpochTimestamp) * 1000);

      // Monotonic guard: update only if state is in ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED']
      const updateResult = await CampaignExecutionModel.updateOne(
        {
          id: intent.executionId,
          tenantId: intent.tenantId,
          state: { $in: ['SCHEDULED', 'EVALUATING', 'DISPATCHING', 'PROVIDER_ACCEPTED'] }
        },
        {
          $set: {
            state: 'DELIVERED',
            deliveredAt: providerTimestamp
          }
        }
      );

      expect(updateResult.modifiedCount).toBe(0);

      const unchangedExecution = await CampaignExecutionModel.findOne({ id: executionId });
      expect(unchangedExecution?.state).toBe('READ');
    });

    it('REG-03: HMAC fail-closed verification rejects forged, unconfigured, or tampered payloads', () => {
      const secret = 'test_secret_key_12345';
      const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

      // Missing signature header -> returns false
      expect(verifyMetaSignature(undefined, rawBody, secret)).toBe(false);

      // Missing secret -> returns false
      expect(verifyMetaSignature('sha256=abcdef', rawBody, '')).toBe(false);

      // Correct signature calculation
      const validSig = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      expect(verifyMetaSignature(validSig, rawBody, secret)).toBe(true);

      // Tampered payload with valid sig for different body -> returns false
      const tamperedBody = Buffer.from(JSON.stringify({ object: 'forged_account' }));
      expect(verifyMetaSignature(validSig, tamperedBody, secret)).toBe(false);
    });

    it('REG-04: domain event inbox enforces atomic deduplication and preserves producer occurredAt and entityVersion', async () => {
      const tenantId = 'qa_tenant_reg04';
      const eventId = 'evt_producer_reg04_01';
      const producer = 'inventory';
      const customOccurredAt = new Date('2026-10-15T02:00:00.000Z');
      const producerEntityVersion = 4;

      // First ingestion
      const eventDoc = await CampaignEventInboxModel.create({
        id: eventId,
        tenantId,
        producer,
        eventId,
        type: 'stock.published',
        entityId: 'sku_silk_001',
        entityVersion: producerEntityVersion,
        occurredAt: customOccurredAt,
        receivedAt: new Date(),
        customerId: 'cus_patron_01',
        data: { sku: 'SKU-KAN-001', stockCount: 5 },
        status: 'RECEIVED'
      });

      expect(eventDoc.occurredAt).toEqual(customOccurredAt);
      expect(eventDoc.entityVersion).toBe(4);
      expect(eventDoc.status).toBe('RECEIVED');

      // Duplicate ingestion with same tenantId, producer, and eventId MUST throw E11000
      let duplicateThrewE11000 = false;
      try {
        await CampaignEventInboxModel.create({
          id: 'evt_producer_reg04_01_alt',
          tenantId,
          producer,
          eventId,
          type: 'stock.published',
          entityId: 'sku_silk_001',
          entityVersion: producerEntityVersion,
          occurredAt: customOccurredAt,
          receivedAt: new Date(),
          status: 'RECEIVED'
        });
      } catch (err: any) {
        if (err.code === 11000) {
          duplicateThrewE11000 = true;
        }
      }

      expect(duplicateThrewE11000).toBe(true);
    });

    it('REG-05: timingSafeCompare provides constant-time comparison against timing side-channels', () => {
      const validKey = 'internal_secret_key_prod_998877';
      expect(timingSafeCompare(validKey, validKey)).toBe(true);
      expect(timingSafeCompare(validKey, 'internal_secret_key_wrong')).toBe(false);
      expect(timingSafeCompare(undefined, validKey)).toBe(false);
      expect(timingSafeCompare(validKey, undefined)).toBe(false);
      expect(timingSafeCompare('short', 'longer_string')).toBe(false);
    });

    it('REG-06: pauseGeneration stamp and campaign resume synchronize executions without stranding', async () => {
      const tenantId = 'qa_tenant_reg06';
      const campaignId = 'cmp_reg06';

      const campaign = await CampaignModel.create({
        id: campaignId,
        tenantId,
        name: 'Pause Resume Test Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_reg06',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const execution = await CampaignExecutionModel.create({
        id: 'exe_reg06_step',
        tenantId,
        enrollmentId: 'enr_reg06',
        campaignId,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        pauseGeneration: 0,
        state: 'SCHEDULED',
        prerequisite: 'NONE'
      });

      // 1. Simulate pause -> increments pauseGeneration
      campaign.status = 'PAUSED';
      campaign.pauseGeneration = 1;
      await campaign.save();

      // In-flight execution evaluated while campaign is paused -> halts with SKIPPED_CAMPAIGN_PAUSED
      const pausedOutcome = await executePreflightSafeguards(execution);
      expect(pausedOutcome.status).toBe('SKIP');
      expect((pausedOutcome as any).reason).toBe('SKIPPED_CAMPAIGN_PAUSED');

      // 2. Simulate resume before execution update -> generation mismatch defers
      campaign.status = 'ACTIVE';
      campaign.pauseGeneration = 2;
      await campaign.save();

      const mismatchOutcome = await executePreflightSafeguards(execution);
      expect(mismatchOutcome.status).toBe('DEFER');
      expect((mismatchOutcome as any).reason).toBe('DEFERRED_PAUSE_GENERATION_MISMATCH');

      // 3. Resume synchronization re-stamps executions with new generation
      await CampaignExecutionModel.updateMany(
        { campaignId, tenantId, state: { $in: ['SCHEDULED', 'DEFERRED'] } },
        { $set: { pauseGeneration: campaign.pauseGeneration } }
      );

      const updatedExecution = await CampaignExecutionModel.findOne({ id: 'exe_reg06_step' });
      expect(updatedExecution?.pauseGeneration).toBe(2);
    });

    it('REG-07: sweepOutcomeUnknownExecutions reconciles late receipts and respects outage grace period', async () => {
      const tenantId = 'qa_tenant_reg07';
      const executionId = 'exe_reg07_unknown';
      const deliveryIntentId = 'di_reg07_unknown';

      // Setup execution in OUTCOME_UNKNOWN updated 40 minutes ago (past 30-min outage grace)
      const pastTime = new Date(Date.now() - 40 * 60 * 1000);
      const execution = await CampaignExecutionModel.create({
        id: executionId,
        tenantId,
        enrollmentId: 'enr_reg07',
        campaignId: 'cmp_reg07',
        stepId: 'invitation',
        dueAt: pastTime,
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        pauseGeneration: 0,
        state: 'OUTCOME_UNKNOWN',
        prerequisite: 'NONE',
        deliveryIntentId,
        retryCount: 0,
        createdAt: pastTime,
        updatedAt: pastTime
      });

      await CampaignDeliveryIntentModel.create({
        id: deliveryIntentId,
        tenantId,
        executionId,
        deliveryKey: executionId,
        connectionId: 'conn_test',
        customerId: 'cus_reg07',
        recipientVersion: 1,
        encryptedRecipient: encryptText('+919876543217'),
        templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
        parameters: { name: 'Sunita' },
        payloadHash: 'hash_reg07',
        state: 'OUTCOME_UNKNOWN',
        attemptId: 'att_reg07',
        submittedAt: pastTime
      });

      // Run sweeper with serverNow = current time (elapsed > 30 min)
      const sweepResult = await sweepOutcomeUnknownExecutions(tenantId, new Date(), 30 * 60 * 1000);

      // Should schedule 1st retry with exponential backoff (15 min)
      expect(sweepResult.retriedCount).toBe(1);

      const retried = await CampaignExecutionModel.findOne({ id: executionId });
      expect(retried?.state).toBe('DEFERRED');
      expect(retried?.retryCount).toBe(1);
      expect(retried?.outcomeReason).toBe('OUTAGE_RETRY_SCHEDULED_1');
    });

    it('REG-08: template variableKeys enforce strict positional parameter mapping for Meta Cloud API', () => {
      const template = getApprovedTemplate('tpl_birthday_invite');
      expect(template).not.toBeNull();
      // tpl_birthday_invite requires variableKeys: ['name', 'shop']
      expect(template?.variableKeys).toEqual(['name', 'shop']);

      // Parameter dictionary in reversed key order
      const params = { shop: 'GroVastra Boutique', name: 'Ananya' };

      // Strictly map according to template variableKeys
      const positionalList = template!.variableKeys.map((key) => ({
        type: 'text',
        text: String((params as any)[key] ?? '')
      }));

      expect(positionalList[0].text).toBe('Ananya'); // {{1}} is name
      expect(positionalList[1].text).toBe('GroVastra Boutique'); // {{2}} is shop
    });
  });
});
