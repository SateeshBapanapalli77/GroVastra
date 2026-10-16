import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import app from '../src/server';
import { env } from '../src/config/env';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { TenantSettingsModel } from '../src/modules/campaigns/models/TenantSettings.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import {
  processNextPendingEvent,
  runMultiTenantEventCycle,
  getTenantBacklogMetrics,
  getActiveEventTenants,
  MAX_UNRESOLVED_INTENT_RETRIES
} from '../src/workers/events';
import * as deliveryRecon from '../src/modules/campaigns/services/deliveryStatusReconciliation';

describe('Production Readiness Review Remediation & Verification Suite', () => {
  const tenantA = 'remedy_tenant_a';
  const tenantB = 'remedy_tenant_b';

  let server: http.Server;
  let baseUrl: string;
  let ownerTokenA: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    ownerTokenA = signJwt({
      userId: 'usr_remedy_owner_a',
      tenantId: tenantA,
      role: 'BOUTIQUE_OWNER'
    });

    ownerTokenB = signJwt({
      userId: 'usr_remedy_owner_b',
      tenantId: tenantB,
      role: 'BOUTIQUE_OWNER'
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      TenantSettingsModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } }),
      CustomerModel.deleteMany({ tenantId: { $regex: /^remedy_tenant_/ } })
    ]);
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

  // --------------------------------------------------------------------------
  // SECTION 2: P1 — Frontend Sending-Rule Persistence & Lost-Update Verification
  // --------------------------------------------------------------------------
  describe('2. P1 — Campaign Sending-Rule Persistence & Concurrency', () => {
    it('persists goal and resumePolicy when saving draft, restoring exact values upon reload', async () => {
      // 1. Create a draft campaign
      const createRes = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Padmavati Birthday Special'
      }, ownerTokenA);

      expect(createRes.status).toBe(201);
      const campaignId = createRes.body.campaign.id;
      const initialVersion = createRes.body.campaign.draftVersion; // 1

      // 2. Modify goal and resumePolicy via PATCH /campaigns/:id/draft
      const updatedGoal = {
        type: 'ORDER_COMPLETED',
        windowDays: 21
      };
      const updatedResumePolicy = 'REPLAY_RECENT';

      const patchRes = await apiPatch(`/api/v1/campaigns/${campaignId}/draft`, {
        expectedVersion: initialVersion,
        name: 'Padmavati Birthday Special (Updated)',
        goal: updatedGoal,
        resumePolicy: updatedResumePolicy
      }, ownerTokenA);

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.draftVersion.version).toBe(2);
      expect(patchRes.body.draftVersion.goal.type).toBe('ORDER_COMPLETED');
      expect(patchRes.body.draftVersion.goal.windowDays).toBe(21);
      expect(patchRes.body.draftVersion.resumePolicy).toBe('REPLAY_RECENT');

      // 3. Reload campaign from backend and verify persisted values match exactly
      const getRes = await apiGet(`/api/v1/campaigns/${campaignId}`, ownerTokenA);
      expect(getRes.status).toBe(200);
      expect(getRes.body.latestDraft.goal.type).toBe('ORDER_COMPLETED');
      expect(getRes.body.latestDraft.goal.windowDays).toBe(21);
      expect(getRes.body.latestDraft.resumePolicy).toBe('REPLAY_RECENT');
    });

    it('persists all supported sending-rule settings (importPolicy, enabledBranches, brandName, priority) without lost updates', async () => {
      const createRes = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Boutique Settings Test'
      }, ownerTokenA);
      const campaignId = createRes.body.campaign.id;

      const patchRes = await apiPatch(`/api/v1/campaigns/${campaignId}/draft`, {
        expectedVersion: 1,
        priority: 95,
        brandName: 'Padmavati Heritage Silks',
        importPolicy: 'FUTURE_ONLY',
        enabledBranches: ['flagship_hyderabad', 'jubilee_hills'],
        resumePolicy: 'FUTURE_ONLY'
      }, ownerTokenA);

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.draftVersion.priority).toBe(95);
      expect(patchRes.body.draftVersion.brandName).toBe('Padmavati Heritage Silks');
      expect(patchRes.body.draftVersion.enabledBranches).toEqual(['flagship_hyderabad', 'jubilee_hills']);

      // Reload and assert
      const getRes = await apiGet(`/api/v1/campaigns/${campaignId}`, ownerTokenA);
      expect(getRes.body.latestDraft.priority).toBe(95);
      expect(getRes.body.latestDraft.brandName).toBe('Padmavati Heritage Silks');
      expect(getRes.body.latestDraft.enabledBranches).toEqual(['flagship_hyderabad', 'jubilee_hills']);
    });

    it('enforces expectedVersion concurrency protection: rejects stale draft updates with 409', async () => {
      const createRes = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Concurrency Test'
      }, ownerTokenA);
      const campaignId = createRes.body.campaign.id;

      // First user updates version 1 -> 2
      const user1Res = await apiPatch(`/api/v1/campaigns/${campaignId}/draft`, {
        expectedVersion: 1,
        name: 'User 1 Saved'
      }, ownerTokenA);
      expect(user1Res.status).toBe(200);

      // Concurrent user tries to update version 1 (stale)
      const user2Res = await apiPatch(`/api/v1/campaigns/${campaignId}/draft`, {
        expectedVersion: 1,
        name: 'User 2 Concurrent Overwrite'
      }, ownerTokenA);

      expect(user2Res.status).toBe(409);
      expect(user2Res.body.code).toBe('VERSION_CONFLICT');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: P1 — Multi-Tenant Event Worker Coverage & Fairness
  // --------------------------------------------------------------------------
  describe('3. P1 — Multi-Tenant Event Worker Coverage & Fairness', () => {
    it('processes eligible events for multiple tenants in a single worker run without changing env vars', async () => {
      // Provision active settings for Tenant A and Tenant B
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId: tenantA,
        storeName: 'Padmavati Handlooms',
        allowedHoursStart: '09:00',
        allowedHoursEnd: '21:00'
      });
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId: tenantB,
        storeName: 'Kanchipuram Silks',
        allowedHoursStart: '09:00',
        allowedHoursEnd: '21:00'
      });

      // Insert pending events for both tenants
      await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantA,
        producer: 'inventory',
        eventId: 'evt_a_1',
        type: 'inventory.arrival',
        entityId: 'sku_a_1',
        entityVersion: 1,
        occurredAt: new Date(),
        data: { sku: 'SILK-A', stockCount: 10 },
        status: 'RECEIVED'
      });

      await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantB,
        producer: 'inventory',
        eventId: 'evt_b_1',
        type: 'inventory.arrival',
        entityId: 'sku_b_1',
        entityVersion: 1,
        occurredAt: new Date(),
        data: { sku: 'SILK-B', stockCount: 10 },
        status: 'RECEIVED'
      });

      // Run multi-tenant cycle
      const result = await runMultiTenantEventCycle(5);

      expect(result.tenantsProcessed).toBeGreaterThanOrEqual(2);
      expect(result.totalProcessed).toBe(2);

      const eventA = await CampaignEventInboxModel.findOne({ tenantId: tenantA, eventId: 'evt_a_1' });
      const eventB = await CampaignEventInboxModel.findOne({ tenantId: tenantB, eventId: 'evt_b_1' });

      expect(eventA?.status).toBe('PROCESSED');
      expect(eventB?.status).toBe('PROCESSED');
    });

    it('backlog fairness: large backlog in Tenant A cannot starve Tenant B', async () => {
      // Seed Tenant A with 12 events
      const eventsA = [];
      for (let i = 0; i < 12; i++) {
        eventsA.push({
          id: generateId('evt'),
          tenantId: tenantA,
          producer: 'inventory',
          eventId: `evt_backlog_a_${i}`,
          type: 'inventory.arrival',
          entityId: `sku_a_${i}`,
          entityVersion: 1,
          occurredAt: new Date(),
          data: { sku: `SKU-A-${i}`, stockCount: 5 },
          status: 'RECEIVED'
        });
      }
      await CampaignEventInboxModel.insertMany(eventsA);

      // Seed Tenant B with 1 single event
      await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantB,
        producer: 'inventory',
        eventId: 'evt_single_b_1',
        type: 'inventory.arrival',
        entityId: 'sku_b_single',
        entityVersion: 1,
        occurredAt: new Date(),
        data: { sku: 'SKU-B-01', stockCount: 5 },
        status: 'RECEIVED'
      });

      // Execute one fair round-robin cycle with batchPerTenant = 5
      await runMultiTenantEventCycle(5);

      // Tenant A should have processed 5 events (leaving 7 in backlog)
      const processedACount = await CampaignEventInboxModel.countDocuments({
        tenantId: tenantA,
        status: 'PROCESSED'
      });
      expect(processedACount).toBe(5);

      // Tenant B MUST have processed its 1 event in the very first cycle! No starvation!
      const eventB = await CampaignEventInboxModel.findOne({
        tenantId: tenantB,
        eventId: 'evt_single_b_1'
      });
      expect(eventB?.status).toBe('PROCESSED');
    });

    it('calculates operational queue backlog metrics per tenant (Requirement 10)', async () => {
      const past = new Date(Date.now() - 30000);
      await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantA,
        producer: 'inventory',
        eventId: 'evt_metric_1',
        type: 'inventory.arrival',
        entityId: 'sku_metric_1',
        entityVersion: 1,
        occurredAt: past,
        receivedAt: past,
        data: { sku: 'SKU-METRIC', stockCount: 5 },
        status: 'RECEIVED'
      });

      const metrics = await getTenantBacklogMetrics(tenantA);
      expect(metrics.tenantId).toBe(tenantA);
      expect(metrics.pendingCount).toBe(1);
      expect(metrics.oldestPendingAgeMs).toBeGreaterThanOrEqual(25000);
    });

    it('automatically recovers expired lease claims from crashed workers', async () => {
      const expiredTime = new Date(Date.now() - 120000); // 2 minutes ago
      const crashedEvent = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantA,
        producer: 'inventory',
        eventId: 'evt_crashed_worker',
        type: 'inventory.arrival',
        entityId: 'sku_crashed',
        entityVersion: 1,
        occurredAt: expiredTime,
        receivedAt: expiredTime,
        data: { sku: 'SKU-CRASH', stockCount: 1 },
        status: 'PROCESSING',
        claimToken: 'claim_dead_worker_token',
        claimedUntil: expiredTime // expired lease
      });

      // Worker executes: must sweep expired lease, reset to RECEIVED, and process
      const processed = await processNextPendingEvent(tenantA);
      expect(processed?.id).toBe(crashedEvent.id);
      expect(processed?.status).toBe('PROCESSED');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: P2 — Mandatory Optimistic Concurrency for Campaign Validation
  // --------------------------------------------------------------------------
  describe('4. P2 — Mandatory Optimistic Concurrency for Validation', () => {
    let validCampaignId: string;

    beforeEach(async () => {
      // Provision settings with storeName and connection for valid channel check
      await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId: tenantA,
        storeName: 'Padmavati Handlooms',
        allowedHoursStart: '09:00',
        allowedHoursEnd: '21:00'
      });

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId: tenantA,
        connectionId: 'conn_val_01',
        provider: 'whatsapp_cloud',
        status: 'ACTIVE',
        metadata: { phoneNumberId: 'phone_num_val_01' }
      });

      const createRes = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Validation Test Campaign'
      }, ownerTokenA);

      validCampaignId = createRes.body.campaign.id;
    });

    it('rejects validation requests with missing expectedVersion with HTTP 400', async () => {
      const res = await apiPost(`/api/v1/campaigns/${validCampaignId}/validate`, {}, ownerTokenA);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EXPECTED_VERSION_REQUIRED');
    });

    it('rejects validation requests with invalid version type with HTTP 400', async () => {
      const res = await apiPost(`/api/v1/campaigns/${validCampaignId}/validate`, {
        expectedVersion: '1' // String instead of number
      }, ownerTokenA);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EXPECTED_VERSION_REQUIRED');
    });

    it('rejects validation requests with stale expectedVersion with HTTP 409', async () => {
      const res = await apiPost(`/api/v1/campaigns/${validCampaignId}/validate`, {
        expectedVersion: 99 // Stale / future version
      }, ownerTokenA);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VERSION_CONFLICT');
    });

    it('prevents draft edit racing with validation from falsely validating a newer draft', async () => {
      // Simulate draft edit occurring and incrementing draftVersion from 1 to 2
      await CampaignModel.updateOne(
        { id: validCampaignId, tenantId: tenantA },
        { $set: { draftVersion: 2 } }
      );

      // Validation request was prepared for expectedVersion = 1
      const res = await apiPost(`/api/v1/campaigns/${validCampaignId}/validate`, {
        expectedVersion: 1
      }, ownerTokenA);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VERSION_CONFLICT');

      // The campaign status must NOT be updated to VALIDATED
      const campAfter = await CampaignModel.findOne({ id: validCampaignId, tenantId: tenantA });
      expect(campAfter?.status).toBe('DRAFT');
    });

    it('successfully validates the correct draft revision and transitions status to VALIDATED', async () => {
      const res = await apiPost(`/api/v1/campaigns/${validCampaignId}/validate`, {
        expectedVersion: 1
      }, ownerTokenA);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.draftVersion).toBe(1);

      const campAfter = await CampaignModel.findOne({ id: validCampaignId, tenantId: tenantA });
      expect(campAfter?.status).toBe('VALIDATED');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: P1 — Durable Webhook Processing & Atomic Inbox Claiming
  // --------------------------------------------------------------------------
  describe('5. P1 — Durable Webhook Processing & Atomic Claiming', () => {
    it('concurrent duplicate webhook receipts coordinate via atomic claims without double processing', async () => {
      const phoneNumberId = 'phone_webhook_coordination_' + Date.now();
      const providerMessageId = 'wam_coord_' + Date.now();
      const now = new Date();

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId: tenantA,
        connectionId: 'conn_coord_' + Date.now(),
        provider: 'whatsapp_cloud',
        status: 'ACTIVE',
        metadata: { phoneNumberId }
      });

      const exe = await CampaignExecutionModel.create({
        id: 'exe_coord_' + Date.now(),
        tenantId: tenantA,
        enrollmentId: 'enr_coord_1',
        campaignId: 'cmp_coord_1',
        stepId: 'step_1',
        dueAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        priority: 80,
        planRevision: 1,
        claimVersion: 1,
        state: 'DISPATCHING'
      });

      await CampaignDeliveryIntentModel.create({
        id: 'intent_coord_' + Date.now(),
        tenantId: tenantA,
        executionId: exe.id,
        deliveryKey: exe.id,
        connectionId: 'conn_coord',
        customerId: 'cus_coord_1',
        recipientVersion: 1,
        encryptedRecipient: 'dummy_enc',
        payloadHash: 'hash_coord',
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        state: 'ACCEPTED',
        attemptId: 'att_coord',
        providerMessageId
      });

      const webhookSecret = env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
      const timestampStr = Math.floor(now.getTime() / 1000).toString();
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_coord_test',
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

      // Send two concurrent webhook requests for the exact same event
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
          body: rawBody
        }),
        fetch(`${baseUrl}/api/v1/webhooks/whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
          body: rawBody
        })
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Verify the event was processed cleanly to PROCESSED exactly once
      const statusEventKey = `${providerMessageId}_delivered_${timestampStr}`;
      const inboxDocs = await CampaignEventInboxModel.find({
        tenantId: tenantA,
        eventId: statusEventKey
      });

      expect(inboxDocs.length).toBe(1);
      expect(inboxDocs[0].status).toBe('PROCESSED');

      // Execution state updated monotonically
      const exeAfter = await CampaignExecutionModel.findOne({ id: exe.id, tenantId: tenantA });
      expect(exeAfter?.state).toBe('DELIVERED');
    });

    it('late error cannot overwrite an already PROCESSED state', async () => {
      const inboxEvent = await CampaignEventInboxModel.create({
        id: generateId('evt'),
        tenantId: tenantA,
        producer: 'whatsapp_status_webhook',
        eventId: 'evt_late_err_protection',
        type: 'whatsapp.status.delivered',
        entityId: 'exe_01',
        entityVersion: 1,
        occurredAt: new Date(),
        status: 'PROCESSED',
        processedAt: new Date()
      });

      // Attempting an error transition with { status: { $ne: 'PROCESSED' } } guard
      await CampaignEventInboxModel.updateOne(
        { id: inboxEvent.id, tenantId: tenantA, status: { $ne: 'PROCESSED' } },
        {
          $set: {
            status: 'FAILED',
            errorMessage: 'Simulated late async error'
          }
        }
      );

      // PROCESSED must remain untouched!
      const after = await CampaignEventInboxModel.findOne({ id: inboxEvent.id });
      expect(after?.status).toBe('PROCESSED');
      expect(after?.errorMessage).toBeNull();
    });

    it('cross-tenant message ID security: Tenant A connection cannot mutate Tenant B records', async () => {
      const phoneA = 'phone_tenant_a_' + Date.now();
      const phoneB = 'phone_tenant_b_' + Date.now();
      const providerMsgB = 'wam_tenant_b_msg_' + Date.now();
      const now = new Date();

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId: tenantA,
        connectionId: 'conn_a_' + Date.now(),
        provider: 'whatsapp_cloud',
        status: 'ACTIVE',
        metadata: { phoneNumberId: phoneA }
      });

      await TenantConnectionModel.create({
        id: generateId('conn'),
        tenantId: tenantB,
        connectionId: 'conn_b_' + Date.now(),
        provider: 'whatsapp_cloud',
        status: 'ACTIVE',
        metadata: { phoneNumberId: phoneB }
      });

      const exeB = await CampaignExecutionModel.create({
        id: 'exe_b_' + Date.now(),
        tenantId: tenantB,
        enrollmentId: 'enr_b_1',
        campaignId: 'cmp_b_1',
        stepId: 'step_1',
        dueAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
        localDate: '2026-10-16',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        priority: 80,
        planRevision: 1,
        claimVersion: 1,
        state: 'DISPATCHING'
      });

      await CampaignDeliveryIntentModel.create({
        id: 'intent_b_' + Date.now(),
        tenantId: tenantB,
        executionId: exeB.id,
        deliveryKey: exeB.id,
        connectionId: 'conn_b',
        customerId: 'cus_b_1',
        recipientVersion: 1,
        encryptedRecipient: 'dummy_enc',
        payloadHash: 'hash_b',
        templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
        state: 'ACCEPTED',
        attemptId: 'att_b',
        providerMessageId: providerMsgB
      });

      // Tenant A submits a webhook referring to Tenant B's message ID using Tenant A's connection
      const webhookSecret = env.WHATSAPP_APP_SECRET || 'test_webhook_app_secret_audit';
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_cross_test',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: phoneA }, // Belongs to Tenant A
                  statuses: [{ id: providerMsgB, status: 'delivered', timestamp: Math.floor(now.getTime() / 1000).toString() }]
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
      expect(res.status).toBe(200);

      // Verify Tenant B's execution and intent were completely UNTOUCHED
      const exeBAfter = await CampaignExecutionModel.findOne({ id: exeB.id, tenantId: tenantB });
      const intentBAfter = await CampaignDeliveryIntentModel.findOne({ providerMessageId: providerMsgB, tenantId: tenantB });
      expect(exeBAfter?.state).toBe('DISPATCHING');
      expect(intentBAfter?.state).toBe('ACCEPTED');
    });
  });
});
