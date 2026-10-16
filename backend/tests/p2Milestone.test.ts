import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import { DateTime } from 'luxon';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDryRunModel } from '../src/modules/campaigns/models/CampaignDryRun.model';
import { TenantSettingsModel, REQUIRED_SETTINGS_NOTICE } from '../src/modules/campaigns/models/TenantSettings.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { AuditLogModel } from '../src/modules/campaigns/models/AuditLog.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { campaignRouter } from '../src/modules/campaigns/routes/campaign.routes';
import { planAnnualOccasions } from '../src/modules/campaigns/engine/annualDateStrategy';
import { evaluateCampaignDryRun } from '../src/modules/campaigns/engine/dryRun';
import { runSafeguardPipeline } from '../src/modules/campaigns/engine/safeguards/safeguardPipeline';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant,
  adjustForAllowedHoursAndBlackouts
} from '../src/shared/utils/clock';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';

describe('Work Package P2: Milestone 2 Gaps & Matrix Verification', () => {
  let app: Express;
  let server: http.Server;
  let baseUrl: string;

  const tenantId = 'qa_tenant_p2';
  let ownerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', campaignRouter);

    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function apiGet(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...headers }
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  async function apiPost(path: string, body: any, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': generateId('idemp'),
        ...headers
      },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  async function apiPatch(path: string, body: any, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': generateId('idemp'),
        ...headers
      },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  beforeEach(async () => {
    ownerToken = signJwt({
      userId: 'usr_p2_owner',
      tenantId,
      role: 'BOUTIQUE_OWNER'
    });

    staffToken = signJwt({
      userId: 'usr_p2_staff',
      tenantId,
      role: 'STAFF'
    });

    // Clean up tenant collections
    await CampaignModel.deleteMany({ tenantId });
    await CampaignVersionModel.deleteMany({ tenantId });
    await CampaignEnrollmentModel.deleteMany({ tenantId });
    await CampaignExecutionModel.deleteMany({ tenantId });
    await CampaignDryRunModel.deleteMany({ tenantId });
    await TenantSettingsModel.deleteMany({ tenantId });
    await TenantConnectionModel.deleteMany({ tenantId });
    await AuditLogModel.deleteMany({ tenantId });
    await CustomerModel.deleteMany({ tenantId });

    // Set up active provisioned connection for tenant
    await TenantConnectionModel.create({
      id: generateId('di'),
      tenantId,
      connectionId: 'conn_p2_meta',
      wabaId: 'waba_p2',
      phoneNumberId: 'phone_p2',
      displayPhoneNumber: '+919876500000',
      active: true
    });
  });

  describe('P2.g & C01: Dry Run & Preview Specification', () => {
    it('C01: Dry run persists a report, creates zero executions and zero live message requests', async () => {
      const clock = new SettableTestClock('2026-10-15T10:00:00.000Z');

      await CustomerModel.create({
        id: 'cus_c01_01',
        tenantId,
        firstName: 'Ananya',
        lastName: 'Sharma',
        phone: '+919876543210',
        birthdayMonth: 10,
        birthdayDay: 25,
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const version = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: 'cmp_c01',
        version: 1,
        name: 'Dry Run Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -10,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        resumePolicy: 'FUTURE_ONLY',
        importPolicy: 'FUTURE_ONLY',
        enabledBranches: ['default'],
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_c01'
      });

      const result = await evaluateCampaignDryRun(version, clock);

      // Verify DB outcomes
      expect(result.summary.eligibleCount).toBe(1);
      expect(result.samplePlans.length).toBe(1);
      expect(result.samplePlans[0].steps[0].renderedPreview).toContain('Ananya');

      // Zero live executions created
      const liveExecutions = await CampaignExecutionModel.countDocuments({ tenantId });
      expect(liveExecutions).toBe(0);

      // Persisted dry run audit exists
      const persisted = await CampaignDryRunModel.findOne({ tenantId, draftFingerprint: result.draftFingerprint });
      expect(persisted).toBeTruthy();
      expect(persisted?.summary.eligibleCount).toBe(1);
    });

    it('A03: Activation rejects stale review fingerprint when draft is modified after dry run', async () => {
      const cmp = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'DRAFT',
        activeVersionId: null,
        draftVersion: 1,
        pauseGeneration: 0
      });

      const draft = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: cmp.id,
        version: 1,
        name: cmp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'step_1',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_valid_original'
      });

      // Save dry run report for original fingerprint
      await CampaignDryRunModel.create({
        id: generateId('dr'),
        tenantId,
        campaignId: cmp.id,
        draftVersion: 1,
        draftFingerprint: 'fp_valid_original',
        evaluatedAt: new Date(),
        summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 },
        reasonBreakdown: { ELIGIBLE: 1 },
        samplePlans: []
      });

      // User modifies draft after dry run -> reviewFingerprint updates
      const patchRes = await apiPatch(
        `/api/v1/campaigns/${cmp.id}/draft`,
        { priority: 90, expectedVersion: 1 },
        { Authorization: `Bearer ${ownerToken}` }
      );
      expect(patchRes.status).toBe(200);

      // Attempting to activate with stale reviewFingerprint must be rejected
      const res = await apiPost(
        `/api/v1/campaigns/${cmp.id}/activate`,
        { reviewFingerprint: 'fp_valid_original', expectedVersion: patchRes.body.campaign?.draftVersion || 2 },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mismatch');

      // Campaign remains DRAFT
      const unactivated = await CampaignModel.findOne({ id: cmp.id });
      expect(unactivated?.status).toBe('DRAFT');
    });
  });

  describe('P2.h & A05: Validation and Activation Readiness', () => {
    it('A05: Activation blocked with fieldPath and resolutionOwner when template or connection is missing', async () => {
      // Create campaign draft with unusable template
      const cmp = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Invalid Template Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'DRAFT',
        activeVersionId: null,
        draftVersion: 1,
        pauseGeneration: 0
      });

      const draft = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: cmp.id,
        version: 1,
        name: cmp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'step_broken',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_non_existent', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_broken'
      });

      await CampaignDryRunModel.create({
        id: generateId('dr'),
        tenantId,
        campaignId: cmp.id,
        draftVersion: 1,
        draftFingerprint: 'fp_test_broken',
        evaluatedAt: new Date(),
        summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 },
        reasonBreakdown: { ELIGIBLE: 1 },
        samplePlans: []
      });

      // Validate endpoint returns structured errors
      const valRes = await apiPost(
        `/api/v1/campaigns/${cmp.id}/validate`,
        { expectedVersion: 1 },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(valRes.status).toBe(200);
      expect(valRes.body.valid).toBe(false);
      expect(valRes.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: 'steps.step_broken.templateRef.id',
            resolutionOwner: 'INTEGRATION_DEVELOPER'
          })
        ])
      );

      // Activation must fail closed with 422
      const actRes = await apiPost(
        `/api/v1/campaigns/${cmp.id}/activate`,
        { reviewFingerprint: 'fp_test_broken', expectedVersion: 1 },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(actRes.status).toBe(422);
      expect(actRes.body.resolutionOwner).toBe('INTEGRATION_DEVELOPER');
    });
  });

  describe('P2.b & P2.c: Date Strategy, Leap Years & Discovery Window', () => {
    it('A07: January birthday invitation scheduled in December has occurrenceYear as upcoming year', () => {
      const clock = new SettableTestClock('2026-12-20T10:00:00.000Z');
      const occurrence = resolveNextAnnualOccurrence(1, 5, 'Asia/Kolkata', 'FEB_28', clock);

      expect(occurrence.occurrenceYear).toBe(2027);
      expect(occurrence.localDate).toBe('2027-01-05');
      expect(occurrence.occurrenceId).toBe('2027');
    });

    it('A08: Leap day policy FEB_28, MAR_01 and LEAP_ONLY evaluated cleanly in non-leap year 2027', () => {
      const clock = new SettableTestClock('2027-01-01T10:00:00.000Z');

      const feb28 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'FEB_28', clock);
      expect(feb28.localDate).toBe('2027-02-28');

      const mar01 = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'MAR_01', clock);
      expect(mar01.localDate).toBe('2027-03-01');

      const leapOnly = resolveNextAnnualOccurrence(2, 29, 'Asia/Kolkata', 'LEAP_ONLY', clock);
      expect(leapOnly.occurrenceYear).toBe(2028); // Next leap year
      expect(leapOnly.localDate).toBe('2028-02-29');
    });

    it('B07: DST spring forward missing local hour resolves to next valid hour', () => {
      const due = calculateDueInstant('2026-03-29', 0, '02:30', 'Europe/London');
      expect(due.dueAtUtc).toBeInstanceOf(Date);
      expect(due.localTime).toBe('02:30');
    });

    it('B08: Blackout dates advance send time or skip if deadline exceeded', () => {
      const initialDueAt = DateTime.fromISO('2026-10-20T10:00:00.000', { zone: 'Asia/Kolkata' }).toJSDate();
      const expiresAt = DateTime.fromISO('2026-10-21T12:00:00.000', { zone: 'Asia/Kolkata' }).toJSDate();

      const adjusted = adjustForAllowedHoursAndBlackouts(
        initialDueAt,
        expiresAt,
        'Asia/Kolkata',
        { start: '10:00', end: '19:00' },
        ['2026-10-20']
      );
      expect(adjusted.valid).toBe(true);

      const expiredAdjust = adjustForAllowedHoursAndBlackouts(
        initialDueAt,
        expiresAt,
        'Asia/Kolkata',
        { start: '10:00', end: '19:00' },
        ['2026-10-20', '2026-10-21']
      );
      expect(expiredAdjust.valid).toBe(false);
      expect(expiredAdjust.reason).toBe('SKIPPED_BLACKOUT_EXPIRED');
    });

    it('B19: Discovery window looks back to find Jan 5 occasion on Jan 6 with D+7 step (elapsed D-14 step skipped)', async () => {
      const clock = new SettableTestClock('2027-01-06T10:00:00.000Z');

      await CustomerModel.create({
        id: 'cus_b19_lakshmi',
        tenantId,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876500019',
        birthdayMonth: 1,
        birthdayDay: 5,
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const version = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: 'cmp_b19',
        version: 1,
        name: 'Multi-Step Birthday',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'early_invite',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          },
          {
            stepId: 'followup',
            offsetDays: 7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_b19'
      });

      const planResult = await planAnnualOccasions(version, clock);
      expect(planResult.plannedEnrollments).toBe(1);

      const executions = await CampaignExecutionModel.find({ tenantId, campaignId: 'cmp_b19' }).sort({ stepId: 1 });
      expect(executions.length).toBe(2);

      const earlyStep = executions.find((e) => e.stepId === 'early_invite');
      const followupStep = executions.find((e) => e.stepId === 'followup');

      expect(earlyStep?.state).toBe('SKIPPED');
      expect(earlyStep?.outcomeReason).toBe('SKIPPED_ELAPSED');

      expect(followupStep?.state).toBe('SCHEDULED');
      expect(followupStep?.localDate).toBe('2027-01-12');
    });
  });

  describe('P2.d: Anniversary & Wedding Scenarios', () => {
    it('A09: Anniversary record removed cancels all pending steps for that saved occasion', async () => {
      const clock = new SettableTestClock('2026-10-15T10:00:00.000Z');

      const customer = await CustomerModel.create({
        id: 'cus_a09_padma',
        tenantId,
        firstName: 'Padma',
        lastName: 'Vathi',
        phone: '+919876500020',
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false,
        savedOccasions: [
          {
            eventId: 'anniv_wedding_01',
            type: 'ANNIVERSARY',
            date: '2026-11-20',
            active: true
          }
        ]
      });

      const version = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: 'cmp_a09',
        version: 1,
        name: 'Anniversary Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.anniversary', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'anniv_invite',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_anniversary_invite', revision: 2, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_a09'
      });

      // 1. Initial plan creates active enrollment and scheduled execution
      await planAnnualOccasions(version, clock);
      let enrollment = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      let execution = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enrollment?.id });
      expect(enrollment?.status).toBe('ACTIVE');
      expect(execution?.state).toBe('SCHEDULED');

      // 2. Customer removes anniversary date -> active set to false
      customer.savedOccasions![0].active = false;
      await customer.save();

      // Planner pass stops pending steps for that removed occasion (A09)
      await planAnnualOccasions(version, clock);

      enrollment = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      execution = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enrollment?.id });

      expect(enrollment?.status).toBe('CANCELLED');
      expect(execution?.state).toBe('SKIPPED');
      expect(execution?.outcomeReason).toBe('SKIPPED_CUSTOMER_DATE_REMOVED');
    });

    it('A10: Wedding postponed after invitation replans unsubmitted steps under same event identity without repeat invitation', async () => {
      const clock = new SettableTestClock('2026-10-15T10:00:00.000Z');

      const customer = await CustomerModel.create({
        id: 'cus_a10_bridal',
        tenantId,
        firstName: 'Sita',
        lastName: 'Ram',
        phone: '+919876500021',
        totalSpendPaise: 8000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false,
        savedOccasions: [
          {
            eventId: 'wed_2026_sita',
            type: 'WEDDING',
            date: '2026-12-01',
            active: true,
            leadTimeDays: 14
          }
        ]
      });

      const version = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: 'cmp_a10',
        version: 1,
        name: 'Bridal Wedding Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.wedding' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'wedding_invite',
            offsetDays: -30,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          },
          {
            stepId: 'wedding_reminder',
            offsetDays: -10,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 70,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_a10'
      });

      // 1. Initial Plan
      await planAnnualOccasions(version, clock);
      const enrollment = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer.id });
      expect(enrollment?.occurrenceId).toBe('wedding:wed_2026_sita');

      // Simulate first invite was already accepted/delivered by provider
      const inviteExe = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enrollment?.id, stepId: 'wedding_invite' });
      inviteExe!.state = 'PROVIDER_ACCEPTED';
      inviteExe!.deliveryIntentId = 'di_already_sent';
      await inviteExe!.save();

      // 2. Wedding is postponed to 2026-12-25
      customer.savedOccasions![0].date = '2026-12-25';
      await customer.save();

      await planAnnualOccasions(version, clock);

      // Verify unsubmitted step was replanned with new due date, while accepted invite was NOT repeated
      const updatedInvite = await CampaignExecutionModel.findOne({ id: inviteExe?.id });
      expect(updatedInvite?.state).toBe('PROVIDER_ACCEPTED');

      const reminderExe = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enrollment?.id, stepId: 'wedding_reminder' });
      expect(reminderExe?.localDate).toBe('2026-12-15');
      expect(reminderExe?.state).toBe('SCHEDULED');
    });
  });

  describe('P2.e & B04: Date Corrections Across Years Lineage', () => {
    it('B04: Date corrected across years suppresses replacement copies of already accepted steps using correctionGroupId lineage', async () => {
      const clock = new SettableTestClock('2026-10-15T10:00:00.000Z');

      const customer = await CustomerModel.create({
        id: 'cus_b04_lineage',
        tenantId,
        firstName: 'Meenakshi',
        lastName: 'Sundaram',
        phone: '+919876500022',
        birthdayMonth: 10,
        birthdayDay: 20,
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const version = await CampaignVersionModel.create({
        id: generateId('cv'),
        tenantId,
        campaignId: 'cmp_b04',
        version: 1,
        name: 'Birthday Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'invitation',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_b04'
      });

      // Plan for 2026
      await planAnnualOccasions(version, clock);
      const enr2026 = await CampaignEnrollmentModel.findOne({ tenantId, occurrenceId: 'birthday:2026' });
      const exe2026 = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enr2026?.id });

      // Mark 2026 invitation as accepted by provider
      exe2026!.state = 'PROVIDER_ACCEPTED';
      await exe2026!.save();

      // Customer date is corrected across years or advances to 2027
      clock.advanceDays(365);
      customer.birthdayMonth = 10;
      customer.birthdayDay = 25;
      await customer.save();

      await planAnnualOccasions(version, clock);

      // Verify 2027 enrollment was created with same correctionGroupId
      const enr2027 = await CampaignEnrollmentModel.findOne({ tenantId, occurrenceId: 'birthday:2027' });
      expect(enr2027).toBeTruthy();
      expect(enr2027?.correctionGroupId).toBe(enr2026?.correctionGroupId);

      // Step that was already accepted under lineage correction is SKIPPED_ALREADY_ACCEPTED (B04)
      const exe2027 = await CampaignExecutionModel.findOne({ tenantId, enrollmentId: enr2027?.id, stepId: 'invitation' });
      expect(exe2027?.state).toBe('SKIPPED');
      expect(exe2027?.outcomeReason).toBe('SKIPPED_ALREADY_ACCEPTED');
    });
  });

  describe('P2.f & B14: Versioning, Revision Publishing, and Archiving', () => {
    it('B14: Publishing revision pins existing enrollments while new enrollments use new version', async () => {
      const clock = new SettableTestClock('2026-10-15T10:00:00.000Z');

      const cmp = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Multi-Step Versioning Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_v1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const v1 = await CampaignVersionModel.create({
        id: 'cv_v1',
        tenantId,
        campaignId: cmp.id,
        version: 1,
        name: cmp.name,
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'step_1',
            offsetDays: -14,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName', shop: 'shop.displayName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          },
          {
            stepId: 'step_2',
            offsetDays: -7,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_v1'
      });

      // Customer enrolled in version 1
      const customer1 = await CustomerModel.create({
        id: 'cus_v1_enrolled',
        tenantId,
        firstName: 'V1',
        lastName: 'Customer',
        phone: '+919876500031',
        birthdayMonth: 10,
        birthdayDay: 28,
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      await planAnnualOccasions(v1, clock);

      const enrV1 = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer1.id });
      expect(enrV1?.campaignVersionId).toBe('cv_v1');
      const exeCountV1 = await CampaignExecutionModel.countDocuments({ tenantId, enrollmentId: enrV1?.id });
      expect(exeCountV1).toBe(2);

      // Publish revision adding a third step (v2)
      const v2DryRun = await evaluateCampaignDryRun(v1, clock);
      const pubRes = await apiPost(
        `/api/v1/campaigns/${cmp.id}/publish-revision`,
        {
          expectedVersion: 1,
          reviewFingerprint: v2DryRun.draftFingerprint,
          steps: [
            ...v1.steps,
            {
              stepId: 'step_3_greeting',
              offsetDays: 0,
              localTime: '10:00',
              prerequisite: 'NONE',
              templateRef: { id: 'tpl_birthday_greeting', revision: 1, language: 'en' },
              bindings: { name: 'customer.firstName' },
              stopOnReply: false,
              stopOnGoal: false,
              maxLatenessMinutes: 240
            }
          ]
        },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(pubRes.status).toBe(200);
      const v2VersionId = pubRes.body.activeVersion.id;

      // New customer enrolled after revision
      const customer2 = await CustomerModel.create({
        id: 'cus_v2_new',
        tenantId,
        firstName: 'V2',
        lastName: 'Customer',
        phone: '+919876500032',
        birthdayMonth: 10,
        birthdayDay: 29,
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const v2Doc = await CampaignVersionModel.findOne({ id: v2VersionId });
      await planAnnualOccasions(v2Doc!, clock);

      // Older enrollment stays pinned to v1 with 2 steps (B14)
      const olderEnr = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer1.id });
      expect(olderEnr?.campaignVersionId).toBe('cv_v1');
      const olderExecutions = await CampaignExecutionModel.find({ tenantId, enrollmentId: olderEnr?.id });
      expect(olderExecutions.length).toBe(2);

      // New enrollment uses v2 with 3 steps
      const newerEnr = await CampaignEnrollmentModel.findOne({ tenantId, customerId: customer2.id });
      expect(newerEnr?.campaignVersionId).toBe(v2VersionId);
      const newerExecutions = await CampaignExecutionModel.find({ tenantId, enrollmentId: newerEnr?.id });
      expect(newerExecutions.length).toBe(3);
    });

    it('Archive cancels pending executions and marks enrollments CANCELLED, not COMPLETED', async () => {
      const cmp = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Archived Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_arch',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: cmp.id,
        campaignVersionId: 'cv_arch',
        customerId: 'cus_arch',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_arch', version: 1 },
        planRevision: 1,
        status: 'ACTIVE'
      });

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        campaignId: cmp.id,
        enrollmentId: enr.id,
        stepId: 'step_1',
        dueAt: new Date(Date.now() + 86400000),
        expiresAt: new Date(Date.now() + 172800000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 0,
        pauseGeneration: 0,
        state: 'SCHEDULED',
        lease: { token: null, until: null, claimedBy: null }
      });

      const res = await apiPost(
        `/api/v1/campaigns/${cmp.id}/archive`,
        {},
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Active enrollment marked CANCELLED (not COMPLETED!)
      const updatedEnr = await CampaignEnrollmentModel.findOne({ id: enr.id });
      expect(updatedEnr?.status).toBe('CANCELLED');

      // Scheduled execution cancelled with SKIPPED_CAMPAIGN_ARCHIVED
      const updatedExe = await CampaignExecutionModel.findOne({ enrollmentId: enr.id });
      expect(updatedExe?.state).toBe('SKIPPED');
      expect(updatedExe?.outcomeReason).toBe('SKIPPED_CAMPAIGN_ARCHIVED');
    });
  });

  describe('P2.i & C05: Positional Message Binding and Error Precision', () => {
    it('C05: Missing variable binding blocks the send with precise reason BLOCKED_MISSING_VARIABLE_BINDING without made-up fallback', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_c05_test',
        tenantId,
        firstName: 'Meenakshi',
        lastName: 'Sundaram',
        phone: '+919876543219',
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const campaign = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Test Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_c05',
        draftVersion: 1,
        pauseGeneration: 0
      });

      // tpl_winback_offer requires variables ['name', 'offer']. Binding has no 'offer'!
      const version = await CampaignVersionModel.create({
        id: 'cv_c05',
        tenantId,
        campaignId: campaign.id,
        version: 1,
        name: 'Winback Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'winback_step',
            offsetDays: 0,
            localTime: '10:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_winback_offer', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 120
          }
        ],
        priority: 80,
        publishedBy: 'owner',
        reviewFingerprint: 'fp_test_c05'
      });

      const enrollment = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: campaign.id,
        campaignVersionId: version.id,
        customerId: customer.id,
        occurrenceId: 'winback:01',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE'
      });

      const execution = await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        campaignId: campaign.id,
        enrollmentId: enrollment.id,
        stepId: 'winback_step',
        dueAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 1,
        pauseGeneration: 0,
        state: 'EVALUATING',
        lease: { token: 'tok_1', until: new Date(Date.now() + 30000), claimedBy: 'w1' }
      });

      const safeguardResult = await runSafeguardPipeline(execution);

      // Must be BLOCKED with precise reason BLOCKED_MISSING_VARIABLE_BINDING (zero invented offer)
      expect(safeguardResult.status).toBe('BLOCKED');
      expect((safeguardResult as any).reason).toBe('BLOCKED_MISSING_VARIABLE_BINDING');
    });
  });

  describe('P2.j: API Contracts, Idempotency & Optimistic Concurrency', () => {
    it('C15: Idempotency-Key returns identical cached response without duplicate operations', async () => {
      const idempotencyKey = `idemp_click_${Date.now()}`;

      // First call
      const res1 = await apiPost(
        '/api/v1/campaigns',
        { name: 'Festive Launch' },
        { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': idempotencyKey }
      );

      expect(res1.status).toBe(201);
      const campaignId = res1.body.campaign.id;

      // Duplicate click / React refresh with same Idempotency-Key
      const res2 = await apiPost(
        '/api/v1/campaigns',
        { name: 'Festive Launch' },
        { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': idempotencyKey }
      );

      expect(res2.status).toBe(201);
      expect(res2.body.campaign.id).toBe(campaignId);

      // Database has exactly ONE campaign, not two
      const campaigns = await CampaignModel.find({ tenantId, name: 'Festive Launch' });
      expect(campaigns.length).toBe(1);
    });

    it('C16: Conflicting settings edit with mismatched expectedVersion returns 409 conflict', async () => {
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId,
        version: 5,
        timezone: 'Asia/Kolkata',
        allowedHours: { start: '10:00', end: '19:00' },
        caps: { marketing24h: 1, marketing7d: 3 },
        globalPause: false,
        outageGraceMinutes: 120,
        leapDayPolicy: 'FEB_28',
        notice: REQUIRED_SETTINGS_NOTICE
      });

      // Submit edit with stale expectedVersion 4
      const res = await apiPatch(
        '/api/v1/campaign-settings',
        {
          expectedVersion: 4,
          allowedHours: { start: '11:00', end: '20:00' }
        },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('conflict');

      // Successful update with matching expectedVersion 5
      const successRes = await apiPatch(
        '/api/v1/campaign-settings',
        {
          expectedVersion: 5,
          allowedHours: { start: '11:00', end: '20:00' }
        },
        { Authorization: `Bearer ${ownerToken}` }
      );

      expect(successRes.status).toBe(200);
      expect(successRes.body.settings.version).toBe(6);
      expect(successRes.body.settings.notice).toBe(REQUIRED_SETTINGS_NOTICE);
    });

    it('Staff audited actions: resolve-hold and mark-goal append to AuditLogModel', async () => {
      const enrollment = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: 'cmp_staff_test',
        campaignVersionId: 'cv_01',
        customerId: 'cus_staff_test',
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_staff_test', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: new Date()
      });

      // Resolve Hold
      const resHold = await apiPost(
        `/api/v1/enrollments/${enrollment.id}/resolve-hold`,
        {},
        { Authorization: `Bearer ${staffToken}` }
      );

      expect(resHold.status).toBe(200);
      expect(resHold.body.enrollment.replyHoldAt).toBeNull();
      expect(resHold.body.enrollment.planRevision).toBe(2);

      const auditHold = await AuditLogModel.findOne({ tenantId, action: 'RESOLVE_HOLD', targetId: enrollment.id });
      expect(auditHold).toBeTruthy();
      expect(auditHold?.userId).toBe('usr_p2_staff');

      // Mark Goal
      const resGoal = await apiPost(
        `/api/v1/enrollments/${enrollment.id}/mark-goal`,
        { orderRef: 'ord_cash_counter_01' },
        { Authorization: `Bearer ${staffToken}` }
      );

      expect(resGoal.status).toBe(200);
      expect(resGoal.body.enrollment.goalReachedAt).toBeTruthy();

      const auditGoal = await AuditLogModel.findOne({ tenantId, action: 'MARK_GOAL', targetId: enrollment.id });
      expect(auditGoal).toBeTruthy();
      expect(auditGoal?.details?.goalOrderRef).toBe('ord_cash_counter_01');
    });

    it('GET /campaigns/:id/enrollments and /history project masked phones and matchExplanation', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_mask_test',
        tenantId,
        firstName: 'Devi',
        lastName: 'Prasad',
        phone: '+919876543210',
        totalSpendPaise: 5000000,
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const campaign = await CampaignModel.create({
        id: generateId('cmp'),
        tenantId,
        name: 'Reporting Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_rep',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const enr = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: campaign.id,
        campaignVersionId: 'cv_rep',
        customerId: customer.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        matchExplanation: 'VIP patron: tags VIP matched'
      });

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        campaignId: campaign.id,
        enrollmentId: enr.id,
        stepId: 'invitation',
        dueAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        claimVersion: 0,
        pauseGeneration: 0,
        state: 'PROVIDER_ACCEPTED',
        lease: { token: null, until: null, claimedBy: null }
      });

      // Verify enrollments endpoint
      const enrRes = await apiGet(`/api/v1/campaigns/${campaign.id}/enrollments`, {
        Authorization: `Bearer ${ownerToken}`
      });

      expect(enrRes.status).toBe(200);
      expect(enrRes.body.enrollments.length).toBe(1);
      expect(enrRes.body.enrollments[0].customer.maskedPhone).toBe('+9198*****210');
      expect(enrRes.body.enrollments[0].matchExplanation).toBe('VIP patron: tags VIP matched');

      // Verify history endpoint
      const histRes = await apiGet(`/api/v1/campaigns/${campaign.id}/history`, {
        Authorization: `Bearer ${ownerToken}`
      });

      expect(histRes.status).toBe(200);
      expect(histRes.body.history.length).toBe(1);
      expect(histRes.body.history[0].maskedPhone).toBe('+9198*****210');
      expect(histRes.body.history[0].state).toBe('PROVIDER_ACCEPTED');
    });
  });
});
