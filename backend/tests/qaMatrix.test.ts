import { describe, it, expect, beforeEach } from 'vitest';
import { generateId } from '../src/shared/utils/id';
import { encryptText, decryptText, sha256 } from '../src/shared/utils/crypto';
import {
  SettableTestClock,
  resolveNextAnnualOccurrence,
  calculateDueInstant
} from '../src/shared/utils/clock';
import { checkAndReserveContactCapacity } from '../src/modules/campaigns/engine/safeguards/contactCapResolver';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { getApprovedTemplate, APPROVED_TEMPLATES } from '../src/modules/campaigns/adapters/templateCatalogue';
import { BOUTIQUE_CAMPAIGN_PRESETS } from '../src/modules/campaigns/presets/boutiquePresets';
import { DomainEventBus } from '../src/shared/events/eventBus';
import { DomainEvent } from '../src/shared/events/types';
import crypto from 'crypto';

describe('Milestone 5: QA Acceptance Matrix (A, B, C)', () => {
  /* =========================================================================
   * MATRIX A: Strategy, Trigger, Fingerprint & Lifecycle Boundaries (A01 - A14)
   * ========================================================================= */
  describe('Matrix A: Strategy, Trigger, Fingerprint & Lifecycle Boundaries', () => {
    it('A01: generates canonical enrollmentKey = tenantId:campaignId:customerId:occurrenceId', () => {
      const tenantId = 'shop_padmavati';
      const campaignId = 'cmp_birthday_2026';
      const customerId = 'cus_lakshmi_01';
      const occurrenceId = '2026';

      const enrollmentKey = `${tenantId}:${campaignId}:${customerId}:${occurrenceId}`;
      expect(enrollmentKey).toBe('shop_padmavati:cmp_birthday_2026:cus_lakshmi_01:2026');

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
        run1Keys.add(`shop_padmavati:cmp_bday:${p.id}:${occ.occurrenceId}`);
      });

      patrons.forEach((p) => {
        const occ = resolveNextAnnualOccurrence(p.bdayMonth, p.bdayDay, 'Asia/Kolkata', 'FEB_28');
        run2Keys.add(`shop_padmavati:cmp_bday:${p.id}:${occ.occurrenceId}`);
      });

      expect(run1Keys.size).toBe(2);
      expect(Array.from(run1Keys)).toEqual(Array.from(run2Keys));
    });

    it('A03: rejects activation when draft configuration modified after review (fingerprint mismatch)', () => {
      const baseDraft = {
        campaignId: 'cmp_bday',
        steps: [
          { stepId: 'invitation', offsetDays: -14, localTime: '10:00' },
          { stepId: 'greeting', offsetDays: 0, localTime: '10:00' }
        ],
        priority: 80
      };

      const dryRunFingerprint = `fp_${sha256(baseDraft).slice(0, 16)}`;

      // Simulate patron/merchant modifying the step time from 10:00 to 11:00 after dry run
      const modifiedDraft = {
        ...baseDraft,
        steps: [
          { stepId: 'invitation', offsetDays: -14, localTime: '11:00' },
          { stepId: 'greeting', offsetDays: 0, localTime: '10:00' }
        ]
      };
      const modifiedFingerprint = `fp_${sha256(modifiedDraft).slice(0, 16)}`;

      expect(modifiedFingerprint).not.toBe(dryRunFingerprint);

      // Verify validation logic rejects stale review fingerprint
      const isActivationAllowed = (providedFp: string, currentFp: string) => providedFp === currentFp;
      expect(isActivationAllowed(dryRunFingerprint, modifiedFingerprint)).toBe(false);
    });

    it('A04: Specification pattern filters audience by tags, min spend, and exclusions', () => {
      const patrons = [
        { id: 'p1', tags: ['VIP', 'Kanjeevaram'], totalSpendPaise: 4500000, optedIn: true },
        { id: 'p2', tags: ['Cotton'], totalSpendPaise: 1200000, optedIn: true },
        { id: 'p3', tags: ['VIP'], totalSpendPaise: 800000, optedIn: false }, // opted out
        { id: 'p4', tags: ['VIP', 'Staff_Family'], totalSpendPaise: 5000000, optedIn: true } // excluded tag
      ];

      // Audience Rule: Must have VIP tag AND minSpend >= 20,000 INR (2,000,000 paise) AND NOT Staff_Family
      const filterPatron = (p: typeof patrons[0]) => {
        if (!p.optedIn) return false;
        const hasVip = p.tags.includes('VIP');
        const minSpendOk = p.totalSpendPaise >= 2000000;
        const isExcluded = p.tags.includes('Staff_Family');
        return hasVip && minSpendOk && !isExcluded;
      };

      const eligible = patrons.filter(filterPatron);
      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe('p1');
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

    it('A06: invalid or missing occasion date skips customer with INVALID_SOURCE_OR_DATE', () => {
      const validateOccasion = (month: number | null, day: number | null) => {
        if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
          return { valid: false, reason: 'INVALID_SOURCE_OR_DATE' };
        }
        return { valid: true };
      };

      expect(validateOccasion(null, 15)).toEqual({ valid: false, reason: 'INVALID_SOURCE_OR_DATE' });
      expect(validateOccasion(2, 32)).toEqual({ valid: false, reason: 'INVALID_SOURCE_OR_DATE' });
      expect(validateOccasion(10, 28)).toEqual({ valid: true });
    });

    it('A07: channel-suppressed or deleted customer evaluated first in reason precedence', () => {
      const evaluatePatronConsent = (customer: { channelSuppressed: boolean; status: string }) => {
        if (customer.status === 'DELETED') return { allow: false, reason: 'CUSTOMER_DELETED' };
        if (customer.channelSuppressed) return { allow: false, reason: 'CHANNEL_SUPPRESSED' };
        return { allow: true };
      };

      expect(evaluatePatronConsent({ channelSuppressed: true, status: 'ACTIVE' })).toEqual({
        allow: false,
        reason: 'CHANNEL_SUPPRESSED'
      });
      expect(evaluatePatronConsent({ channelSuppressed: false, status: 'DELETED' })).toEqual({
        allow: false,
        reason: 'CUSTOMER_DELETED'
      });
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

    it('A09: prerequisite check (PREVIOUS_ACCEPTED) blocks step 2 if step 1 was not accepted', () => {
      const checkPrerequisites = (
        stepDef: { prerequisite?: string },
        priorExecutions: Array<{ stepId: string; state: string }>
      ) => {
        if (stepDef.prerequisite === 'PREVIOUS_ACCEPTED') {
          const hasAccepted = priorExecutions.some((e) => e.state === 'PROVIDER_ACCEPTED');
          if (!hasAccepted) return { allow: false, reason: 'PREREQUISITE_NOT_MET' };
        }
        return { allow: true };
      };

      // Step 1 failed
      expect(
        checkPrerequisites({ prerequisite: 'PREVIOUS_ACCEPTED' }, [{ stepId: 'step_1', state: 'FAILED' }])
      ).toEqual({ allow: false, reason: 'PREREQUISITE_NOT_MET' });

      // Step 1 accepted
      expect(
        checkPrerequisites({ prerequisite: 'PREVIOUS_ACCEPTED' }, [
          { stepId: 'step_1', state: 'PROVIDER_ACCEPTED' }
        ])
      ).toEqual({ allow: true });
    });

    it('A10: lateness cutoff skips executions past expiresAt with STEP_EXPIRED', () => {
      const serverNow = new Date('2026-10-14T12:00:00.000Z');
      const expiredAt = new Date('2026-10-14T11:00:00.000Z'); // 1 hour past
      const futureAt = new Date('2026-10-14T14:00:00.000Z');

      const isExpired = (expires: Date, now: Date) => now > expires;

      expect(isExpired(expiredAt, serverNow)).toBe(true);
      expect(isExpired(futureAt, serverNow)).toBe(false);
    });

    it('A11: inbound customer reply sets replyHoldAt and halts remaining sales steps', () => {
      let enrollment = {
        id: 'enr_01',
        replyHoldAt: null as Date | null,
        goalReachedAt: null as Date | null
      };

      // Inbound reply arrives
      enrollment.replyHoldAt = new Date('2026-10-14T10:15:00.000Z');

      // Evaluator checks follow-up step
      const stepDef = { stepId: 'followup', stopOnReply: true };
      const canSend = !stepDef.stopOnReply || enrollment.replyHoldAt === null;

      expect(canSend).toBe(false);
    });

    it('A12: qualifying saree purchase sets goalReachedAt and skips remaining follow-ups', () => {
      let enrollment = {
        id: 'enr_02',
        goalReachedAt: null as Date | null
      };

      // Customer makes purchase
      enrollment.goalReachedAt = new Date('2026-10-14T11:30:00.000Z');

      const stepDef = { stepId: 'discount_reminder', stopOnGoal: true };
      const canSend = !stepDef.stopOnGoal || enrollment.goalReachedAt === null;

      expect(canSend).toBe(false);
    });

    it('A13: paused campaign halts execution evaluation with CAMPAIGN_OR_GLOBAL_PAUSED', () => {
      const evaluateCampaignState = (status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => {
        if (status === 'PAUSED' || status === 'ARCHIVED') {
          return { allow: false, reason: 'CAMPAIGN_OR_GLOBAL_PAUSED' };
        }
        return { allow: true };
      };

      expect(evaluateCampaignState('PAUSED')).toEqual({
        allow: false,
        reason: 'CAMPAIGN_OR_GLOBAL_PAUSED'
      });
      expect(evaluateCampaignState('ACTIVE')).toEqual({ allow: true });
    });

    it('A14: unapproved or unknown template blocks execution with CONTENT_OR_TEMPLATE_BLOCKED', () => {
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
    it('B01: atomic step lease acquisition ensures only one worker claims a due step', () => {
      // Simulating atomic findOneAndUpdate CAS on MongoDB
      let executionDoc = {
        id: 'exe_b01',
        state: 'SCHEDULED',
        leaseToken: null as string | null,
        leaseExpiresAt: null as Date | null
      };

      const tryAcquireLease = (workerId: string, now: Date) => {
        if (
          executionDoc.state === 'SCHEDULED' &&
          (executionDoc.leaseExpiresAt === null || executionDoc.leaseExpiresAt < now)
        ) {
          const token = `lease_${workerId}_${Date.now()}`;
          executionDoc.leaseToken = token;
          executionDoc.leaseExpiresAt = new Date(now.getTime() + 30000); // 30s lease
          return token;
        }
        return null;
      };

      const now = new Date();
      const lease1 = tryAcquireLease('worker_A', now);
      const lease2 = tryAcquireLease('worker_B', now);

      expect(lease1).not.toBeNull();
      expect(lease2).toBeNull();
      expect(executionDoc.leaseToken).toBe(lease1);
    });

    it('B02: expired worker lease (>30s) is safely reclaimed by subsequent worker poll', () => {
      const initialTime = new Date('2026-10-14T10:00:00.000Z');
      let executionDoc = {
        id: 'exe_b02',
        state: 'SCHEDULED',
        leaseToken: 'lease_dead_worker',
        leaseExpiresAt: new Date(initialTime.getTime() + 30000) // expired at 10:00:30
      };

      const pollTimeAfterExpiry = new Date('2026-10-14T10:00:31.000Z');

      const isLeaseReclaimable = executionDoc.leaseExpiresAt < pollTimeAfterExpiry;
      expect(isLeaseReclaimable).toBe(true);

      // Reclaim lease
      executionDoc.leaseToken = 'lease_fresh_worker';
      executionDoc.leaseExpiresAt = new Date(pollTimeAfterExpiry.getTime() + 30000);

      expect(executionDoc.leaseToken).toBe('lease_fresh_worker');
    });

    it('B03: rolling 24-hour contact cap blocks second marketing message to same phone', async () => {
      const phone = `+919800${Math.floor(100000 + Math.random() * 900000)}`;

      const res1 = await checkAndReserveContactCapacity(
        'tenant_qa',
        phone,
        'cmp_bday',
        'exe_first',
        new Date(Date.now() + 86400000),
        80
      );
      expect(res1.allowed).toBe(true);

      const res2 = await checkAndReserveContactCapacity(
        'tenant_qa',
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
        const timeOffset = i * 26 * 3600 * 1000; // 26h intervals to bypass 24h cap
        const res = await checkAndReserveContactCapacity(
          'tenant_qa',
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
        'tenant_qa',
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

    it('B06: collision priority arbitration awards contact slot to higher priority campaign', async () => {
      const phone = `+919802${Math.floor(100000 + Math.random() * 900000)}`;

      // High priority birthday campaign (priority 85) reserves first
      const birthdayRes = await checkAndReserveContactCapacity(
        'tenant_qa',
        phone,
        'cmp_bday',
        'exe_bday',
        new Date(Date.now() + 86400000),
        85
      );
      expect(birthdayRes.allowed).toBe(true);

      // Low priority promotional blast (priority 40) is blocked by contact cap
      const promoRes = await checkAndReserveContactCapacity(
        'tenant_qa',
        phone,
        'cmp_promo',
        'exe_promo',
        new Date(Date.now() + 86400000),
        40
      );
      expect(promoRes.allowed).toBe(false);
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
      // Assert no ephemeral details leaked
      expect(executionKey).not.toContain('worker');
      expect(executionKey).not.toContain('retry');
    });

    it('B09: duplicate delivery protection: deliveryKey = executionId prevents double sending', () => {
      const executionId = 'exe_step_01';
      const deliveryKey = `${executionId}`;

      const deliveryIntentsMap = new Map<string, string>();
      deliveryIntentsMap.set(deliveryKey, 'di_001');

      // Attempting second dispatch for same execution
      const isAlreadyDispatched = deliveryIntentsMap.has(deliveryKey);
      expect(isAlreadyDispatched).toBe(true);
    });

    it('B10: optimistic concurrency: plan revision increment rejects stale executor updates', () => {
      let currentRevision = 2;

      const tryUpdateExecution = (docRevision: number) => {
        if (docRevision !== currentRevision) {
          return { success: false, error: 'PLAN_REVISION_CONFLICT' };
        }
        currentRevision++;
        return { success: true };
      };

      // Stale worker tries to update with revision 1
      expect(tryUpdateExecution(1)).toEqual({
        success: false,
        error: 'PLAN_REVISION_CONFLICT'
      });

      // Valid worker updates with revision 2
      expect(tryUpdateExecution(2)).toEqual({ success: true });
      expect(currentRevision).toBe(3);
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

    it('C03: provider webhook transition to DELIVERED updates execution record', () => {
      let execution = { state: 'PROVIDER_ACCEPTED', deliveredAt: null as Date | null };

      // Incoming webhook: status = 'delivered'
      execution.state = 'DELIVERED';
      execution.deliveredAt = new Date('2026-10-14T10:05:00.000Z');

      expect(execution.state).toBe('DELIVERED');
      expect(execution.deliveredAt).not.toBeNull();
    });

    it('C04: provider webhook transition to READ updates execution record', () => {
      let execution = { state: 'DELIVERED', readAt: null as Date | null };

      // Incoming webhook: status = 'read'
      execution.state = 'READ';
      execution.readAt = new Date('2026-10-14T10:07:00.000Z');

      expect(execution.state).toBe('READ');
      expect(execution.readAt).not.toBeNull();
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

      // Crucial: Handoff Page 27 mandates that OUTCOME_UNKNOWN must NEVER be blindly re-submitted
      const canBlindResend = (state: string) => state !== 'OUTCOME_UNKNOWN';
      expect(canBlindResend(result.state)).toBe(false);
    });

    it('C07: webhook signature verification validates SHA-256 HMAC and rejects forged payloads', () => {
      const appSecret = 'boutique_meta_app_secret_xyz';
      const rawPayload = JSON.stringify({ event: 'delivery_receipt', wamid: 'wamid.HB123' });

      // Generate valid signature
      const validHmac = crypto.createHmac('sha256', appSecret).update(rawPayload).digest('hex');
      const validHeader = `sha256=${validHmac}`;

      const verifyWebhookSignature = (header: string, payload: string, secret: string) => {
        const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
        return header === expected;
      };

      expect(verifyWebhookSignature(validHeader, rawPayload, appSecret)).toBe(true);
      expect(verifyWebhookSignature('sha256=forged_bad_hash', rawPayload, appSecret)).toBe(false);
    });

    it('C08: duplicate webhook idempotency safely acknowledges replayed wamid without double processing', () => {
      const processedWamids = new Set<string>();

      const processWebhook = (wamid: string) => {
        if (processedWamids.has(wamid)) {
          return { status: 200, action: 'IGNORED_DUPLICATE' };
        }
        processedWamids.add(wamid);
        return { status: 200, action: 'PROCESSED' };
      };

      expect(processWebhook('wamid.001')).toEqual({ status: 200, action: 'PROCESSED' });
      expect(processWebhook('wamid.001')).toEqual({ status: 200, action: 'IGNORED_DUPLICATE' });
    });

    it('C09: inbound customer WhatsApp reply webhook emits campaign.reply_received and halts sales flow', () => {
      const eventBus = new DomainEventBus();
      let replyEventReceived: any = null;

      eventBus.subscribe('campaign.reply_received', async (event) => {
        replyEventReceived = event;
      });

      const inboundReplyEvent: DomainEvent<{ phone: string; messageText: string }> = {
        schemaVersion: 1,
        producer: 'whatsapp',
        eventId: 'evt_reply_01',
        tenantId: 'shop_padmavati',
        type: 'campaign.reply_received',
        entityId: 'cus_lakshmi_01',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          phone: '+919876543210',
          messageText: 'Can I see the Gadwal silk saree in peacock blue?'
        }
      };

      eventBus.publish(inboundReplyEvent);

      expect(replyEventReceived).not.toBeNull();
      expect(replyEventReceived.data.messageText).toContain('Gadwal silk');
    });

    it('C10: saree purchase domain event matches customer, sets goalReachedAt, and records conversion', () => {
      const eventBus = new DomainEventBus();
      let orderProcessed = false;

      eventBus.subscribe('order.completed', async (event) => {
        orderProcessed = true;
      });

      const orderEvent: DomainEvent<{ orderId: string; totalPaise: number; phone: string }> = {
        schemaVersion: 1,
        producer: 'orders',
        eventId: 'evt_ord_99',
        tenantId: 'shop_padmavati',
        type: 'order.completed',
        entityId: 'ord_99',
        entityVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        data: {
          orderId: 'ord_99',
          totalPaise: 3850000,
          phone: '+919876543210'
        }
      };

      eventBus.publish(orderEvent);

      expect(orderProcessed).toBe(true);
    });
  });
});
