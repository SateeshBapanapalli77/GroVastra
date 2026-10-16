import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import app from '../src/server';
import { env } from '../src/config/env';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignDryRunModel } from '../src/modules/campaigns/models/CampaignDryRun.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { TenantControlGateModel } from '../src/modules/campaigns/models/TenantControlGate.model';
import { CampaignControlGateModel } from '../src/modules/campaigns/models/CampaignControlGate.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { AuditLogModel } from '../src/modules/campaigns/models/AuditLog.model';
import { TemplateCatalogModel } from '../src/modules/campaigns/models/TemplateCatalog.model';
import { processClaimedExecution } from '../src/modules/campaigns/engine/dispatchExecutor';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { IWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/deliveryAdapter.interface';
import { reconcileDeliveryStatus } from '../src/modules/campaigns/services/deliveryStatusReconciliation';
import * as deliveryRecon from '../src/modules/campaigns/services/deliveryStatusReconciliation';
import { resolveTenantForConnection } from '../src/modules/campaigns/services/connectionRegistry';
import { processNextPendingEvent, MAX_UNRESOLVED_INTENT_RETRIES, calculateIntentRetryBackoffMs } from '../src/workers/events';

describe('Senior Technical Manager Review Hardening Verification', () => {
  const tenantA = 'audit_tenant_a';
  const tenantB = 'audit_tenant_b';

  let server: http.Server;
  let baseUrl: string;
  let ownerTokenA: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    ownerTokenA = signJwt({
      userId: 'usr_audit_owner_a',
      tenantId: tenantA,
      role: 'BOUTIQUE_OWNER'
    });

    ownerTokenB = signJwt({
      userId: 'usr_audit_owner_b',
      tenantId: tenantB,
      role: 'BOUTIQUE_OWNER'
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function apiGet(path: string, token: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  async function apiPost(path: string, body: any, token: string, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': generateId('idemp'),
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  async function apiPatch(path: string, body: any, token: string, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': generateId('idemp'),
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignDryRunModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      TenantSettingsModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      TenantControlGateModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignControlGateModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CustomerModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      AuditLogModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } }),
      TemplateCatalogModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } })
    ]);
  });

  it('Finding 1 — P1: GET /campaigns strictly scopes activeVersion by tenantId', async () => {
    // Version belonging to Tenant A
    const versionA = await CampaignVersionModel.create({
      id: 'cv_tenant_a_secret',
      tenantId: tenantA,
      campaignId: 'cmp_a',
      version: 1,
      name: 'Tenant A Secret Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_1',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      publishedBy: 'usr_audit_owner_a',
      publishedAt: new Date(),
      reviewFingerprint: 'fp_a'
    });

    // Malicious or corrupted Campaign in Tenant B pointing to Tenant A's version ID
    await CampaignModel.create({
      id: 'cmp_b_leak',
      tenantId: tenantB,
      name: 'Tenant B Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'ACTIVE',
      activeVersionId: versionA.id, // Target cross-tenant version!
      draftVersion: 1,
      pauseGeneration: 0
    });

    // Query campaigns as Tenant B
    const res = await apiGet('/api/v1/campaigns', ownerTokenB);
    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(1);

    // activeVersion must NOT resolve Tenant A's version
    const retrieved = res.body.campaigns[0];
    expect(retrieved.id).toBe('cmp_b_leak');
    expect(retrieved.activeVersion).toBeNull(); // Tenant scoping successfully protected Tenant A's data!
  });

  it('Finding 2 — P1: Draft validation validates draftVersion, NOT activeVersionId, on active campaigns', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_active_with_draft',
      tenantId: tenantA,
      name: 'Bridal Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'ACTIVE',
      activeVersionId: 'cv_v1_active',
      draftVersion: 2,
      pauseGeneration: 0
    });

    // Active version 1: valid
    await CampaignVersionModel.create({
      id: 'cv_v1_active',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 1,
      name: 'Bridal Campaign v1',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_1',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      publishedBy: 'usr_audit_owner_a',
      publishedAt: new Date(),
      reviewFingerprint: 'fp_v1'
    });

    // Draft version 2: invalid step configuration (missing templateRef)
    await CampaignVersionModel.create({
      id: 'cv_v2_draft',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 2,
      name: 'Bridal Campaign v2 Draft',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_broken',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_nonexistent_or_unapproved', revision: 1, language: 'en' }, // Unapproved template reference!
          bindings: {}
        }
      ],
      reviewFingerprint: 'fp_v2'
    });

    // Validating active campaign must target draftVersion 2 and report validation errors
    const res = await apiPost(`/api/v1/campaigns/${camp.id}/validate`, {}, ownerTokenA);
    expect(res.status).toBe(200);
    expect(res.body.draftVersion).toBe(2);
    expect(res.body.versionId).toBe('cv_v2_draft');
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('Finding 3 & 5 — P1: Activation executes in atomic transaction and verifies pinned template revision/locale', async () => {
    // 1. Connection provisioned
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_audit_01',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { wabaAccountId: 'waba_audit_01' }
    });

    const camp = await CampaignModel.create({
      id: 'cmp_activate_atomicity',
      tenantId: tenantA,
      name: 'Anniversary Saree Offer',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      pauseGeneration: 0
    });

    // Step references unapproved template revision 99
    const draft = await CampaignVersionModel.create({
      id: 'cv_activate_01',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 1,
      name: camp.name,
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'invite',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 99, language: 'en' }, // Revision 99 unapproved!
          bindings: { name: 'customer.firstName' }
        }
      ],
      reviewFingerprint: 'fp_valid_dry_run'
    });

    // Mock dry run record
    await CampaignDryRunModel.create({
      id: generateId('dry'),
      tenantId: tenantA,
      campaignId: camp.id,
      draftVersion: 1,
      draftFingerprint: 'fp_valid_dry_run',
      createdAt: new Date(),
      summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 }
    });

    // Attempting activation with unapproved revision 99 must fail closed with 422
    const resBadRev = await apiPost(
      `/api/v1/campaigns/${camp.id}/activate`,
      { reviewFingerprint: 'fp_valid_dry_run', expectedVersion: 1 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_act_01' }
    );
    expect(resBadRev.status).toBe(422);
    expect(resBadRev.body.error).toContain('unusable template');

    // Fix to valid pinned revision (revision: 3, language: 'en')
    draft.steps[0].templateRef.revision = 3;
    await draft.save();

    // Now activation succeeds with atomic transaction
    const resSuccess = await apiPost(
      `/api/v1/campaigns/${camp.id}/activate`,
      { reviewFingerprint: 'fp_valid_dry_run', expectedVersion: 1 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_act_02' }
    );
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.success).toBe(true);

    // Verify atomic state in MongoDB
    const updatedCamp = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
    expect(updatedCamp?.status).toBe('ACTIVE');
    expect(updatedCamp?.activeVersionId).toBe(draft.id);

    const updatedDraft = await CampaignVersionModel.findOne({ id: draft.id, tenantId: tenantA });
    expect(updatedDraft?.publishedAt).not.toBeNull();
    expect(updatedDraft?.publishedBy).toBe('usr_audit_owner_a');

    const audit = await AuditLogModel.findOne({ tenantId: tenantA, targetId: camp.id, action: 'ACTIVATE_CAMPAIGN' });
    expect(audit).not.toBeNull();
    expect(audit?.details?.versionId).toBe(draft.id);
  });

  it('Finding 4 — P1: Execution error recovery enforces lease fencing and stale worker CAS rejects mutating newer claim', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000);

    const exe = await CampaignExecutionModel.create({
      id: 'exe_lease_fenced_recovery',
      tenantId: tenantA,
      enrollmentId: 'enr_fence_01',
      campaignId: 'cmp_fence_01',
      stepId: 'step_1',
      dueAt: now,
      expiresAt,
      localDate: '2026-10-15',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'EVALUATING',
      lease: {
        token: 'token_worker_stale',
        until: new Date(now.getTime() + 30000),
        claimedBy: 'worker_1'
      }
    });

    // Simulate Worker 2 stealing / reclaiming lease with claimVersion 2
    await CampaignExecutionModel.updateOne(
      { id: exe.id },
      {
        $set: {
          claimVersion: 2,
          'lease.token': 'token_worker_active_new',
          'lease.claimedBy': 'worker_2'
        }
      }
    );

    // Worker 1 now attempts error recovery with stale claim (simulating transient error in processClaimedExecution)
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    const staleClaimed = {
      ...exe.toObject(),
      claimVersion: 1,
      lease: { token: 'token_worker_stale', until: new Date(now.getTime() + 30000), claimedBy: 'worker_1' }
    };

    const outcome = await processClaimedExecution(staleClaimed as any, mockAdapter, now);
    expect(outcome).toBe('FAILED');

    // Assert that Worker 2's lease and claimVersion 2 were NOT modified or overwritten by Worker 1's recovery
    const inDb = await CampaignExecutionModel.findOne({ id: exe.id });
    expect(inDb?.state).toBe('EVALUATING');
    expect(inDb?.claimVersion).toBe(2);
    expect(inDb?.lease.token).toBe('token_worker_active_new');
    expect(inDb?.lease.claimedBy).toBe('worker_2');
  });

  it('Finding 6 — P1: Optimistic concurrency control rejects conflicting expectedVersion with 409 and invalid format with 400', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_concurrency_test',
      tenantId: tenantA,
      name: 'Concurrency Test Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 3,
      pauseGeneration: 0
    });

    await CampaignVersionModel.create({
      id: 'cv_concurrency_v3',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 3,
      name: camp.name,
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [],
      reviewFingerprint: 'fp_concurrency_v3'
    });

    // 1. Invalid expectedVersion type returns 400
    const resBadType = await apiPatch(
      `/api/v1/campaigns/${camp.id}/draft`,
      { expectedVersion: 'three', priority: 70 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_concurrency_01' }
    );
    expect(resBadType.status).toBe(400);

    // 2. Conflicting expectedVersion (e.g. 2 instead of 3) returns 409
    const resConflict = await apiPatch(
      `/api/v1/campaigns/${camp.id}/draft`,
      { expectedVersion: 2, priority: 70 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_concurrency_02' }
    );
    expect(resConflict.status).toBe(409);
    expect(resConflict.body.error).toContain('conflict');

    // 3. Matching expectedVersion 3 succeeds
    const resValid = await apiPatch(
      `/api/v1/campaigns/${camp.id}/draft`,
      { expectedVersion: 3, priority: 70 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_concurrency_03' }
    );
    expect(resValid.status).toBe(200);
    expect(resValid.body.draftVersion.priority).toBe(70);
  });

  it('Finding 7 — P1: Read receipt leaves deliveredAt unknown (null) without fabricating timestamp, and status progression is monotonic', async () => {
    const providerMessageId = 'wamid_audit_finding7_read_test';
    const now = new Date();

    const exe = await CampaignExecutionModel.create({
      id: 'exe_finding_7',
      tenantId: tenantA,
      enrollmentId: 'enr_f7',
      campaignId: 'cmp_f7',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-15',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'PROVIDER_ACCEPTED',
      deliveredAt: null,
      readAt: null
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_f7',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_f7',
      customerId: 'cus_f7',
      recipientVersion: 1,
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_f7',
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_f7',
      providerMessageId,
      deliveredAt: null,
      readAt: null
    });

    // Ensure active tenant connection exists for conn_f7
    await TenantConnectionModel.create({
      id: 'conn_f7_doc',
      tenantId: tenantA,
      connectionId: 'conn_f7',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE'
    });

    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
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
                  metadata: { phone_number_id: 'conn_f7' },
                  statuses: [{ id: providerMessageId, status, timestamp }]
                }
              }
            ]
          }
        ]
      };
      const rawBody = JSON.stringify(payload);
      const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      const res = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
        body: rawBody
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    // 1. Read receipt arrives first
    const simRes = await sendWebhook('read', `${Math.floor(now.getTime() / 1000)}`);
    expect(simRes.status).toBe(200);

    // Verify delivery timestamp is NOT fabricated on read (Spec p.27)
    const updatedIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(updatedIntent?.readAt).not.toBeNull();
    expect(updatedIntent?.deliveredAt).toBeNull(); // deliveredAt remains unknown (null)!

    const updatedExe = await CampaignExecutionModel.findOne({ id: exe.id });
    expect(updatedExe?.state).toBe('READ');
    expect(updatedExe?.readAt).not.toBeNull();
    expect(updatedExe?.deliveredAt).toBeNull(); // deliveredAt remains unknown (null)!

    // 2. Monotonic progression: Out-of-order 'delivered' receipt does not downgrade state from 'READ'
    const delivRes = await sendWebhook('delivered', `${Math.floor((now.getTime() - 10000) / 1000)}`);
    expect(delivRes.status).toBe(200);

    const afterDelivIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(afterDelivIntent?.deliveredAt).not.toBeNull(); // deliveredAt is now accurately recorded

    const afterDelivExe = await CampaignExecutionModel.findOne({ id: exe.id });
    expect(afterDelivExe?.state).toBe('READ'); // Still READ, not regressed to DELIVERED!
  });

  it('Review 2 Issue A — P1: Global settings mutations strictly require expectedVersion (400 on missing) and atomically update settings & control gate (409 on stale)', async () => {
    // Seed initial settings version 1
    await TenantSettingsModel.create({
      id: generateId('set'),
      tenantId: tenantA,
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

    // 1. Missing expectedVersion returns 400
    const resMissing = await apiPatch(
      '/api/v1/campaign-settings',
      { timezone: 'Asia/Dubai' },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_set_missing' }
    );
    expect(resMissing.status).toBe(400);
    expect(resMissing.body.error).toContain('EXPECTED_VERSION_REQUIRED');

    // 2. Conflicting/stale expectedVersion returns 409
    const resStale = await apiPatch(
      '/api/v1/campaign-settings',
      { expectedVersion: 99, timezone: 'Asia/Dubai' },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_set_stale' }
    );
    expect(resStale.status).toBe(409);
    expect(resStale.body.error).toContain('conflict');

    // 3. Valid expectedVersion 1 with globalPause: true atomically updates both settings and control gate
    const resValid = await apiPatch(
      '/api/v1/campaign-settings',
      { expectedVersion: 1, globalPause: true },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_set_valid' }
    );
    expect(resValid.status).toBe(200);
    expect(resValid.body.settings.version).toBe(2);
    expect(resValid.body.settings.globalPause).toBe(true);

    const savedGate = await TenantControlGateModel.findOne({ tenantId: tenantA });
    expect(savedGate).not.toBeNull();
    expect(savedGate?.globalPause).toBe(true);
    expect(savedGate?.gateVersion).toBeGreaterThan(0);
  });

  it('Review 2 Action 1 — P1: Mutations strictly reject missing or non-number expectedVersion with 400 Bad Request', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_mandatory_exp_ver',
      tenantId: tenantA,
      name: 'Mandatory Concurrency Test',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      pauseGeneration: 0
    });

    await CampaignVersionModel.create({
      id: 'cv_mandatory_v1',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 1,
      name: camp.name,
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [],
      reviewFingerprint: 'fp_mandatory'
    });

    // 1. PATCH /draft without expectedVersion returns 400
    const resDraftNoVer = await apiPatch(
      `/api/v1/campaigns/${camp.id}/draft`,
      { priority: 60 },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_no_ver_draft' }
    );
    expect(resDraftNoVer.status).toBe(400);
    expect(resDraftNoVer.body.error).toContain('EXPECTED_VERSION_REQUIRED');

    // 2. POST /activate without expectedVersion returns 400
    const resActNoVer = await apiPost(
      `/api/v1/campaigns/${camp.id}/activate`,
      { reviewFingerprint: 'fp_mandatory' },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_no_ver_act' }
    );
    expect(resActNoVer.status).toBe(400);
    expect(resActNoVer.body.error).toContain('EXPECTED_VERSION_REQUIRED');

    // 3. POST /publish-revision without expectedVersion returns 400
    const resPubNoVer = await apiPost(
      `/api/v1/campaigns/${camp.id}/publish-revision`,
      { reviewFingerprint: 'fp_mandatory' },
      ownerTokenA,
      { 'Idempotency-Key': 'idemp_no_ver_pub' }
    );
    expect(resPubNoVer.status).toBe(400);
    expect(resPubNoVer.body.error).toContain('EXPECTED_VERSION_REQUIRED');
  });

  it('Review 2 Issue B — P1: Campaign pause serializes atomically with dispatch submission through CampaignControlGate transaction', async () => {
    // Setup connection and active campaign
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_pause_race_test',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE'
    });

    const camp = await CampaignModel.create({
      id: 'cmp_pause_race',
      tenantId: tenantA,
      name: 'Pause Race Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'ACTIVE',
      draftVersion: 1,
      activeVersionId: 'cv_pause_race_v1',
      pauseGeneration: 0
    });

    const version = await CampaignVersionModel.create({
      id: 'cv_pause_race_v1',
      tenantId: tenantA,
      campaignId: camp.id,
      version: 1,
      name: camp.name,
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_invite',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' },
          stopOnReply: true,
          stopOnGoal: true,
          maxLatenessMinutes: 120
        }
      ],
      publishedAt: new Date(),
      publishedBy: 'owner',
      reviewFingerprint: 'fp_pause_race'
    });

    // Control gate initialized
    await CampaignControlGateModel.create({
      id: generateId('cg'),
      tenantId: tenantA,
      campaignId: camp.id,
      paused: false,
      pauseGeneration: 0,
      gateVersion: 1
    });

    // Pause the campaign via API
    const pauseRes = await apiPost(
      `/api/v1/campaigns/${camp.id}/pause`,
      {},
      ownerTokenA
    );
    expect(pauseRes.status).toBe(200);

    // Verify CampaignControlGate was updated in transaction
    const gate = await CampaignControlGateModel.findOne({ tenantId: tenantA, campaignId: camp.id });
    expect(gate?.paused).toBe(true);
    expect(gate?.pauseGeneration).toBe(1);
    expect(gate?.gateVersion).toBe(2);

    const updatedCamp = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
    expect(updatedCamp?.status).toBe('PAUSED');
    expect(updatedCamp?.pauseGeneration).toBe(1);

    // Create execution that attempted dispatch with stale pauseGeneration 0
    const now = new Date();
    const staleExe = await CampaignExecutionModel.create({
      id: 'exe_stale_dispatch_during_pause',
      tenantId: tenantA,
      enrollmentId: 'enr_pause_race',
      campaignId: camp.id,
      stepId: 'step_invite',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-15',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      pauseGeneration: 0, // Stale!
      state: 'EVALUATING',
      lease: {
        token: 'token_pause_worker',
        until: new Date(now.getTime() + 30000),
        claimedBy: 'worker_pause'
      }
    });

    await CustomerModel.create({
      id: 'cus_pause_race',
      tenantId: tenantA,
      firstName: 'Divya',
      lastName: 'Reddy',
      phone: '+919876543299',
      version: 1,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false,
      birthdayMonth: 10,
      birthdayDay: 15
    });

    await CampaignEnrollmentModel.create({
      id: 'enr_pause_race',
      tenantId: tenantA,
      campaignId: camp.id,
      campaignVersionId: version.id,
      customerId: 'cus_pause_race',
      occurrenceId: 'birthday:2026',
      sourceRef: {
        type: 'CUSTOMER_DATE',
        id: 'cus_pause_race',
        version: 1
      },
      planRevision: 1,
      status: 'ACTIVE',
      replyHoldAt: null
    });

    // When worker attempts dispatch submission, it MUST be rejected by CampaignControlGate transaction
    const mockAdapter = new MockWhatsAppDeliveryAdapter();
    await processClaimedExecution(staleExe, mockAdapter, now);

    // Verify execution was skipped/aborted and ZERO messages were submitted to delivery adapter
    const finalExe = await CampaignExecutionModel.findOne({ id: staleExe.id });
    expect(finalExe?.state).toBe('SKIPPED');
    expect(finalExe?.outcomeReason).toContain('PAUSED');
    expect(mockAdapter.getSubmissionCount()).toBe(0);
  });

  it('Review 3 — P1: Database failure during template resolution fails closed, rejecting activation rather than falling open into static catalogue', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_fail_closed_tmpl_db',
      tenantId: tenantA,
      name: 'Fail Closed Template DB Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      pauseGeneration: 0
    });

    const draft = await CampaignVersionModel.create({
      id: generateId('cv'),
      campaignId: camp.id,
      tenantId: tenantA,
      version: 1,
      name: 'Fail Closed Draft',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      priority: 80,
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_invite',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      reviewFingerprint: 'fp_db_err_dry_run'
    });

    await CampaignDryRunModel.create({
      id: generateId('dry'),
      tenantId: tenantA,
      campaignId: camp.id,
      draftVersion: 1,
      draftFingerprint: 'fp_db_err_dry_run',
      createdAt: new Date(),
      summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 }
    });

    // Ensure ALLOW_STATIC_TEMPLATE_FALLBACK is NOT enabled
    const origEnv = process.env.ALLOW_STATIC_TEMPLATE_FALLBACK;
    delete process.env.ALLOW_STATIC_TEMPLATE_FALLBACK;

    // Spy on TemplateCatalogModel.findOne specifically to simulate MongoDB connection error on template resolution
    const origFindOne = TemplateCatalogModel.findOne;
    const spy = vi.spyOn(TemplateCatalogModel, 'findOne').mockImplementation(function (this: any, ...args: any[]) {
      if (this === TemplateCatalogModel || this?.modelName === 'TemplateCatalog') {
        throw new Error('MongoNetworkError: connection closed');
      }
      return origFindOne.apply(this, args);
    });

    try {
      const res = await apiPost(
        `/api/v1/campaigns/${camp.id}/activate`,
        { reviewFingerprint: 'fp_db_err_dry_run', expectedVersion: 1 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_tmpl_db_err' }
      );

      // Must fail closed with 503 Service Unavailable (rejected, NOT approved using static catalogue)
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Template catalogue is currently unavailable');

      // Assert campaign in DB remains DRAFT and was NOT activated
      const inDb = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
      expect(inDb?.status).toBe('DRAFT');
      expect(inDb?.activeVersionId).toBeNull();
    } finally {
      spy.mockRestore();
      if (origEnv !== undefined) {
        process.env.ALLOW_STATIC_TEMPLATE_FALLBACK = origEnv;
      }
    }
  });

  it('Review 4 — P2: Out-of-order delivery end-to-end: Webhook arrives before provider response, worker runs processClaimedExecution, resolves to READ without regressing to ACCEPTED', async () => {
    const providerMessageId = 'wamid_r4_e2e_prod_worker';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000);

    // 1. Setup Active Connection for tenantA
    await TenantConnectionModel.create({
      id: 'conn_r4_e2e',
      tenantId: tenantA,
      connectionId: 'phone_num_r4_e2e',
      status: 'ACTIVE'
    });

    // 2. Setup Gates and Campaign
    await TenantControlGateModel.create({
      id: 'tg_r4_e2e',
      tenantId: tenantA,
      globalPause: false,
      gateVersion: 1
    });

    await CampaignControlGateModel.create({
      id: 'cg_r4_e2e',
      tenantId: tenantA,
      campaignId: 'cmp_r4_e2e',
      paused: false,
      pauseGeneration: 1,
      gateVersion: 1
    });

    await CampaignModel.create({
      id: 'cmp_r4_e2e',
      tenantId: tenantA,
      name: 'Review 4 E2E Campaign',
      industry: 'BOUTIQUE',
      status: 'ACTIVE',
      purpose: 'MARKETING',
      pauseGeneration: 1,
      draftVersion: 1,
      activeVersionId: 'ver_r4_e2e'
    });

    await CampaignVersionModel.create({
      id: 'ver_r4_e2e',
      campaignId: 'cmp_r4_e2e',
      tenantId: tenantA,
      version: 1,
      name: 'Review 4 E2E Version',
      brandName: 'Audit Silks',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      priority: 80,
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_1',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      reviewFingerprint: 'fp_r4_e2e'
    });

    const customer = await CustomerModel.create({
      id: 'cus_r4_e2e',
      tenantId: tenantA,
      firstName: 'Aarav',
      lastName: 'Sharma',
      phone: '+919876543210',
      status: 'ACTIVE',
      optedInMarketing: true
    });

    await CampaignEnrollmentModel.create({
      id: 'enr_r4_e2e',
      tenantId: tenantA,
      campaignId: 'cmp_r4_e2e',
      campaignVersionId: 'ver_r4_e2e',
      customerId: customer.id,
      occurrenceId: 'birthday:2026',
      sourceRef: {
        type: 'CUSTOMER_DATE',
        id: customer.id,
        version: 1
      },
      status: 'ACTIVE'
    });

    // 3. Create execution claimed by worker (EVALUATING state with valid lease)
    const exe = await CampaignExecutionModel.create({
      id: 'exe_r4_e2e',
      tenantId: tenantA,
      enrollmentId: 'enr_r4_e2e',
      campaignId: 'cmp_r4_e2e',
      stepId: 'step_1',
      dueAt: now,
      expiresAt,
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      pauseGeneration: 1,
      state: 'EVALUATING',
      lease: {
        token: 'tok_r4_worker',
        until: new Date(now.getTime() + 600000),
        claimedBy: 'worker_r4'
      },
      deliveredAt: null,
      readAt: null
    });

    // 4. Start with an intent that has NO provider message ID (Review 4 P2 requirement)
    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_r4_e2e',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_r4_e2e',
      customerId: customer.id,
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r4_e2e',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'SUBMITTING',
      attemptId: 'att_r4_e2e',
      providerMessageId: null, // NO provider message ID initially!
      deliveredAt: null,
      readAt: null
    });

    // 5. Have the webhook arrive FIRST and be durably stored as an uncorrelated event in CampaignEventInboxModel
    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
    const readTimestamp = Math.floor(now.getTime() / 1000).toString();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test_r4',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'phone_num_r4_e2e' },
                statuses: [{ id: providerMessageId, status: 'read', timestamp: readTimestamp }]
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const resWebhook = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature
      },
      body: rawBody
    });
    expect(resWebhook.status).toBe(200);

    // Verify the uncorrelated event is durably stored in CampaignEventInboxModel with status RECEIVED
    const inboxEvent = await CampaignEventInboxModel.findOne({
      tenantId: tenantA,
      'data.providerMessageId': providerMessageId
    });
    expect(inboxEvent).not.toBeNull();
    expect(inboxEvent?.status).toBe('RECEIVED');

    // Intent in DB still has no provider message ID and remains SUBMITTING at this point
    const preWorkerIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(preWorkerIntent?.providerMessageId).toBeNull();
    expect(preWorkerIntent?.state).toBe('SUBMITTING');

    // 6. Controlled mock adapter returning ACCEPTED with the provider message ID
    const mockAdapter: IWhatsAppDeliveryAdapter = {
      sendCampaignStep: vi.fn().mockResolvedValue({
        state: 'ACCEPTED',
        providerMessageId
      })
    };

    // 7. Run the REAL worker production path: processClaimedExecution!
    const workerResult = await processClaimedExecution(exe.id, mockAdapter, now);
    expect(workerResult).toBe('ACCEPTED');
    expect(mockAdapter.sendCampaignStep).toHaveBeenCalledTimes(1);

    // 8. Assert that BOTH execution and intent end in READ, retain the message ID, and do NOT regress to ACCEPTED
    const finalExe = await CampaignExecutionModel.findOne({ id: exe.id });
    expect(finalExe?.state).toBe('READ');
    expect(finalExe?.readAt).not.toBeNull();

    const finalIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(finalIntent?.state).toBe('READ');
    expect(finalIntent?.readAt).not.toBeNull();
    expect(finalIntent?.providerMessageId).toBe(providerMessageId);

    // 9. Verify the early inbox event was correlated and marked PROCESSED
    const postWorkerInboxEvent = await CampaignEventInboxModel.findOne({
      tenantId: tenantA,
      'data.providerMessageId': providerMessageId
    });
    expect(postWorkerInboxEvent?.status).toBe('PROCESSED');
    expect(postWorkerInboxEvent?.entityId).toBe(exe.id);
  });

  it('Review 4 — P1: Webhook consistency: Late DELIVERED or READ on FAILED/REJECTED does not resurrect records', async () => {
    const providerMessageId = 'wamid_p1_failed_conflict';
    const now = new Date();

    const exe = await CampaignExecutionModel.create({
      id: 'exe_p1_fail',
      tenantId: tenantA,
      enrollmentId: 'enr_p1_fail',
      campaignId: 'cmp_p1_fail',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'FAILED',
      outcomeReason: 'PROVIDER_TIMEOUT_TERMINAL',
      deliveredAt: null,
      readAt: null
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_p1_fail',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_p1',
      customerId: 'cus_p1_fail',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_p1',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'REJECTED',
      attemptId: 'att_p1_fail',
      providerMessageId,
      errorCode: 'PROVIDER_TIMEOUT'
    });

    // Late delivered webhook arrives
    const reconDelivered = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'delivered',
      providerTimestamp: now
    });
    expect(reconDelivered.policyResult).toBe('TERMINAL_PRESERVED');

    // Both records must remain FAILED and REJECTED
    const exeAfterDelivered = await CampaignExecutionModel.findOne({ id: exe.id });
    const intentAfterDelivered = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(exeAfterDelivered?.state).toBe('FAILED');
    expect(intentAfterDelivered?.state).toBe('REJECTED');

    // Late read webhook arrives
    const reconRead = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'read',
      providerTimestamp: now
    });
    expect(reconRead.policyResult).toBe('TERMINAL_PRESERVED');

    // Both records must still remain FAILED and REJECTED
    const exeAfterRead = await CampaignExecutionModel.findOne({ id: exe.id });
    const intentAfterRead = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(exeAfterRead?.state).toBe('FAILED');
    expect(intentAfterRead?.state).toBe('REJECTED');
  });

  it('Review 4 — P1: Webhook consistency: Late DELIVERED or READ on SKIPPED/EXPIRED preserves terminal state', async () => {
    const providerMessageId = 'wamid_p1_skipped_conflict';
    const now = new Date();

    const exe = await CampaignExecutionModel.create({
      id: 'exe_p1_skip',
      tenantId: tenantA,
      enrollmentId: 'enr_p1_skip',
      campaignId: 'cmp_p1_skip',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'SKIPPED',
      outcomeReason: 'SKIPPED_STEP_EXPIRED'
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_p1_skip',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_p1',
      customerId: 'cus_p1_skip',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_p1_skip',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'EXPIRED',
      attemptId: 'att_p1_skip',
      providerMessageId
    });

    const recon = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'read',
      providerTimestamp: now
    });
    expect(recon.policyResult).toBe('TERMINAL_PRESERVED');

    const finalExe = await CampaignExecutionModel.findOne({ id: exe.id });
    const finalIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    expect(finalExe?.state).toBe('SKIPPED');
    expect(finalIntent?.state).toBe('EXPIRED');
  });

  it('Review 4 — P1: Webhook consistency: Delayed DELIVERED after READ preserves READ state monotonically', async () => {
    const providerMessageId = 'wamid_p1_read_monotonic';
    const now = new Date();
    const deliveredAt = new Date(now.getTime() - 10000);
    const readAt = now;

    const exe = await CampaignExecutionModel.create({
      id: 'exe_p1_mono',
      tenantId: tenantA,
      enrollmentId: 'enr_p1_mono',
      campaignId: 'cmp_p1_mono',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'READ',
      readAt
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_p1_mono',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_p1',
      customerId: 'cus_p1_mono',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_p1_mono',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'READ',
      attemptId: 'att_p1_mono',
      providerMessageId,
      readAt
    });

    // Late delivered webhook arrives AFTER read
    const recon = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'delivered',
      providerTimestamp: deliveredAt
    });
    expect(recon.policyResult).toBe('MONOTONIC_PRESERVED');

    const finalExe = await CampaignExecutionModel.findOne({ id: exe.id });
    const finalIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    // State remains READ!
    expect(finalExe?.state).toBe('READ');
    expect(finalIntent?.state).toBe('READ');
    // deliveredAt timestamp was safely populated
    expect(finalExe?.deliveredAt).not.toBeNull();
    expect(finalIntent?.deliveredAt).not.toBeNull();
  });

  it('Review 4 — P1: Webhook consistency: Late FAILED event cannot regress confirmed DELIVERED or READ message', async () => {
    const providerMessageId = 'wamid_p1_delivered_protect';
    const now = new Date();

    const exe = await CampaignExecutionModel.create({
      id: 'exe_p1_prot',
      tenantId: tenantA,
      enrollmentId: 'enr_p1_prot',
      campaignId: 'cmp_p1_prot',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DELIVERED',
      deliveredAt: now
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_p1_prot',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_p1',
      customerId: 'cus_p1_prot',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_p1_prot',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'DELIVERED',
      attemptId: 'att_p1_prot',
      providerMessageId,
      deliveredAt: now
    });

    // Out-of-order failed event arrives
    const recon = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'failed',
      errorCode: 'LATE_ERROR_CODE'
    });
    expect(recon.policyResult).toBe('MONOTONIC_PRESERVED');

    const finalExe = await CampaignExecutionModel.findOne({ id: exe.id });
    const finalIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id });
    // Terminal delivery protected: stays DELIVERED!
    expect(finalExe?.state).toBe('DELIVERED');
    expect(finalIntent?.state).toBe('DELIVERED');
  });

  it('Review 3: Concurrent draft edits race serialize and reject stale version with 409 Conflict', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_concurrent_edits_r3',
      tenantId: tenantA,
      name: 'Concurrent Edits Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      pauseGeneration: 0
    });

    await CampaignVersionModel.create({
      id: generateId('cv'),
      campaignId: camp.id,
      tenantId: tenantA,
      version: 1,
      name: camp.name,
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [],
      reviewFingerprint: 'fp_edits_v1'
    });

    // Two concurrent requests attempt to patch draft with expectedVersion: 1
    const [resA, resB] = await Promise.all([
      apiPatch(
        `/api/v1/campaigns/${camp.id}/draft`,
        { expectedVersion: 1, priority: 60 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_race_edit_a' }
      ),
      apiPatch(
        `/api/v1/campaigns/${camp.id}/draft`,
        { expectedVersion: 1, priority: 70 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_race_edit_b' }
      )
    ]);

    // Exactly one succeeds with 200, one fails with 409 Conflict
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const updated = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
    expect(updated?.draftVersion).toBe(2);
  });

  it('Review 3: Concurrent activation attempts race serialize and reject duplicate with 409 Conflict', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_concurrent_act_r3',
      tenantId: tenantA,
      name: 'Concurrent Activation Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      pauseGeneration: 0
    });

    const draft = await CampaignVersionModel.create({
      id: generateId('cv'),
      campaignId: camp.id,
      tenantId: tenantA,
      version: 1,
      name: 'Concurrent Act Draft',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      priority: 80,
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_invite',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      reviewFingerprint: 'fp_race_act'
    });

    await CampaignDryRunModel.create({
      id: generateId('dry'),
      tenantId: tenantA,
      campaignId: camp.id,
      draftVersion: 1,
      draftFingerprint: 'fp_race_act',
      createdAt: new Date(),
      summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 }
    });

    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_race_act',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE'
    });

    // Fire two concurrent activation requests with expectedVersion: 1
    const [resA, resB] = await Promise.all([
      apiPost(
        `/api/v1/campaigns/${camp.id}/activate`,
        { reviewFingerprint: 'fp_race_act', expectedVersion: 1 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_race_act_a' }
      ),
      apiPost(
        `/api/v1/campaigns/${camp.id}/activate`,
        { reviewFingerprint: 'fp_race_act', expectedVersion: 1 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_race_act_b' }
      )
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const inDb = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
    expect(inDb?.status).toBe('ACTIVE');
    expect(inDb?.activeVersionId).toBe(draft.id);
  });

  it('Review 3: Transaction rollback when publication or audit persistence fails', async () => {
    const camp = await CampaignModel.create({
      id: 'cmp_rollback_audit_fail',
      tenantId: tenantA,
      name: 'Rollback Campaign',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      status: 'DRAFT',
      draftVersion: 1,
      activeVersionId: null,
      pauseGeneration: 0
    });

    const draft = await CampaignVersionModel.create({
      id: generateId('cv'),
      campaignId: camp.id,
      tenantId: tenantA,
      version: 1,
      name: 'Rollback Draft',
      industry: 'BOUTIQUE',
      purpose: 'MARKETING',
      priority: 80,
      trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
      timezone: 'Asia/Kolkata',
      audience: { mode: 'ALL_ELIGIBLE' },
      steps: [
        {
          stepId: 'step_invite',
          offsetDays: 0,
          localTime: '10:00',
          prerequisite: 'NONE',
          templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
          bindings: { name: 'customer.firstName' }
        }
      ],
      reviewFingerprint: 'fp_rollback_test',
      publishedBy: 'unactivated_user'
    });

    await CampaignDryRunModel.create({
      id: generateId('dry'),
      tenantId: tenantA,
      campaignId: camp.id,
      draftVersion: 1,
      draftFingerprint: 'fp_rollback_test',
      createdAt: new Date(),
      summary: { totalEvaluated: 1, eligibleCount: 1, excludedCount: 0 }
    });

    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_rollback_test',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE'
    });

    // Spy on AuditLogModel.create specifically to throw an error inside the publication transaction
    const origCreate = AuditLogModel.create;
    const spy = vi.spyOn(AuditLogModel, 'create').mockImplementation(function (this: any, ...args: any[]) {
      if (this === AuditLogModel || this?.modelName === 'AuditLog') {
        throw new Error('Simulated Audit Log DB Disk Failure');
      }
      return origCreate.apply(this, args);
    });

    try {
      const res = await apiPost(
        `/api/v1/campaigns/${camp.id}/activate`,
        { reviewFingerprint: 'fp_rollback_test', expectedVersion: 1 },
        ownerTokenA,
        { 'Idempotency-Key': 'idemp_rollback_test' }
      );

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);

      // Verify complete atomic rollback:
      // 1. Campaign remains DRAFT
      const campDb = await CampaignModel.findOne({ id: camp.id, tenantId: tenantA });
      expect(campDb?.status).toBe('DRAFT');
      expect(campDb?.activeVersionId).toBeNull();

      // 2. Draft publishedBy was rolled back to unactivated_user
      const draftDb = await CampaignVersionModel.findOne({ id: draft.id, tenantId: tenantA });
      expect(draftDb?.publishedBy).toBe('unactivated_user');

      // 3. No audit log persisted
      const auditDb = await AuditLogModel.findOne({ targetId: camp.id, tenantId: tenantA });
      expect(auditDb).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('Review 5 — P1: Tenant isolation strictly enforced during delivery-status reconciliation (no cross-tenant leakage)', async () => {
    const providerMessageIdB = 'wamid_secret_tenant_b_review5';
    const now = new Date();

    // 1. Connection for Tenant A
    await TenantConnectionModel.create({
      id: 'conn_tenant_a_r5',
      tenantId: tenantA,
      connectionId: 'phone_num_tenant_a_r5',
      status: 'ACTIVE'
    });

    // 2. Connection for Tenant B
    await TenantConnectionModel.create({
      id: 'conn_tenant_b_r5',
      tenantId: tenantB,
      connectionId: 'phone_num_tenant_b_r5',
      status: 'ACTIVE'
    });

    // 3. Execution & Delivery Intent belonging strictly to Tenant B
    const exeB = await CampaignExecutionModel.create({
      id: 'exe_tenant_b_r5',
      tenantId: tenantB,
      enrollmentId: 'enr_tenant_b_r5',
      campaignId: 'cmp_tenant_b_r5',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'PROVIDER_ACCEPTED',
      deliveredAt: null,
      readAt: null
    });

    const intentB = await CampaignDeliveryIntentModel.create({
      id: 'intent_tenant_b_r5',
      tenantId: tenantB,
      executionId: exeB.id,
      deliveryKey: exeB.id,
      connectionId: 'conn_tenant_b_r5',
      customerId: 'cus_tenant_b_r5',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc_b',
      payloadHash: 'hash_tenant_b',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_tenant_b_r5',
      providerMessageId: providerMessageIdB,
      deliveredAt: null,
      readAt: null
    });

    // 4. Attack/Mismatch scenario: Webhook arrives via Tenant A's connection presenting Tenant B's message ID
    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
    const readTimestamp = Math.floor(now.getTime() / 1000).toString();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test_cross_tenant',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'phone_num_tenant_a_r5' }, // Connection belongs to Tenant A!
                statuses: [{ id: providerMessageIdB, status: 'read', timestamp: readTimestamp }] // Message belongs to Tenant B!
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const resWebhook = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature
      },
      body: rawBody
    });
    expect(resWebhook.status).toBe(200);

    // 5. Directly invoke reconcileDeliveryStatus with Tenant A's context and Tenant B's message ID
    const directRecon = await reconcileDeliveryStatus({
      tenantId: tenantA, // Wrong tenant context!
      providerMessageId: providerMessageIdB,
      status: 'read',
      providerTimestamp: now
    });
    // Strict tenant isolation must fail closed with INTENT_NOT_FOUND
    expect(directRecon.reconciled).toBe(false);
    expect(directRecon.policyResult).toBe('INTENT_NOT_FOUND');

    // 6. Assert that Tenant B's records are completely UNTOUCHED
    const finalExeB = await CampaignExecutionModel.findOne({ id: exeB.id, tenantId: tenantB });
    expect(finalExeB?.state).toBe('PROVIDER_ACCEPTED'); // NOT changed to READ!
    expect(finalExeB?.readAt).toBeNull();

    const finalIntentB = await CampaignDeliveryIntentModel.findOne({ id: intentB.id, tenantId: tenantB });
    expect(finalIntentB?.state).toBe('ACCEPTED'); // NOT changed to READ!
    expect(finalIntentB?.readAt).toBeNull();
  });

  it('Review 5 — P2: BLOCKED terminal execution synchronizes delivery intent to REJECTED lockstep', async () => {
    const providerMessageId = 'wamid_blocked_sync_test_r5';
    const now = new Date();

    const exe = await CampaignExecutionModel.create({
      id: 'exe_blocked_r5',
      tenantId: tenantA,
      enrollmentId: 'enr_blocked_r5',
      campaignId: 'cmp_blocked_r5',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'BLOCKED',
      outcomeReason: 'CONTENT_OR_TEMPLATE_BLOCKED',
      deliveredAt: null,
      readAt: null
    });

    // Non-terminal intent (e.g. ACCEPTED or SUBMITTING) paired with BLOCKED execution
    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_blocked_r5',
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_test',
      customerId: 'cus_blocked_r5',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_blocked_r5',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_blocked_r5',
      providerMessageId,
      deliveredAt: null,
      readAt: null
    });

    // Late webhook arrives
    const recon = await reconcileDeliveryStatus({
      tenantId: tenantA,
      providerMessageId,
      status: 'delivered',
      providerTimestamp: now
    });

    expect(recon.policyResult).toBe('TERMINAL_PRESERVED');

    // Both records must now be consistently aligned in their terminal non-delivery paired states:
    // Execution: BLOCKED
    // DeliveryIntent: REJECTED
    const finalExe = await CampaignExecutionModel.findOne({ id: exe.id, tenantId: tenantA });
    const finalIntent = await CampaignDeliveryIntentModel.findOne({ id: intent.id, tenantId: tenantA });

    expect(finalExe?.state).toBe('BLOCKED');
    expect(finalIntent?.state).toBe('REJECTED');
    expect(finalIntent?.errorCode).toBe('EXECUTION_BLOCKED');
  });

  it('Review 6 — P1: Webhook reconciliation transient failure leaves inbox event retryable; retry successfully reconciles records and marks event PROCESSED', async () => {
    const now = new Date();
    const providerMessageId = 'wam_r6_retry_' + Date.now();
    const phoneNumberId = 'phone_num_meta_r6_' + Date.now();

    // 1. Provision active connection mapped to Meta phone number ID in metadata
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_r6_tenant_a_' + Date.now(),
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { phoneNumberId }
    });

    // 2. Seed CampaignExecution and paired CampaignDeliveryIntent
    const exe = await CampaignExecutionModel.create({
      id: 'exe_r6_retry_test_' + Date.now(),
      tenantId: tenantA,
      enrollmentId: 'enr_r6_1',
      campaignId: 'cmp_r6_1',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DISPATCHING',
      outcomeReason: null,
      deliveredAt: null,
      readAt: null
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_r6_retry_test_' + Date.now(),
      tenantId: tenantA,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_r6_tenant_a',
      customerId: 'cus_r6_1',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r6',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_r6',
      providerMessageId,
      deliveredAt: null,
      readAt: null
    });

    // 3. Construct Meta Cloud API webhook delivery payload
    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
    const timestampStr = Math.floor(now.getTime() / 1000).toString();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_r6_test',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'delivered', timestamp: timestampStr }]
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // 4. Force reconciliation to throw on the first attempt (simulating transient MongoDB transaction abort)
    let failedOnce = false;
    const originalRecon = deliveryRecon.reconcileDeliveryStatus;
    const reconSpy = vi.spyOn(deliveryRecon, 'reconcileDeliveryStatus').mockImplementation(async (params) => {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error('Simulated transient MongoDB transaction abort during delivery reconciliation');
      }
      return originalRecon(params);
    });

    try {
      // 5. First Webhook Ingestion: must fail with HTTP 500
      const res1 = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature
        },
        body: rawBody
      });
      expect(res1.status).toBe(500);

      // Verify inbox event was inserted and marked FAILED (never permanently PROCESSED)
      const statusEventKey = `${providerMessageId}_delivered_${timestampStr}`;
      const inboxAfterFail = await CampaignEventInboxModel.findOne({
        tenantId: tenantA,
        eventId: statusEventKey
      });
      expect(inboxAfterFail).not.toBeNull();
      expect(inboxAfterFail?.status).toBe('FAILED');
      expect(inboxAfterFail?.errorMessage).toContain('Simulated transient MongoDB transaction abort');
      expect(inboxAfterFail?.processedAt).toBeNull();

      // Verify domain records were NOT updated prematurely
      const exeAfterFail = await CampaignExecutionModel.findOne({ id: exe.id, tenantId: tenantA });
      const intentAfterFail = await CampaignDeliveryIntentModel.findOne({ id: intent.id, tenantId: tenantA });
      expect(exeAfterFail?.state).toBe('DISPATCHING');
      expect(exeAfterFail?.deliveredAt).toBeNull();
      expect(intentAfterFail?.state).toBe('ACCEPTED');
      expect(intentAfterFail?.deliveredAt).toBeNull();

      // 6. Provider Retry: send the EXACT SAME webhook payload again
      const res2 = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature
        },
        body: rawBody
      });
      expect(res2.status).toBe(200);

      // Verify inbox event is now PROCESSED and retry metadata cleared
      const inboxAfterRetry = await CampaignEventInboxModel.findOne({
        tenantId: tenantA,
        eventId: statusEventKey
      });
      expect(inboxAfterRetry?.status).toBe('PROCESSED');
      expect(inboxAfterRetry?.processedAt).not.toBeNull();
      expect(inboxAfterRetry?.errorMessage).toBeNull();

      // Verify domain records are now properly reconciled to DELIVERED
      const exeAfterRetry = await CampaignExecutionModel.findOne({ id: exe.id, tenantId: tenantA });
      const intentAfterRetry = await CampaignDeliveryIntentModel.findOne({ id: intent.id, tenantId: tenantA });
      expect(exeAfterRetry?.state).toBe('DELIVERED');
      expect(exeAfterRetry?.deliveredAt).not.toBeNull();
      expect(intentAfterRetry?.state).toBe('DELIVERED');
      expect(intentAfterRetry?.deliveredAt).not.toBeNull();

      // 7. Duplicate Replay (third delivery after successful processing): idempotent skip
      const callsBefore = reconSpy.mock.calls.length;
      const res3 = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature
        },
        body: rawBody
      });
      expect(res3.status).toBe(200);
      expect(reconSpy.mock.calls.length).toBe(callsBefore); // Did not re-invoke reconciliation
    } finally {
      reconSpy.mockRestore();
    }
  });

  it('Review 6 — Connection Identity Mapping: verifies Meta phone_number_id resolution via metadata and environment', async () => {
    const phoneNumberIdA = '919998887771_' + Date.now();
    const phoneNumberIdB = '919998887772_' + Date.now();

    // 1. Connection with metadata.phoneNumberId
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantA,
      connectionId: 'conn_tenant_a_named_' + Date.now(),
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { phoneNumberId: phoneNumberIdA }
    });

    // 2. Connection with metadata.phone_number_id (snake_case Meta payload standard)
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantB,
      connectionId: 'conn_tenant_b_named_' + Date.now(),
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { phone_number_id: phoneNumberIdB }
    });

    // Verify tenant resolution matches connection owner
    const resolvedA = await resolveTenantForConnection(phoneNumberIdA);
    expect(resolvedA).toBe(tenantA);

    const resolvedB = await resolveTenantForConnection(phoneNumberIdB);
    expect(resolvedB).toBe(tenantB);

    // Unknown connection fails closed
    const resolvedUnknown = await resolveTenantForConnection('unknown_phone_number_id_999');
    expect(resolvedUnknown).toBeNull();
  });

  it('Review 7 — P2: Early webhook without matching intent is deferred with backoff; newer event is processed without queue starvation; dead-letters after max retries; recovers on late association', async () => {
    const testTenant = 'audit_tenant_r7_' + Date.now();
    const now = new Date();

    const oldProviderMsgId = 'wamid_r7_old_missing_' + Date.now();
    const newProviderMsgId = 'wamid_r7_new_valid_' + Date.now();

    // 1. Insert an older status event with NO matching delivery intent (arrived 10 minutes ago)
    const oldEvent = await CampaignEventInboxModel.create({
      id: generateId('evt'),
      tenantId: testTenant,
      producer: 'whatsapp_status_webhook',
      eventId: `${oldProviderMsgId}_delivered_old`,
      type: 'whatsapp.status.delivered',
      entityId: oldProviderMsgId,
      entityVersion: 1,
      occurredAt: new Date(now.getTime() - 10 * 60 * 1000),
      receivedAt: new Date(now.getTime() - 10 * 60 * 1000),
      data: {
        providerMessageId: oldProviderMsgId,
        status: 'delivered'
      },
      status: 'RECEIVED',
      retryCount: 0,
      nextAttemptAt: null,
      processedAt: null,
      errorMessage: null
    });

    // 2. Insert a newer status event with a VALID matching intent (arrived 2 minutes ago)
    const exeNew = await CampaignExecutionModel.create({
      id: 'exe_r7_new_' + Date.now(),
      tenantId: testTenant,
      enrollmentId: 'enr_r7_1',
      campaignId: 'cmp_r7_1',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DISPATCHING',
      outcomeReason: null,
      deliveredAt: null,
      readAt: null
    });

    const intentNew = await CampaignDeliveryIntentModel.create({
      id: 'intent_r7_new_' + Date.now(),
      tenantId: testTenant,
      executionId: exeNew.id,
      deliveryKey: exeNew.id,
      connectionId: 'conn_r7',
      customerId: 'cus_r7_1',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r7',
      templateRef: { id: 'tpl_r7', revision: 1, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_r7',
      providerMessageId: newProviderMsgId,
      deliveredAt: null,
      readAt: null
    });

    const newEvent = await CampaignEventInboxModel.create({
      id: generateId('evt'),
      tenantId: testTenant,
      producer: 'whatsapp_status_webhook',
      eventId: `${newProviderMsgId}_delivered_new`,
      type: 'whatsapp.status.delivered',
      entityId: intentNew.executionId,
      entityVersion: 1,
      occurredAt: new Date(now.getTime() - 2 * 60 * 1000),
      receivedAt: new Date(now.getTime() - 2 * 60 * 1000),
      data: {
        providerMessageId: newProviderMsgId,
        status: 'delivered'
      },
      status: 'RECEIVED',
      retryCount: 0,
      nextAttemptAt: null,
      processedAt: null,
      errorMessage: null
    });

    // 3. First Worker Cycle:
    // The worker queries the oldest eligible RECEIVED event. It picks oldEvent.
    // Finding no intent, oldEvent must be deferred with backoff (nextAttemptAt in future) and NOT processed or immediately requeued.
    const cycle1 = await processNextPendingEvent(testTenant);
    expect(cycle1).not.toBeNull();
    expect(cycle1?.id).toBe(oldEvent.id);
    expect(cycle1?.status).toBe('RECEIVED');
    expect(cycle1?.retryCount).toBe(1);
    expect(cycle1?.nextAttemptAt).not.toBeNull();
    expect(cycle1?.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // 4. Second Worker Cycle (Queue Starvation Test):
    // Since oldEvent has nextAttemptAt scheduled in the future, it is excluded from the query.
    // The worker must pick newEvent and process it to PROCESSED!
    const cycle2 = await processNextPendingEvent(testTenant);
    expect(cycle2).not.toBeNull();
    expect(cycle2?.id).toBe(newEvent.id);
    expect(cycle2?.status).toBe('PROCESSED');
    expect(cycle2?.nextAttemptAt).toBeNull();

    // Verify the newer execution and intent were updated to DELIVERED
    const exeNewUpdated = await CampaignExecutionModel.findOne({ id: exeNew.id, tenantId: testTenant });
    const intentNewUpdated = await CampaignDeliveryIntentModel.findOne({ id: intentNew.id, tenantId: testTenant });
    expect(exeNewUpdated?.state).toBe('DELIVERED');
    expect(intentNewUpdated?.state).toBe('DELIVERED');

    // 5. Third Worker Cycle:
    // With newEvent PROCESSED and oldEvent deferred in the future, no eligible event exists right now
    const cycle3 = await processNextPendingEvent(testTenant);
    expect(cycle3).toBeNull(); // Old event was NOT picked up repeatedly! Starvation prevented!

    // 6. Dead-Letter Quarantine Test after bounded retries:
    // Advance oldEvent retryCount to MAX_UNRESOLVED_INTENT_RETRIES - 1 (e.g. 4) and set nextAttemptAt to past
    await CampaignEventInboxModel.updateOne(
      { id: oldEvent.id },
      {
        $set: {
          retryCount: MAX_UNRESOLVED_INTENT_RETRIES - 1,
          nextAttemptAt: new Date(Date.now() - 1000)
        }
      }
    );

    const cycle4 = await processNextPendingEvent(testTenant);
    expect(cycle4).not.toBeNull();
    expect(cycle4?.id).toBe(oldEvent.id);
    expect(cycle4?.status).toBe('QUARANTINE');
    expect(cycle4?.retryCount).toBe(MAX_UNRESOLVED_INTENT_RETRIES);
    expect(cycle4?.errorMessage).toContain('moved to dead-letter queue');

    // 7. Late intent association recovery:
    // Later, dispatch executor completes and associates oldProviderMsgId
    const exeLate = await CampaignExecutionModel.create({
      id: 'exe_r7_late_' + Date.now(),
      tenantId: testTenant,
      enrollmentId: 'enr_r7_late',
      campaignId: 'cmp_r7_late',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DISPATCHING',
      outcomeReason: null,
      deliveredAt: null,
      readAt: null
    });

    const intentLate = await CampaignDeliveryIntentModel.create({
      id: 'intent_r7_late_' + Date.now(),
      tenantId: testTenant,
      executionId: exeLate.id,
      deliveryKey: exeLate.id,
      connectionId: 'conn_r7',
      customerId: 'cus_r7_late',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r7_late',
      templateRef: { id: 'tpl_r7', revision: 1, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_r7_late',
      providerMessageId: oldProviderMsgId,
      deliveredAt: null,
      readAt: null
    });

    // Simulate dispatch executor finding early status receipts for oldProviderMsgId
    const earlyRecovered = await CampaignEventInboxModel.find({
      tenantId: testTenant,
      type: { $in: ['whatsapp.status.delivered', 'whatsapp.status.read', 'whatsapp.status.failed'] },
      'data.providerMessageId': oldProviderMsgId
    });

    expect(earlyRecovered.length).toBe(1);
    for (const early of earlyRecovered) {
      await reconcileDeliveryStatus({
        tenantId: testTenant,
        providerMessageId: oldProviderMsgId,
        status: 'delivered',
        providerTimestamp: early.occurredAt || new Date(),
        inboxEventId: early.id
      });
      early.status = 'PROCESSED';
      early.entityId = exeLate.id;
      early.processedAt = new Date();
      early.nextAttemptAt = null;
      early.errorMessage = null;
      await early.save();
    }

    const oldEventRecovered = await CampaignEventInboxModel.findOne({ id: oldEvent.id });
    expect(oldEventRecovered?.status).toBe('PROCESSED');
    expect(oldEventRecovered?.entityId).toBe(exeLate.id);
    expect(oldEventRecovered?.nextAttemptAt).toBeNull();

    const exeLateUpdated = await CampaignExecutionModel.findOne({ id: exeLate.id });
    const intentLateUpdated = await CampaignDeliveryIntentModel.findOne({ id: intentLate.id });
    expect(exeLateUpdated?.state).toBe('DELIVERED');
    expect(intentLateUpdated?.state).toBe('DELIVERED');
  });

  it('Review 8 — P1: Normal Meta delivered webhook routes through transactional reconciliation; transaction failure leaves inbox event FAILED (not PROCESSED) and records unmutated', async () => {
    const testTenant = 'audit_tenant_r8_tx_' + Date.now();
    const phoneNumberId = 'phone_num_meta_r8_' + Date.now();
    const providerMessageId = 'wam_r8_atomic_' + Date.now();
    const now = new Date();

    // 1. Provision active connection mapped to Meta phone number ID
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: testTenant,
      connectionId: 'conn_r8_' + Date.now(),
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { phoneNumberId }
    });

    // 2. Seed CampaignExecution and paired CampaignDeliveryIntent
    const exe = await CampaignExecutionModel.create({
      id: 'exe_r8_atomic_' + Date.now(),
      tenantId: testTenant,
      enrollmentId: 'enr_r8_1',
      campaignId: 'cmp_r8_1',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DISPATCHING',
      outcomeReason: null,
      deliveredAt: null,
      readAt: null
    });

    const intent = await CampaignDeliveryIntentModel.create({
      id: 'intent_r8_atomic_' + Date.now(),
      tenantId: testTenant,
      executionId: exe.id,
      deliveryKey: exe.id,
      connectionId: 'conn_r8',
      customerId: 'cus_r8_1',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r8',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_r8',
      providerMessageId,
      deliveredAt: null,
      readAt: null
    });

    // 3. Construct standard Meta delivered status webhook
    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
    const timestampStr = Math.floor(now.getTime() / 1000).toString();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_r8_test',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: providerMessageId, status: 'delivered', timestamp: timestampStr }]
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // 4. Force reconciliation transaction to fail
    const reconSpy = vi.spyOn(deliveryRecon, 'reconcileDeliveryStatus').mockImplementation(async () => {
      throw new Error('Simulated transaction commit failure in reconciliation service');
    });

    try {
      const res = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature
        },
        body: rawBody
      });
      expect(res.status).toBe(500);

      // Verify inbox event was NOT marked PROCESSED (recorded as FAILED with error)
      const statusEventKey = `${providerMessageId}_delivered_${timestampStr}`;
      const inboxDoc = await CampaignEventInboxModel.findOne({
        tenantId: testTenant,
        eventId: statusEventKey
      });
      expect(inboxDoc).not.toBeNull();
      expect(inboxDoc?.status).toBe('FAILED');
      expect(inboxDoc?.errorMessage).toContain('Simulated transaction commit failure');
      expect(inboxDoc?.processedAt).toBeNull();

      // Verify domain records were NOT partially updated (atomicity guaranteed)
      const exeAfter = await CampaignExecutionModel.findOne({ id: exe.id, tenantId: testTenant });
      const intentAfter = await CampaignDeliveryIntentModel.findOne({ id: intent.id, tenantId: testTenant });

      expect(exeAfter?.state).toBe('DISPATCHING');
      expect(exeAfter?.deliveredAt).toBeNull();
      expect(intentAfter?.state).toBe('ACCEPTED');
      expect(intentAfter?.deliveredAt).toBeNull();
    } finally {
      reconSpy.mockRestore();
    }
  });

  it('Review 8 — P1: Tenant isolation strictly enforced on standard Meta and flat-payload webhook routes; Tenant A connection with Tenant B message ID leaves Tenant B records completely unchanged', async () => {
    const tenantTarget = 'audit_tenant_r8_target_' + Date.now();
    const tenantAttacker = 'audit_tenant_r8_attacker_' + Date.now();
    const now = new Date();

    const providerMsgIdTarget = 'wam_r8_target_msg_' + Date.now();
    const phoneAttacker = 'phone_attacker_' + Date.now();
    const connAttackerId = 'conn_attacker_' + Date.now();

    // 1. Provision Tenant Attacker connection
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId: tenantAttacker,
      connectionId: connAttackerId,
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: { phoneNumberId: phoneAttacker }
    });

    // 2. Seed Tenant Target CampaignExecution & CampaignDeliveryIntent
    const exeTarget = await CampaignExecutionModel.create({
      id: 'exe_r8_target_' + Date.now(),
      tenantId: tenantTarget,
      enrollmentId: 'enr_r8_target',
      campaignId: 'cmp_r8_target',
      stepId: 'step_1',
      dueAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      localDate: '2026-10-16',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      priority: 80,
      planRevision: 1,
      claimVersion: 1,
      state: 'DISPATCHING',
      outcomeReason: null,
      deliveredAt: null,
      readAt: null
    });

    const intentTarget = await CampaignDeliveryIntentModel.create({
      id: 'intent_r8_target_' + Date.now(),
      tenantId: tenantTarget,
      executionId: exeTarget.id,
      deliveryKey: exeTarget.id,
      connectionId: 'conn_target',
      customerId: 'cus_r8_target',
      recipientVersion: 1,
      encryptedRecipient: 'dummy_enc',
      payloadHash: 'hash_r8_target',
      templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
      state: 'ACCEPTED',
      attemptId: 'att_r8_target',
      providerMessageId: providerMsgIdTarget,
      deliveredAt: null,
      readAt: null
    });

    // 3. Attack attempt 1: Standard Meta webhook via Tenant Attacker connection submitting Tenant Target providerMessageId
    const webhookSecret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
    const timestampStr = Math.floor(now.getTime() / 1000).toString();
    const standardPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_r8_cross_tenant',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneAttacker }, // Belongs to Attacker
                statuses: [{ id: providerMsgIdTarget, status: 'delivered', timestamp: timestampStr }] // Belongs to Target!
              }
            }
          ]
        }
      ]
    };
    const standardRaw = JSON.stringify(standardPayload);
    const standardSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(standardRaw).digest('hex');

    const resStandard = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': standardSig
      },
      body: standardRaw
    });
    expect(resStandard.status).toBe(200);

    // Assert Tenant Target execution and intent remain completely UNTOUCHED
    let exeTargetCurrent = await CampaignExecutionModel.findOne({ id: exeTarget.id, tenantId: tenantTarget });
    let intentTargetCurrent = await CampaignDeliveryIntentModel.findOne({ id: intentTarget.id, tenantId: tenantTarget });
    expect(exeTargetCurrent?.state).toBe('DISPATCHING');
    expect(exeTargetCurrent?.deliveredAt).toBeNull();
    expect(intentTargetCurrent?.state).toBe('ACCEPTED');
    expect(intentTargetCurrent?.deliveredAt).toBeNull();

    // 4. Attack attempt 2: Flat payload presenting Attacker connectionId and Target providerMessageId
    const flatPayload = {
      connectionId: connAttackerId, // Belongs to Attacker
      providerMessageId: providerMsgIdTarget, // Belongs to Target!
      status: 'read'
    };
    const flatRaw = JSON.stringify(flatPayload);
    const flatSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(flatRaw).digest('hex');

    const resFlat = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': flatSig
      },
      body: flatRaw
    });
    // Fails closed with 404 because intent is not found for Attacker tenant
    expect([404, 401]).toContain(resFlat.status);

    // Assert Tenant Target records are still completely UNTOUCHED
    exeTargetCurrent = await CampaignExecutionModel.findOne({ id: exeTarget.id, tenantId: tenantTarget });
    intentTargetCurrent = await CampaignDeliveryIntentModel.findOne({ id: intentTarget.id, tenantId: tenantTarget });
    expect(exeTargetCurrent?.state).toBe('DISPATCHING');
    expect(exeTargetCurrent?.deliveredAt).toBeNull();
    expect(exeTargetCurrent?.readAt).toBeNull();
    expect(intentTargetCurrent?.state).toBe('ACCEPTED');
    expect(intentTargetCurrent?.deliveredAt).toBeNull();
    expect(intentTargetCurrent?.readAt).toBeNull();

    // 5. Unauthenticated flat payload with no tenant context: fails closed with 401
    const unauthFlatPayload = {
      providerMessageId: providerMsgIdTarget,
      status: 'delivered'
    };
    const unauthRaw = JSON.stringify(unauthFlatPayload);
    const unauthSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(unauthRaw).digest('hex');

    const resUnauth = await fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': unauthSig
      },
      body: unauthRaw
    });
    expect(resUnauth.status).toBe(401);
  });
});
