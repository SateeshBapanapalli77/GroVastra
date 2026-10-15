import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../src/server';
import mongoose from 'mongoose';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { signInternalServiceToken } from '../src/shared/middleware/internalAuth.middleware';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { UserModel, hashPassword } from '../src/modules/auth/models/User.model';
import { processNextPendingEvent } from '../src/workers/events';

describe('Work Package P0: Security Holes & Verification', () => {
  const tenantA = 'qa_tenant_sec_a';
  const tenantB = 'qa_tenant_sec_b';

  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = 'test_webhook_app_secret_12345';
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function apiPost(path: string, body: any, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  beforeEach(async () => {
    await Promise.all([
      CustomerModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      CampaignModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      CampaignVersionModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      CampaignEnrollmentModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      CampaignExecutionModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      CampaignEventInboxModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      TenantConnectionModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } }),
      UserModel.deleteMany({ tenantId: { $regex: /^qa_tenant_sec/ } })
    ]);
  });

  describe('P0.a: POST /api/v1/webhooks/orders security & goal stop rules', () => {
    it('rejects unauthenticated order webhook requests with 401', async () => {
      const res = await apiPost('/api/v1/webhooks/orders', {
        orderId: 'ord_1',
        customerId: 'cus_1'
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Internal service credential is required');
    });

    it('rejects internal token scoped to wrong event family with 403', async () => {
      const wrongFamilyToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'inventory_svc',
        eventFamily: 'inventory'
      });

      const res = await apiPost(
        '/api/v1/webhooks/orders',
        { orderId: 'ord_1', customerId: 'cus_1' },
        { Authorization: `Bearer ${wrongFamilyToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Credential is scoped for event family 'inventory', but 'orders' is required");
    });

    it('blocks cross-tenant access when request body specifies different tenantId than token', async () => {
      const orderToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'pos_service',
        eventFamily: 'orders'
      });

      const res = await apiPost(
        '/api/v1/webhooks/orders',
        {
          orderId: 'ord_cross',
          customerId: 'cus_cross',
          tenantId: tenantB // Conflict with token tenantA!
        },
        { Authorization: `Bearer ${orderToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Request body tenantId does not match authenticated credential tenant');
    });

    it('sets goal only on enrollments matching occasionRef and respects stopOnGoal=false', async () => {
      const orderToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'pos_service',
        eventFamily: 'orders'
      });

      const customerId = 'cus_lakshmi_p0a';

      // Create Campaign & Version with two steps:
      // Step 1: Followup (stopOnGoal: true)
      // Step 2: Greeting (stopOnGoal: false)
      await CampaignVersionModel.create({
        id: 'cv_p0a',
        tenantId: tenantA,
        campaignId: 'cmp_p0a',
        version: 1,
        name: 'Birthday Sequence',
        status: 'ACTIVE',
        purpose: 'MARKETING',
        trigger: { type: 'ANNUAL_DATE', field: 'customer.birthday' },
        steps: [
          {
            stepId: 'followup',
            offsetDays: -7,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_followup', revision: 1, language: 'en' },
            bindings: {},
            stopOnGoal: true
          },
          {
            stepId: 'greeting',
            offsetDays: 0,
            localTime: '10:00',
            templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
            bindings: {},
            stopOnGoal: false // Explicitly must NOT stop on goal
          }
        ],
        priority: 80,
        timezone: 'Asia/Kolkata',
        reviewFingerprint: 'fp_p0a'
      });

      // Enrollment 1: Matching birthday:2027
      const enrMatched = await CampaignEnrollmentModel.create({
        id: 'enr_bday_2027',
        tenantId: tenantA,
        campaignId: 'cmp_p0a',
        campaignVersionId: 'cv_p0a',
        customerId,
        occurrenceId: 'birthday:2027',
        sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
        status: 'ACTIVE',
        planRevision: 1
      });

      // Enrollment 2: Unrelated anniversary:2026
      const enrUnmatched = await CampaignEnrollmentModel.create({
        id: 'enr_anniv_2026',
        tenantId: tenantA,
        campaignId: 'cmp_p0a',
        campaignVersionId: 'cv_p0a',
        customerId,
        occurrenceId: 'anniversary:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
        status: 'ACTIVE',
        planRevision: 1
      });

      // Executions for matched enrollment
      const exeFollowup = await CampaignExecutionModel.create({
        id: 'exe_followup',
        tenantId: tenantA,
        enrollmentId: enrMatched.id,
        campaignId: 'cmp_p0a',
        stepId: 'followup',
        dueAt: new Date(Date.now() + 86400000),
        expiresAt: new Date(Date.now() + 172800000),
        localDate: '2026-10-21',
        localTime: '10:00',
        state: 'SCHEDULED',
        prerequisite: 'NONE'
      });

      const exeGreeting = await CampaignExecutionModel.create({
        id: 'exe_greeting',
        tenantId: tenantA,
        enrollmentId: enrMatched.id,
        campaignId: 'cmp_p0a',
        stepId: 'greeting',
        dueAt: new Date(Date.now() + 600000000),
        expiresAt: new Date(Date.now() + 700000000),
        localDate: '2026-10-28',
        localTime: '10:00',
        state: 'SCHEDULED',
        prerequisite: 'NONE'
      });

      // Send Order completed for birthday:2027
      const res = await apiPost(
        '/api/v1/webhooks/orders',
        {
          orderId: 'ord_bday_gift_99',
          customerId,
          occasionRef: 'birthday:2027',
          netPaise: 4500000 // Real net price
        },
        { Authorization: `Bearer ${orderToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updatedEnrollments).toBe(1);

      // Assert DB state: Matched enrollment has goal reached
      const refreshedMatched = await CampaignEnrollmentModel.findById(enrMatched._id);
      expect(refreshedMatched?.goalReachedAt).not.toBeNull();
      expect(refreshedMatched?.goalOrderRef).toBe('ord_bday_gift_99');

      // Unmatched enrollment was NOT touched
      const refreshedUnmatched = await CampaignEnrollmentModel.findById(enrUnmatched._id);
      expect(refreshedUnmatched?.goalReachedAt).toBeNull();

      // Step with stopOnGoal=true was skipped
      const refreshedFollowup = await CampaignExecutionModel.findById(exeFollowup._id);
      expect(refreshedFollowup?.state).toBe('SKIPPED');
      expect(refreshedFollowup?.outcomeReason).toBe('SKIPPED_GOAL_REACHED');

      // Step with stopOnGoal=false was PRESERVED in SCHEDULED state
      const refreshedGreeting = await CampaignExecutionModel.findById(exeGreeting._id);
      expect(refreshedGreeting?.state).toBe('SCHEDULED');
    });

    it('order without occasionRef does not fabricate campaign sale or attribute goals (C17)', async () => {
      const orderToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'pos_service',
        eventFamily: 'orders'
      });

      const customerId = 'cus_unrelated_order';
      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_bday_not_attributed',
        tenantId: tenantA,
        campaignId: 'cmp_p0a',
        campaignVersionId: 'cv_p0a',
        customerId,
        occurrenceId: 'birthday:2027',
        sourceRef: { type: 'CUSTOMER_DATE', id: customerId, version: 1 },
        status: 'ACTIVE',
        planRevision: 1
      });

      // General order with no occasion reference
      const res = await apiPost(
        '/api/v1/webhooks/orders',
        {
          orderId: 'ord_general_walkin',
          customerId,
          netPaise: 1200000
          // No occasionRef!
        },
        { Authorization: `Bearer ${orderToken}` }
      );

      expect(res.status).toBe(200);
      expect(res.body.updatedEnrollments).toBe(0);

      const refreshed = await CampaignEnrollmentModel.findById(enr._id);
      expect(refreshed?.goalReachedAt).toBeNull();
    });
  });

  describe('P0.b: POST /internal/campaign-events durable ingestion & quarantine', () => {
    it('persists event before acknowledging, surviving crash recovery (B03)', async () => {
      const eventToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'inventory',
        eventFamily: 'campaign-events'
      });

      const eventId = generateId('evt');
      const res = await apiPost(
        '/api/v1/internal/campaign-events',
        {
          schemaVersion: 1,
          eventId,
          type: 'stock.published',
          producer: 'inventory',
          entityId: 'sku_kanjeevaram_gold',
          entityVersion: 1,
          occurredAt: new Date().toISOString(),
          data: { sku: 'KJ-GLD-01', stockCount: 5 }
        },
        { Authorization: `Bearer ${eventToken}` }
      );

      expect(res.status).toBe(201);
      expect(res.body.eventId).toBe(eventId);

      // Verify DB persistence
      const saved = await CampaignEventInboxModel.findOne({ tenantId: tenantA, eventId });
      expect(saved).not.toBeNull();
      expect(['RECEIVED', 'PROCESSED']).toContain(saved?.status);

      // If simulated crash occurred while RECEIVED, worker recovers it
      if (saved) {
        saved.status = 'RECEIVED';
        await saved.save();

        const recovered = await processNextPendingEvent(tenantA);
        expect(recovered?.eventId).toBe(eventId);
        expect(recovered?.status).toBe('PROCESSED');
      }
    });

    it('sends incompatible or unknown schema to visible QUARANTINE status', async () => {
      const eventToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'crm',
        eventFamily: 'campaign-events'
      });

      const eventId = generateId('evt');
      const res = await apiPost(
        '/api/v1/internal/campaign-events',
        {
          schemaVersion: 99, // Incompatible schema version
          eventId,
          occurredAt: 'invalid-date-not-an-iso-string'
        },
        { Authorization: `Bearer ${eventToken}` }
      );

      expect(res.status).toBe(422);
      expect(res.body.status).toBe('QUARANTINE');

      const saved = await CampaignEventInboxModel.findOne({ tenantId: tenantA, eventId });
      expect(saved).not.toBeNull();
      expect(saved?.status).toBe('QUARANTINE');
      expect(saved?.errorMessage).toContain('INCOMPATIBLE_SCHEMA');
    });

    it('rejects stale entity versions and marks QUARANTINE (spec p.24)', async () => {
      const eventToken = signInternalServiceToken({
        tenantId: tenantA,
        producer: 'inventory',
        eventFamily: 'campaign-events'
      });

      // First, persist higher entity version (version 5)
      await CampaignEventInboxModel.create({
        id: 'evt_v5',
        tenantId: tenantA,
        producer: 'inventory',
        eventId: 'evt_v5',
        type: 'stock.published',
        entityId: 'item_kanjeevaram_ruby',
        entityVersion: 5,
        occurredAt: new Date(),
        status: 'PROCESSED'
      });

      // Now attempt to submit older stale version (version 3)
      const res = await apiPost(
        '/api/v1/internal/campaign-events',
        {
          schemaVersion: 1,
          eventId: 'evt_v3_stale',
          type: 'stock.published',
          producer: 'inventory',
          entityId: 'item_kanjeevaram_ruby',
          entityVersion: 3, // Stale!
          occurredAt: new Date().toISOString(),
          data: { stockCount: 1 }
        },
        { Authorization: `Bearer ${eventToken}` }
      );

      expect(res.status).toBe(409);
      expect(res.body.status).toBe('QUARANTINE');

      const savedStale = await CampaignEventInboxModel.findOne({ tenantId: tenantA, eventId: 'evt_v3_stale' });
      expect(savedStale?.status).toBe('QUARANTINE');
      expect(savedStale?.errorMessage).toContain('STALE_ENTITY_VERSION');
    });
  });

  describe('P0.c: Inbound WhatsApp reply connection-to-tenant mapping & E.164 phone', () => {
    it('scopes inbound customer reply by connection-to-tenant mapping', async () => {
      // 1. Register connection for tenantA
      const connectionId = 'conn_phone_padmavati_01';
      await TenantConnectionModel.create({
        id: generateId('tc'),
        tenantId: tenantA,
        connectionId,
        provider: 'whatsapp_cloud',
        status: 'ACTIVE'
      });

      // 2. Create customer in tenantA with formatted phone
      const customer = await CustomerModel.create({
        id: 'cus_p0c_lakshmi',
        tenantId: tenantA,
        firstName: 'Lakshmi',
        lastName: 'Devi',
        phone: '+919876543210',
        optedInMarketing: true,
        channelSuppressed: false,
        status: 'ACTIVE'
      });

      // Create active enrollment
      const enrollment = await CampaignEnrollmentModel.create({
        id: 'enr_reply_hold',
        tenantId: tenantA,
        campaignId: 'cmp_bday',
        campaignVersionId: 'cv_bday',
        customerId: customer.id,
        occurrenceId: 'birthday:2027',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        status: 'ACTIVE',
        replyHoldAt: null,
        planRevision: 1
      });

      // 3. Receive Meta webhook for this connection with raw 10-digit number
      const { env } = await import('../src/config/env');
      const secret = env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_secret';
      const metaPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_01',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '919876543210',
                    phone_number_id: connectionId // Maps to tenantA!
                  },
                  messages: [
                    {
                      from: '919876543210', // Raw unnormalized phone
                      id: 'wamid.HBgL01M4Z5',
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      text: { body: 'I would love to view the new bridal sarees' },
                      type: 'text'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const rawBody = JSON.stringify(metaPayload);
      const signature = `sha256=${require('crypto').createHmac('sha256', secret).update(rawBody).digest('hex')}`;

      const res = await apiPost(
        '/api/v1/webhooks/whatsapp',
        rawBody,
        { 'x-hub-signature-256': signature }
      );

      expect(res.status).toBe(200);

      // Verify that customer in tenantA was found and replyHoldAt was set
      const refreshedEnr = await CampaignEnrollmentModel.findById(enrollment._id);
      expect(refreshedEnr?.replyHoldAt).not.toBeNull();
    });
  });

  describe('P0.d: Real Authentication, Scoped Tokens & Role Checks', () => {
    it('authenticates boutique owner with real credentials and returns scoped JWT', async () => {
      // Seed user
      await UserModel.create({
        id: 'usr_test_owner',
        tenantId: tenantA,
        username: 'owner@testboutique.com',
        passwordHash: hashPassword('SecretPass123!'),
        name: 'Padmavati',
        role: 'BOUTIQUE_OWNER',
        shopName: 'Padmavati Handlooms'
      });

      // Login
      const res = await apiPost('/api/v1/auth/login', {
        username: 'owner@testboutique.com',
        password: 'SecretPass123!'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('BOUTIQUE_OWNER');
      expect(res.body.user.tenantId).toBe(tenantA);
      expect(res.body.user.shopName).toBe('Padmavati Handlooms');
    });

    it('rejects invalid password with 401', async () => {
      await UserModel.create({
        id: 'usr_test_owner2',
        tenantId: tenantA,
        username: 'owner2@testboutique.com',
        passwordHash: hashPassword('CorrectPass!'),
        name: 'Padmavati',
        role: 'BOUTIQUE_OWNER',
        shopName: 'Padmavati Handlooms'
      });

      const res = await apiPost('/api/v1/auth/login', {
        username: 'owner2@testboutique.com',
        password: 'WrongPassword!'
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid username or password');
    });

    it('role check: STAFF token is blocked from modifying campaigns', async () => {
      const staffToken = signJwt({
        userId: 'usr_staff_01',
        tenantId: tenantA,
        role: 'STAFF'
      });

      const res = await apiPost(
        '/api/v1/campaigns',
        { presetId: 'preset_birthday_shopping' },
        { Authorization: `Bearer ${staffToken}` }
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Role 'STAFF' lacks permission");
    });
  });
});
