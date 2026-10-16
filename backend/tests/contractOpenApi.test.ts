import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import mongoose from 'mongoose';
import app from '../src/server';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import { connectDatabase } from '../src/config/database';
import { TenantSettingsModel, REQUIRED_SETTINGS_NOTICE } from '../src/modules/campaigns/models/TenantSettings.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { CAMPAIGN_REASON_CODES } from '../src/shared/reasonCodes';
import { webhookRouter, campaignRouter } from '../src/modules/campaigns';
import { authRouter } from '../src/modules/auth/routes/auth.routes';

describe('Step 12: OpenAPI API Contract Freeze & Response Drift Tests', () => {
  const tenantId = 'qa_tenant_contract_freeze';
  let server: http.Server;
  let baseUrl: string;
  let ownerToken: string;
  let staffToken: string;
  let openApiDoc: any;

  beforeAll(async () => {
    await connectDatabase();

    // Read and parse canonical OpenAPI contract
    const openApiPath = path.resolve(__dirname, '../../docs/openapi.yaml');
    expect(fs.existsSync(openApiPath)).toBe(true);
    const rawYaml = fs.readFileSync(openApiPath, 'utf-8');
    openApiDoc = YAML.parse(rawYaml);
    expect(openApiDoc).toBeDefined();
    expect(openApiDoc.openapi).toBe('3.0.3');
    expect(openApiDoc.paths).toBeDefined();

    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

    ownerToken = signJwt({
      userId: 'usr_owner_contract',
      tenantId,
      role: 'BOUTIQUE_OWNER'
    });

    staffToken = signJwt({
      userId: 'usr_staff_contract',
      tenantId,
      role: 'STAFF'
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(async () => {
    await TenantSettingsModel.deleteMany({ tenantId });
    await TenantConnectionModel.deleteMany({ tenantId });
  });

  // Helper function to extract routes from Express routers
  function getAllApiV1Routes(): { method: string; path: string }[] {
    const routes: { method: string; path: string }[] = [];

    // Health route mounted on app directly
    routes.push({ method: 'GET', path: '/health' });

    function collectFromRouter(router: any) {
      for (const layer of router.stack || []) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
          for (const method of methods) {
            routes.push({ method: method.toUpperCase(), path: layer.route.path });
          }
        }
      }
    }

    collectFromRouter(webhookRouter);
    collectFromRouter(authRouter);
    collectFromRouter(campaignRouter);

    return routes;
  }

  // Helper function to validate schema shape against OpenAPI components
  function validateObjectAgainstSchema(obj: any, schema: any, requiredKeysOverride?: string[]) {
    expect(typeof obj).toBe('object');
    expect(obj).not.toBeNull();

    const requiredKeys = requiredKeysOverride || schema.required || [];
    for (const key of requiredKeys) {
      expect(obj, `Missing required property '${key}' in response`).toHaveProperty(key);
      expect(obj[key], `Property '${key}' must not be undefined`).not.toBeUndefined();
    }
  }

  it('1. Route Coverage: Every mounted express route exists in docs/openapi.yaml', () => {
    const apiRoutes = getAllApiV1Routes();
    expect(apiRoutes.length).toBeGreaterThan(0);

    // Normalize express :param to openapi {param}
    function normalizeExpressPath(p: string): string {
      return p.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    }

    for (const r of apiRoutes) {
      const normalized = normalizeExpressPath(r.path);
      const openApiPathObj = openApiDoc.paths[normalized];

      expect(
        openApiPathObj,
        `Route ${r.method} ${r.path} (${normalized}) is mounted in Express but missing from docs/openapi.yaml`
      ).toBeDefined();

      const methodKey = r.method.toLowerCase();
      expect(
        openApiPathObj[methodKey],
        `Method ${r.method} on path ${normalized} is mounted in Express but missing from docs/openapi.yaml`
      ).toBeDefined();
    }
  });

  it('2. Reason Codes: GET /campaign-reason-codes adheres to OpenAPI contract and contains all system codes', async () => {
    const res = await fetch(`${baseUrl}/campaign-reason-codes`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(Array.isArray(body.reasonCodes)).toBe(true);
    expect(body.reasonCodes.length).toBeGreaterThanOrEqual(CAMPAIGN_REASON_CODES.length);

    const schema = openApiDoc.components.schemas.ReasonCodeDefinition;
    expect(schema).toBeDefined();

    const validCategories = schema.properties.category.enum;
    const validOwners = schema.properties.resolutionOwner.enum;

    for (const item of body.reasonCodes) {
      validateObjectAgainstSchema(item, schema);
      expect(validCategories).toContain(item.category);
      expect(validOwners).toContain(item.resolutionOwner);
      expect(typeof item.ownerMessage).toBe('string');
      expect(item.ownerMessage.length).toBeGreaterThan(0);
    }

    // Verify presence of core reason codes across all 4 categories
    const codes = body.reasonCodes.map((r: any) => r.code);
    expect(codes).toContain('SKIPPED_MARKETING_OPT_OUT');
    expect(codes).toContain('SKIPPED_GOAL_REACHED');
    expect(codes).toContain('SKIPPED_REPLY_HOLD');
    expect(codes).toContain('DEFERRED_OUTSIDE_ALLOWED_HOURS');
    expect(codes).toContain('DEFERRED_CONTACT_CAP');
    expect(codes).toContain('BLOCKED_MISSING_VARIABLE_BINDING');
    expect(codes).toContain('BLOCKED_NO_TENANT_CONNECTION');
    expect(codes).toContain('FAILED_DISPATCH_TIMEOUT');
    expect(codes).toContain('FAILED_PROVIDER_REJECTED');
  });

  it('3. Integration Readiness: GET /integration-readiness returns connection status, templates, and missing config (DB-backed)', async () => {
    // Phase A: Unconfigured state
    const unconfRes = await fetch(`${baseUrl}/integration-readiness`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(unconfRes.status).toBe(200);
    const unconfBody = await unconfRes.json();

    expect(unconfBody.success).toBe(true);
    expect(unconfBody.ready).toBe(false);
    expect(unconfBody.connection.status).toBe('NOT_PROVISIONED');
    expect(unconfBody.missingConfiguration).toContain('WHATSAPP_CONNECTION_NOT_PROVISIONED');
    expect(unconfBody.missingConfiguration).toContain('STORE_NAME_NOT_CONFIGURED');
    expect(Array.isArray(unconfBody.templates)).toBe(true);
    expect(unconfBody.templates.length).toBeGreaterThan(0);

    // Phase B: Provision DB state (MongoMemoryReplSet)
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId: 'conn_ready_test',
      provider: 'whatsapp_cloud',
      status: 'ACTIVE',
      metadata: {
        phoneNumberId: 'phone_ready_123',
        verifiedName: 'Sitaram Silks'
      }
    });

    await TenantSettingsModel.create({
      id: generateId('set'),
      tenantId,
      version: 1,
      storeName: 'Sitaram Silks Varanasi',
      timezone: 'Asia/Kolkata',
      allowedHours: { start: '10:00', end: '19:00' },
      caps: { marketing24h: 1, marketing7d: 3 },
      globalPause: false,
      outageGraceMinutes: 120,
      leapDayPolicy: 'FEB_28',
      holidays: [],
      blackouts: [],
      notice: REQUIRED_SETTINGS_NOTICE
    });

    // Assert DB persistence
    const savedConn = await TenantConnectionModel.findOne({ tenantId, status: 'ACTIVE' });
    expect(savedConn).not.toBeNull();
    expect(savedConn!.connectionId).toBe('conn_ready_test');

    const savedSettings = await TenantSettingsModel.findOne({ tenantId });
    expect(savedSettings).not.toBeNull();
    expect(savedSettings!.storeName).toBe('Sitaram Silks Varanasi');

    // Phase C: Re-check readiness after DB provision
    const readyRes = await fetch(`${baseUrl}/integration-readiness`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(readyRes.status).toBe(200);
    const readyBody = await readyRes.json();

    expect(readyBody.success).toBe(true);
    expect(readyBody.ready).toBe(true);
    expect(readyBody.missingConfiguration).toHaveLength(0);
    expect(readyBody.connection.status).toBe('ACTIVE');
    expect(readyBody.connection.connectionId).toBe('conn_ready_test');
    expect(readyBody.connection.phoneNumberId).toBe('phone_ready_123');
    expect(readyBody.connection.verifiedName).toBe('Sitaram Silks');

    const readinessSchema = openApiDoc.components.schemas.IntegrationReadiness;
    validateObjectAgainstSchema(readyBody, readinessSchema);
  });

  it('4. Canonical Settings Schema: GET & PATCH /campaign-settings adhere to canonical schema and notice lock', async () => {
    // Seed initial settings document in DB
    const initialSettings = await TenantSettingsModel.create({
      id: generateId('set'),
      tenantId,
      version: 1,
      storeName: 'Aura Banaras',
      timezone: 'Asia/Kolkata',
      allowedHours: { start: '10:00', end: '19:00' },
      caps: { marketing24h: 1, marketing7d: 3 },
      globalPause: false,
      outageGraceMinutes: 120,
      leapDayPolicy: 'FEB_28',
      holidays: ['2026-10-20'],
      blackouts: ['2026-11-01'],
      notice: REQUIRED_SETTINGS_NOTICE
    });

    // 1. GET Settings
    const getRes = await fetch(`${baseUrl}/campaign-settings`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();

    expect(getBody.success).toBe(true);
    const settingsSchema = openApiDoc.components.schemas.TenantSettings;
    validateObjectAgainstSchema(getBody.settings, settingsSchema);

    expect(getBody.settings.storeName).toBe('Aura Banaras');
    expect(getBody.settings.version).toBe(1);
    expect(getBody.settings.allowedHours).toEqual({ start: '10:00', end: '19:00' });
    expect(getBody.settings.caps).toEqual({ marketing24h: 1, marketing7d: 3 });
    expect(getBody.settings.leapDayPolicy).toBe('FEB_28');
    expect(getBody.settings.notice).toBe(REQUIRED_SETTINGS_NOTICE);

    // 2. PATCH Settings - Missing expectedVersion (must fail with 400 and error shape)
    const badPatchRes = await fetch(`${baseUrl}/campaign-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'Idempotency-Key': 'idemp_contract_patch_fail'
      },
      body: JSON.stringify({ storeName: 'New Name' })
    });
    expect(badPatchRes.status).toBe(400);
    const badPatchBody = await badPatchRes.json();
    expect(badPatchBody.success).toBe(false);
    expect(badPatchBody.code).toBe('EXPECTED_VERSION_REQUIRED');
    expect(badPatchBody.fieldPath).toBe('expectedVersion');

    // 3. PATCH Settings - Version Conflict (must fail with 409 and error shape)
    const conflictPatchRes = await fetch(`${baseUrl}/campaign-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'Idempotency-Key': 'idemp_contract_patch_conflict'
      },
      body: JSON.stringify({ expectedVersion: 999, storeName: 'Conflict Name' })
    });
    expect(conflictPatchRes.status).toBe(409);
    const conflictBody = await conflictPatchRes.json();
    expect(conflictBody.success).toBe(false);
    expect(conflictBody.code).toBe('VERSION_CONFLICT');
    expect(conflictBody.fieldPath).toBe('expectedVersion');

    // 4. PATCH Settings - Valid update (must succeed and increment version)
    const validPatchRes = await fetch(`${baseUrl}/campaign-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'Idempotency-Key': 'idemp_contract_patch_success'
      },
      body: JSON.stringify({
        expectedVersion: 1,
        storeName: 'Aura Banaras Flagship',
        caps: { marketing24h: 2, marketing7d: 5 }
      })
    });
    expect(validPatchRes.status).toBe(200);
    const validPatchBody = await validPatchRes.json();
    expect(validPatchBody.success).toBe(true);
    validateObjectAgainstSchema(validPatchBody.settings, settingsSchema);

    expect(validPatchBody.settings.version).toBe(2);
    expect(validPatchBody.settings.storeName).toBe('Aura Banaras Flagship');
    expect(validPatchBody.settings.caps).toEqual({ marketing24h: 2, marketing7d: 5 });
    expect(validPatchBody.settings.notice).toBe(REQUIRED_SETTINGS_NOTICE);

    // Verify Database state
    const dbSettings = await TenantSettingsModel.findOne({ tenantId });
    expect(dbSettings!.version).toBe(2);
    expect(dbSettings!.storeName).toBe('Aura Banaras Flagship');
    expect(dbSettings!.caps.marketing24h).toBe(2);
    expect(dbSettings!.notice).toBe(REQUIRED_SETTINGS_NOTICE);
  });

  it('5. Universal Error Shape: All error responses conform to { success: false, error, code, fieldPath? }', async () => {
    const errorSchema = openApiDoc.components.schemas.StandardError;
    expect(errorSchema).toBeDefined();

    // Case A: 401 Missing Authentication
    const authFailRes = await fetch(`${baseUrl}/campaign-settings`);
    expect(authFailRes.status).toBe(401);
    const authFailBody = await authFailRes.json();
    validateObjectAgainstSchema(authFailBody, errorSchema);
    expect(authFailBody.success).toBe(false);
    expect(typeof authFailBody.code).toBe('string');
    expect(typeof authFailBody.error).toBe('string');

    // Case B: 403 Forbidden Role
    const roleFailRes = await fetch(`${baseUrl}/campaign-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
        'Idempotency-Key': 'idemp_staff_forbidden'
      },
      body: JSON.stringify({ expectedVersion: 1, storeName: 'Hacked' })
    });
    expect(roleFailRes.status).toBe(403);
    const roleFailBody = await roleFailRes.json();
    validateObjectAgainstSchema(roleFailBody, errorSchema);
    expect(roleFailBody.success).toBe(false);
    expect(typeof roleFailBody.code).toBe('string');

    // Case C: 404 Route Not Found
    const notFoundRes = await fetch(`${baseUrl}/non-existent-contract-route`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(notFoundRes.status).toBe(404);
    const notFoundBody = await notFoundRes.json();
    validateObjectAgainstSchema(notFoundBody, errorSchema);
    expect(notFoundBody.success).toBe(false);
    expect(notFoundBody.code).toBe('NOT_FOUND');

    // Case D: 400 Missing Required Field with fieldPath
    const loginFailRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'someone' })
    });
    expect(loginFailRes.status).toBe(400);
    const loginFailBody = await loginFailRes.json();
    validateObjectAgainstSchema(loginFailBody, errorSchema);
    expect(loginFailBody.success).toBe(false);
    expect(loginFailBody.code).toBe('MISSING_CREDENTIALS');
    expect(loginFailBody.fieldPath).toBe('password');
  });

  it('6. Drift Detection: Validator fails if a response drifts or omits a required schema field', () => {
    const errorSchema = openApiDoc.components.schemas.StandardError;

    // Drifting response missing 'code'
    const driftingResponse = {
      success: false,
      error: 'Some error occurred'
    };

    expect(() => {
      validateObjectAgainstSchema(driftingResponse, errorSchema);
    }).toThrow(/Missing required property 'code'/);

    // Drifting settings missing 'notice'
    const driftingSettings = {
      id: 'set_123',
      version: 1,
      storeName: 'Test',
      timezone: 'Asia/Kolkata',
      allowedHours: { start: '10:00', end: '19:00' },
      caps: { marketing24h: 1, marketing7d: 3 },
      globalPause: false,
      outageGraceMinutes: 120,
      leapDayPolicy: 'FEB_28',
      holidays: [],
      blackouts: []
      // missing notice!
    };
    const settingsSchema = openApiDoc.components.schemas.TenantSettings;
    expect(() => {
      validateObjectAgainstSchema(driftingSettings, settingsSchema);
    }).toThrow(/Missing required property 'notice'/);
  });

  it('7. DB State Verification: Domain event and order webhook mutate MongoDB and adhere to OpenAPI contract', async () => {
    const { CampaignEventInboxModel } = await import('../src/modules/campaigns/models/CampaignEventInbox.model');
    const { CampaignEnrollmentModel } = await import('../src/modules/campaigns/models/CampaignEnrollment.model');
    const { CustomerModel } = await import('../src/modules/crm/models/Customer.model');
    const { mintServiceToken } = await import('../src/scripts/mintServiceToken');

    const customerId = 'cus_contract_test';
    const orderCredential = mintServiceToken({
      producer: 'orders_service',
      tenantId,
      eventFamily: 'orders'
    });

    const eventCredential = mintServiceToken({
      producer: 'inventory_service',
      tenantId,
      eventFamily: 'campaign-events'
    });

    // 1. Seed customer and active campaign enrollment in MongoDB
    await CustomerModel.create({
      id: customerId,
      tenantId,
      phone: '+919876543210',
      firstName: 'Priya',
      lastName: 'Sharma',
      status: 'ACTIVE'
    });

    const enrollmentId = generateId('enr');
    await CampaignEnrollmentModel.create({
      id: enrollmentId,
      tenantId,
      campaignId: 'cmp_contract',
      campaignVersionId: 'ver_contract',
      customerId,
      occurrenceId: 'occ_contract_01',
      sourceRef: {
        id: 'ord_ref_01',
        type: 'ORDER_EVENT'
      },
      status: 'ACTIVE',
      occasionDate: '10-25',
      occasionLocalDate: '2026-10-25',
      planRevision: 1,
      goalReachedAt: null
    });

    // 2. Ingest domain event via POST /internal/campaign-events
    const eventPayload = {
      schemaVersion: 1,
      eventId: `evt_${Date.now()}`,
      type: 'inventory.arrival',
      producer: 'inventory_service',
      entityId: 'SKU_CONTRACT_01',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      customerId,
      data: { sku: 'SKU_CONTRACT_01', stockCount: 10 }
    };

    const eventRes = await fetch(`${baseUrl}/internal/campaign-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': eventCredential
      },
      body: JSON.stringify(eventPayload)
    });

    expect(eventRes.status).toBe(201);
    const eventBody = await eventRes.json();
    expect(eventBody.success).toBe(true);

    // Assert DB state in MongoMemoryReplSet: event inbox record persisted
    const savedEvent = await CampaignEventInboxModel.findOne({ tenantId, eventId: eventPayload.eventId });
    expect(savedEvent).not.toBeNull();
    expect(['RECEIVED', 'PROCESSED']).toContain(savedEvent!.status);
    expect(savedEvent!.entityId).toBe('SKU_CONTRACT_01');

    // 3. Trigger order webhook via POST /webhooks/orders
    const orderRes = await fetch(`${baseUrl}/webhooks/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': orderCredential
      },
      body: JSON.stringify({
        orderId: 'ord_contract_goal_01',
        customerId,
        occasionRef: 'occ_contract_01',
        netPaise: 450000
      })
    });

    expect(orderRes.status).toBe(200);
    const orderBody = await orderRes.json();
    expect(orderBody.success).toBe(true);
    expect(orderBody.updatedEnrollments).toBe(1);
    expect(orderBody.enrollmentIds).toContain(enrollmentId);

    // Assert DB state in MongoMemoryReplSet: enrollment goal marked
    const updatedEnrollment = await CampaignEnrollmentModel.findOne({ id: enrollmentId, tenantId });
    expect(updatedEnrollment).not.toBeNull();
    expect(updatedEnrollment!.goalReachedAt).not.toBeNull();
    expect(updatedEnrollment!.goalOrderRef).toBe('ord_contract_goal_01');
  });
});
