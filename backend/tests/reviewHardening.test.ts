import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { AuditLogModel } from '../src/modules/campaigns/models/AuditLog.model';
import { processClaimedExecution } from '../src/modules/campaigns/engine/dispatchExecutor';
import { MockWhatsAppDeliveryAdapter } from '../src/modules/campaigns/adapters/mockWhatsAppAdapter';

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
      AuditLogModel.deleteMany({ tenantId: { $regex: /^audit_tenant_/ } })
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
});
