import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../src/server';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { IdempotencyRecordModel } from '../src/modules/campaigns/models/Idempotency.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignControlGateModel } from '../src/modules/campaigns/models/CampaignControlGate.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { hashRequestBody, canonicalizeJson } from '../src/shared/middleware/idempotency.middleware';

describe('Step 11: Idempotency Hardening (Scope, Body Mismatch, 24h TTL, 2min Crash Recovery)', () => {
  const tenantId = 'qa_tenant_idemp_harden';
  let server: http.Server;
  let baseUrl: string;
  let ownerToken: string;

  beforeAll(async () => {
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    ownerToken = signJwt({
      userId: 'usr_idemp_owner',
      tenantId,
      role: 'BOUTIQUE_OWNER'
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(async () => {
    await IdempotencyRecordModel.deleteMany({ tenantId });
    await CampaignModel.deleteMany({ tenantId });
    await CampaignVersionModel.deleteMany({ tenantId });
    await CampaignEnrollmentModel.deleteMany({ tenantId });
    await CampaignExecutionModel.deleteMany({ tenantId });
    await CampaignControlGateModel.deleteMany({ tenantId });
    await TenantSettingsModel.deleteMany({ tenantId });
  });

  async function apiPost(path: string, body: any, idempotencyKey?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`
    };
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  async function apiPatch(path: string, body: any, idempotencyKey?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`
    };
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  describe('1. TTL Index & Hash Canonicalization', () => {
    it('declares a 24-hour TTL index on createdAt in IdempotencyRecordModel', () => {
      const indexes = IdempotencyRecordModel.schema.indexes();
      const ttlIndex = indexes.find((idx) => {
        const fields = idx[0];
        const options = idx[1];
        return fields && fields.createdAt === 1 && options?.expireAfterSeconds === 24 * 60 * 60;
      });

      expect(ttlIndex).toBeDefined();
      expect(ttlIndex![1]?.expireAfterSeconds).toBe(86400);
    });

    it('produces identical body hashes regardless of JSON key ordering', () => {
      const payloadA = { name: 'Kanjeevaram Saree', category: 'OCCASION', priority: 80 };
      const payloadB = { priority: 80, category: 'OCCASION', name: 'Kanjeevaram Saree' };

      const hashA = hashRequestBody(payloadA);
      const hashB = hashRequestBody(payloadB);

      expect(hashA).toBe(hashB);
      expect(canonicalizeJson(payloadA)).toBe(canonicalizeJson(payloadB));
    });
  });

  describe('2. Replay Safety & Awaited Response Cache', () => {
    it('replaying the same idempotency key with the same body returns the cached response without re-executing', async () => {
      const key = 'idemp_replay_test_01';
      const payload = { presetId: 'preset_birthday_shopping', name: 'Birthday Shopping Original' };

      // 1. Initial request
      const res1 = await apiPost('/api/v1/campaigns', payload, key);
      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      const createdCampaignId = res1.body.campaign.id;

      // 2. Database assertion: check cached idempotency record committed BEFORE response was returned
      const record = await IdempotencyRecordModel.findOne({ tenantId, key });
      expect(record).not.toBeNull();
      expect(record?.status).toBe('COMPLETED');
      expect(record?.statusCode).toBe(201);
      expect(record?.responseBody?.campaign?.id).toBe(createdCampaignId);
      expect(record?.method).toBe('POST');
      expect(record?.requestBodyHash).toBe(hashRequestBody(payload));

      // 3. Replay with identical key and identical body
      const res2 = await apiPost('/api/v1/campaigns', payload, key);
      expect(res2.status).toBe(201);
      expect(res2.body.campaign.id).toBe(createdCampaignId);

      // 4. Database assertion: exactly one campaign created in database
      const count = await CampaignModel.countDocuments({ tenantId });
      expect(count).toBe(1);

      const recordCount = await IdempotencyRecordModel.countDocuments({ tenantId, key });
      expect(recordCount).toBe(1);
    });
  });

  describe('3. Body Mismatch Detection (422)', () => {
    it('replaying the same idempotency key with a different request body returns 422 IDEMPOTENCY_BODY_MISMATCH', async () => {
      const key = 'idemp_mismatch_test_01';
      const initialPayload = { presetId: 'preset_birthday_shopping', name: 'Birthday Saree First' };
      const alteredPayload = { presetId: 'preset_birthday_shopping', name: 'Birthday Saree Fraudulent Changed' };

      // 1. First execution
      const res1 = await apiPost('/api/v1/campaigns', initialPayload, key);
      expect(res1.status).toBe(201);
      const initialId = res1.body.campaign.id;

      // 2. Replay with changed body
      const res2 = await apiPost('/api/v1/campaigns', alteredPayload, key);
      expect(res2.status).toBe(422);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toBe('IDEMPOTENCY_BODY_MISMATCH');

      // 3. Database assertion: the altered campaign was NEVER created
      const allCampaigns = await CampaignModel.find({ tenantId });
      expect(allCampaigns.length).toBe(1);
      expect(allCampaigns[0].id).toBe(initialId);
      expect(allCampaigns[0].name).toBe('Birthday Saree First');
    });
  });

  describe('4. Crash Recovery (> 2 Minutes)', () => {
    it('returns 409 if an in-flight request is younger than 2 minutes', async () => {
      const key = 'idemp_young_inflight';
      const payload = { presetId: 'preset_birthday_shopping', name: 'Active In Flight' };

      // Manually create an IN_PROGRESS record updated 30 seconds ago
      await IdempotencyRecordModel.create({
        id: generateId('idemp'),
        tenantId,
        key,
        method: 'POST',
        route: '/api/v1/campaigns',
        requestBodyHash: hashRequestBody(payload),
        status: 'IN_PROGRESS',
        updatedAt: new Date(Date.now() - 30 * 1000)
      });

      const res = await apiPost('/api/v1/campaigns', payload, key);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('currently being processed');
    });

    it('recovers and executes an IN_PROGRESS record older than 2 minutes (crashed instance)', async () => {
      const key = 'idemp_crashed_stale';
      const payload = { presetId: 'preset_birthday_shopping', name: 'Recovered After Crash' };

      // Manually create an IN_PROGRESS record from a simulated crash 3 minutes ago
      const staleTime = new Date(Date.now() - 3 * 60 * 1000);
      const staleRecord = await IdempotencyRecordModel.create({
        id: generateId('idemp'),
        tenantId,
        key,
        method: 'POST',
        route: '/api/v1/campaigns',
        requestBodyHash: hashRequestBody(payload),
        status: 'IN_PROGRESS',
        createdAt: staleTime,
        updatedAt: staleTime
      });

      // Subsequent call recovers the record, executes the handler, and writes COMPLETED cache
      const res = await apiPost('/api/v1/campaigns', payload, key);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.campaign.name).toBe('Recovered After Crash');

      // Database assertion: the existing record was reclaimed and marked COMPLETED
      const updatedRecord = await IdempotencyRecordModel.findOne({ id: staleRecord.id });
      expect(updatedRecord?.status).toBe('COMPLETED');
      expect(updatedRecord?.statusCode).toBe(201);
      expect(updatedRecord?.responseBody?.campaign?.name).toBe('Recovered After Crash');
      expect(updatedRecord?.updatedAt.getTime()).toBeGreaterThan(staleTime.getTime());

      // One campaign was created
      const campCount = await CampaignModel.countDocuments({ tenantId });
      expect(campCount).toBe(1);
    });
  });

  describe('5. Applied Across All Mutation Endpoints', () => {
    it('enforces idempotency key on POST /campaigns/:id/pause, replaying returns cached response', async () => {
      // Setup campaign
      const campId = generateId('cmp');
      await CampaignModel.create({
        id: campId,
        tenantId,
        name: 'Pause Idemp Test',
        status: 'ACTIVE',
        draftVersion: 1,
        pauseGeneration: 0
      });
      await CampaignControlGateModel.create({
        id: generateId('cg'),
        tenantId,
        campaignId: campId,
        paused: false,
        pauseGeneration: 0,
        gateVersion: 1
      });

      // 1. Missing key -> 400
      const resNoKey = await apiPost(`/api/v1/campaigns/${campId}/pause`, {});
      expect(resNoKey.status).toBe(400);
      expect(resNoKey.body.error).toContain('IDEMPOTENCY_KEY_REQUIRED');

      // 2. Initial pause with key
      const key = 'idemp_pause_01';
      const res1 = await apiPost(`/api/v1/campaigns/${campId}/pause`, {}, key);
      expect(res1.status).toBe(200);
      expect(res1.body.campaign.status).toBe('PAUSED');

      // 3. Replay with same key returns cached 200 without double-incrementing pauseGeneration
      const res2 = await apiPost(`/api/v1/campaigns/${campId}/pause`, {}, key);
      expect(res2.status).toBe(200);
      expect(res2.body.campaign.pauseGeneration).toBe(1);

      const dbCamp = await CampaignModel.findOne({ id: campId, tenantId });
      expect(dbCamp?.pauseGeneration).toBe(1);
    });

    it('enforces idempotency key on POST /campaigns/:id/resume', async () => {
      const campId = generateId('cmp');
      await CampaignModel.create({
        id: campId,
        tenantId,
        name: 'Resume Idemp Test',
        status: 'PAUSED',
        draftVersion: 1,
        pauseGeneration: 1
      });
      await CampaignControlGateModel.create({
        id: generateId('cg'),
        tenantId,
        campaignId: campId,
        paused: true,
        pauseGeneration: 1,
        gateVersion: 1
      });

      // Missing key -> 400
      const resNoKey = await apiPost(`/api/v1/campaigns/${campId}/resume`, {});
      expect(resNoKey.status).toBe(400);

      // Valid key -> 200
      const key = 'idemp_resume_01';
      const res = await apiPost(`/api/v1/campaigns/${campId}/resume`, {}, key);
      expect(res.status).toBe(200);
      expect(res.body.campaign.status).toBe('ACTIVE');

      // Replay -> cached 200
      const resReplay = await apiPost(`/api/v1/campaigns/${campId}/resume`, {}, key);
      expect(resReplay.status).toBe(200);
    });

    it('enforces idempotency key on POST /campaigns/:id/archive', async () => {
      const campId = generateId('cmp');
      await CampaignModel.create({
        id: campId,
        tenantId,
        name: 'Archive Idemp Test',
        status: 'ACTIVE',
        draftVersion: 1,
        pauseGeneration: 0
      });

      // Missing key -> 400
      const resNoKey = await apiPost(`/api/v1/campaigns/${campId}/archive`, {});
      expect(resNoKey.status).toBe(400);

      // Valid key -> 200
      const key = 'idemp_archive_01';
      const res = await apiPost(`/api/v1/campaigns/${campId}/archive`, {}, key);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbCamp = await CampaignModel.findOne({ id: campId, tenantId });
      expect(dbCamp?.status).toBe('ARCHIVED');
    });

    it('enforces idempotency key on POST /enrollments/:id/resolve-hold', async () => {
      const enrId = generateId('enr');
      await CampaignEnrollmentModel.create({
        id: enrId,
        tenantId,
        campaignId: 'cmp_hold_test',
        campaignVersionId: 'cv_01',
        customerId: 'cus_hold',
        occurrenceId: 'bday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_hold', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: new Date()
      });

      // Missing key -> 400
      const resNoKey = await apiPost(`/api/v1/enrollments/${enrId}/resolve-hold`, {});
      expect(resNoKey.status).toBe(400);

      // Valid key -> 200
      const key = 'idemp_hold_01';
      const res = await apiPost(`/api/v1/enrollments/${enrId}/resolve-hold`, {}, key);
      expect(res.status).toBe(200);
      expect(res.body.enrollment.replyHoldAt).toBeNull();
      expect(res.body.enrollment.planRevision).toBe(2);

      // Replay -> cached response, planRevision unchanged
      const resReplay = await apiPost(`/api/v1/enrollments/${enrId}/resolve-hold`, {}, key);
      expect(resReplay.status).toBe(200);

      const dbEnr = await CampaignEnrollmentModel.findOne({ id: enrId, tenantId });
      expect(dbEnr?.planRevision).toBe(2);
    });

    it('enforces idempotency key on POST /enrollments/:id/mark-goal', async () => {
      const enrId = generateId('enr');
      await CampaignEnrollmentModel.create({
        id: enrId,
        tenantId,
        campaignId: 'cmp_goal_test',
        campaignVersionId: 'cv_01',
        customerId: 'cus_goal',
        occurrenceId: 'bday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: 'cus_goal', version: 1 },
        planRevision: 1,
        status: 'ACTIVE'
      });

      // Missing key -> 400
      const resNoKey = await apiPost(`/api/v1/enrollments/${enrId}/mark-goal`, { orderRef: 'ord_1' });
      expect(resNoKey.status).toBe(400);

      // Valid key -> 200
      const key = 'idemp_goal_01';
      const res = await apiPost(`/api/v1/enrollments/${enrId}/mark-goal`, { orderRef: 'ord_1' }, key);
      expect(res.status).toBe(200);
      expect(res.body.enrollment.goalReachedAt).toBeDefined();

      // Mismatched body on replay -> 422
      const resMismatch = await apiPost(
        `/api/v1/enrollments/${enrId}/mark-goal`,
        { orderRef: 'ord_different_fraud' },
        key
      );
      expect(resMismatch.status).toBe(422);
      expect(resMismatch.body.error).toBe('IDEMPOTENCY_BODY_MISMATCH');
    });

    it('enforces idempotency key on PATCH /campaign-settings', async () => {
      // Missing key -> 400
      const resNoKey = await apiPatch('/api/v1/campaign-settings', { expectedVersion: 1, timezone: 'Asia/Kolkata' });
      expect(resNoKey.status).toBe(400);

      // Valid key -> 200
      const key = 'idemp_settings_01';
      const res = await apiPatch(
        '/api/v1/campaign-settings',
        { expectedVersion: 1, timezone: 'Asia/Kolkata' },
        key
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Replay with identical body -> cached 200
      const resReplay = await apiPatch(
        '/api/v1/campaign-settings',
        { expectedVersion: 1, timezone: 'Asia/Kolkata' },
        key
      );
      expect(resReplay.status).toBe(200);
    });
  });
});
