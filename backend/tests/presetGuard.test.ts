import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../src/server';
import { generateId } from '../src/shared/utils/id';
import { signJwt } from '../src/shared/middleware/auth.middleware';
import {
  BOUTIQUE_CAMPAIGN_PRESETS,
  getCampaignPreset,
  isPresetImplemented,
  isScannerImplemented,
  isAnnualPlannerImplemented,
  CampaignPreset
} from '../src/modules/campaigns/presets/boutiquePresets';
import { EVENT_REGISTRY, getEventDefinition } from '../src/shared/events/registry';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel, ICampaignVersion } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignDryRunModel } from '../src/modules/campaigns/models/CampaignDryRun.model';
import { TenantConnectionModel } from '../src/modules/campaigns/models/TenantConnection.model';
import { evaluateCampaignDryRun } from '../src/modules/campaigns/engine/dryRun';

describe('Step 10: Preset Capability Flag, Activation Guard & CI Consumer Verification', () => {
  const tenantId = 'qa_tenant_preset_guard';
  let server: http.Server;
  let baseUrl: string;
  let ownerToken: string;

  beforeAll(async () => {
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    ownerToken = signJwt({
      userId: 'usr_owner_preset',
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
    await CampaignModel.deleteMany({ tenantId });
    await CampaignVersionModel.deleteMany({ tenantId });
    await CampaignDryRunModel.deleteMany({ tenantId });
    await TenantConnectionModel.deleteMany({ tenantId });

    // Provision active WhatsApp connection for tenant
    await TenantConnectionModel.create({
      id: generateId('conn'),
      tenantId,
      connectionId: 'conn_preset_guard',
      wabaId: 'waba_guard',
      phoneNumberId: 'phone_guard',
      displayPhoneNumber: '+919876543210',
      status: 'ACTIVE',
      active: true
    });
  });

  async function apiGet(path: string, token: string = ownerToken) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async function apiPost(path: string, body: any, token: string = ownerToken) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': generateId('idemp')
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  // Helper verifying a preset has a valid registered consumer
  function assertPresetHasRegisteredConsumer(preset: CampaignPreset) {
    if (!preset.implemented) return;

    expect(Array.isArray(preset.requiredData)).toBe(true);
    expect(preset.requiredData.length).toBeGreaterThan(0);
    expect(Array.isArray(preset.requiredEvents)).toBe(true);

    if (preset.trigger.type === 'EVENT_DRIVEN') {
      expect(preset.requiredEvents.length).toBeGreaterThan(0);
      for (const eventType of preset.requiredEvents) {
        const def = getEventDefinition(eventType);
        expect(def, `Event type '${eventType}' for preset '${preset.id}' must exist in EVENT_REGISTRY`).toBeDefined();
        expect(
          typeof def?.evaluator,
          `Event type '${eventType}' evaluator must be an executable function`
        ).toBe('function');
      }
    } else if (preset.trigger.type === 'INACTIVITY_SCAN') {
      expect(
        isScannerImplemented(),
        `Scanner worker evaluator must be implemented for preset '${preset.id}'`
      ).toBe(true);
    } else if (preset.trigger.type === 'ANNUAL_DATE') {
      expect(
        isAnnualPlannerImplemented(preset.trigger.field),
        `Annual planner must handle field '${preset.trigger.field}' for preset '${preset.id}'`
      ).toBe(true);
    } else {
      throw new Error(`Unsupported trigger type '${preset.trigger.type}' on preset '${preset.id}'`);
    }
  }

  describe('1. CI Consumer Registration Invariant', () => {
    it('fails CI if any preset is marked implemented but has no registered consumer', () => {
      // 1. Validate all boutique presets
      expect(BOUTIQUE_CAMPAIGN_PRESETS.length).toBeGreaterThan(0);

      const implementedPresets = BOUTIQUE_CAMPAIGN_PRESETS.filter((p) => p.implemented);
      expect(implementedPresets.length).toBeGreaterThan(0);

      for (const preset of implementedPresets) {
        assertPresetHasRegisteredConsumer(preset);
      }
    });

    it('verifies that an unimplemented preset cannot be marked implemented without an evaluator', () => {
      // Hypothetical preset requiring an unregistered domain event
      const fakePreset: CampaignPreset = {
        id: 'preset_fake_unregistered',
        name: 'Fake Unregistered Preset',
        category: 'MERCHANDISE',
        purpose: 'MARKETING',
        description: 'Test fake preset',
        defaultPriority: 50,
        trigger: {
          type: 'EVENT_DRIVEN',
          eventType: 'unknown.bogus_event'
        },
        defaultSteps: [],
        requiredEvents: ['unknown.bogus_event'],
        requiredData: ['customer.firstName'],
        implemented: true // Illegally claiming implemented
      };

      // Our CI validator MUST catch and reject this
      expect(() => assertPresetHasRegisteredConsumer(fakePreset)).toThrow(
        /must exist in EVENT_REGISTRY/
      );

      // And dynamic isPresetImplemented MUST evaluate to false
      expect(isPresetImplemented(fakePreset)).toBe(false);
    });

    it('computes implemented dynamically so capability cannot drift from reality', () => {
      const browsePreset = getCampaignPreset('preset_abandoned_browse');
      expect(browsePreset).toBeDefined();
      expect(browsePreset?.implemented).toBe(false);

      const carePreset = getCampaignPreset('preset_care_renewal');
      expect(carePreset).toBeDefined();
      expect(carePreset?.implemented).toBe(false);

      const bdayPreset = getCampaignPreset('preset_birthday_shopping');
      expect(bdayPreset).toBeDefined();
      expect(bdayPreset?.implemented).toBe(true);

      const restockPreset = getCampaignPreset('preset_restock_alert');
      expect(restockPreset).toBeDefined();
      expect(restockPreset?.implemented).toBe(true);

      const winbackPreset = getCampaignPreset('preset_winback_inactive');
      expect(winbackPreset).toBeDefined();
      expect(winbackPreset?.implemented).toBe(true);
    });
  });

  describe('2. GET /campaign-presets Endpoint', () => {
    it('returns presets with implemented, requiredEvents, and requiredData fields', async () => {
      const res = await apiGet('/api/v1/campaign-presets');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.presets)).toBe(true);

      const presets: CampaignPreset[] = res.body.presets;
      expect(presets.length).toBe(BOUTIQUE_CAMPAIGN_PRESETS.length);

      for (const p of presets) {
        expect(typeof p.implemented).toBe('boolean');
        expect(Array.isArray(p.requiredEvents)).toBe(true);
        expect(Array.isArray(p.requiredData)).toBe(true);
      }

      // Verify presence of both implemented and unimplemented presets
      const implemented = presets.filter((p) => p.implemented);
      const unimplemented = presets.filter((p) => !p.implemented);

      expect(implemented.length).toBeGreaterThan(0);
      expect(unimplemented.length).toBeGreaterThan(0);

      // Verify specific expected preset
      const bday = presets.find((p) => p.id === 'preset_birthday_shopping');
      expect(bday?.implemented).toBe(true);
      expect(bday?.requiredEvents).toEqual([]);
      expect(bday?.requiredData).toContain('customer.birthday');

      const browse = presets.find((p) => p.id === 'preset_abandoned_browse');
      expect(browse?.implemented).toBe(false);
      expect(browse?.requiredEvents).toContain('catalog.browse_abandoned');
    });
  });

  describe('3. POST /campaigns Preset Activation Guard', () => {
    it('rejects creating a campaign from an unimplemented preset with 422 PRESET_NOT_IMPLEMENTED', async () => {
      const res = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_abandoned_browse',
        name: 'My Abandoned Browse Campaign'
      });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('PRESET_NOT_IMPLEMENTED');

      // Database assertion: zero campaigns created for this preset
      const count = await CampaignModel.countDocuments({
        tenantId,
        presetId: 'preset_abandoned_browse'
      });
      expect(count).toBe(0);
    });

    it('rejects an unknown or unregistered preset with 422 PRESET_NOT_IMPLEMENTED', async () => {
      const res = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_completely_fictional_999'
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('PRESET_NOT_IMPLEMENTED');
    });

    it('successfully creates a campaign from an implemented preset with 201 Created and persists presetId', async () => {
      const res = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Padmavati Birthday Special'
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.campaign.id).toBeDefined();

      // Database assertion: campaign document persisted with presetId
      const savedCampaign = await CampaignModel.findOne({
        id: res.body.campaign.id,
        tenantId
      });
      expect(savedCampaign).not.toBeNull();
      expect(savedCampaign?.presetId).toBe('preset_birthday_shopping');
      expect(savedCampaign?.status).toBe('DRAFT');

      const savedVersion = await CampaignVersionModel.findOne({
        campaignId: res.body.campaign.id,
        tenantId
      });
      expect(savedVersion).not.toBeNull();
      expect(savedVersion?.presetId).toBe('preset_birthday_shopping');
    });
  });

  describe('4. POST /campaigns/:id/activate Guard', () => {
    it('rejects activation with 422 PRESET_NOT_IMPLEMENTED if campaign has an unimplemented preset', async () => {
      // 1. Directly insert a draft campaign with an unimplemented presetId
      const campId = generateId('cmp');
      const verId = generateId('cv');

      await CampaignModel.create({
        id: campId,
        tenantId,
        presetId: 'preset_care_renewal',
        name: 'Heirloom Care Campaign',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        status: 'DRAFT',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const draft = await CampaignVersionModel.create({
        id: verId,
        tenantId,
        campaignId: campId,
        presetId: 'preset_care_renewal',
        version: 1,
        name: 'Heirloom Care Campaign',
        industry: 'BOUTIQUE',
        purpose: 'ORDER_SERVICE',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'wardrobe.care_due' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'care_step',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_alteration_ready', revision: 1, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 40,
        publishedBy: 'tester',
        reviewFingerprint: 'fp_unimplemented'
      });

      // 2. Persist real dry run report
      await CampaignDryRunModel.create({
        id: generateId('dry'),
        tenantId,
        campaignId: campId,
        draftVersion: 1,
        draftFingerprint: 'fp_unimplemented',
        summary: { totalEvaluated: 5, eligibleCount: 5, excludedCount: 0 },
        reasonBreakdown: {},
        samplePlans: []
      });

      // 3. Attempt activation
      const res = await apiPost(`/api/v1/campaigns/${campId}/activate`, {
        expectedVersion: 1,
        reviewFingerprint: 'fp_unimplemented'
      });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('PRESET_NOT_IMPLEMENTED');
      expect(res.body.message).toContain('preset_care_renewal');

      // Database assertion: campaign remains DRAFT and unactivated
      const campDb = await CampaignModel.findOne({ id: campId, tenantId });
      expect(campDb?.status).toBe('DRAFT');
      expect(campDb?.activeVersionId).toBeNull();
    });

    it('rejects activation with 422 PRESET_NOT_IMPLEMENTED if draft trigger event has no registered evaluator', async () => {
      const campId = generateId('cmp');
      const verId = generateId('cv');

      await CampaignModel.create({
        id: campId,
        tenantId,
        name: 'Unregistered Event Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'DRAFT',
        draftVersion: 1,
        pauseGeneration: 0
      });

      await CampaignVersionModel.create({
        id: verId,
        tenantId,
        campaignId: campId,
        version: 1,
        name: 'Unregistered Event Campaign',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        trigger: { type: 'EVENT_DRIVEN', eventType: 'unregistered.custom_flow' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        steps: [
          {
            stepId: 'step_1',
            offsetDays: 0,
            localTime: '11:00',
            prerequisite: 'NONE',
            templateRef: { id: 'tpl_birthday_invite', revision: 3, language: 'en' },
            bindings: { name: 'customer.firstName' },
            stopOnReply: true,
            stopOnGoal: true,
            maxLatenessMinutes: 180
          }
        ],
        priority: 50,
        publishedBy: 'tester',
        reviewFingerprint: 'fp_unknown_event'
      });

      const res = await apiPost(`/api/v1/campaigns/${campId}/activate`, {
        expectedVersion: 1,
        reviewFingerprint: 'fp_unknown_event'
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('PRESET_NOT_IMPLEMENTED');
      expect(res.body.message).toContain('unregistered.custom_flow');

      // Database assertion: status remains DRAFT
      const campDb = await CampaignModel.findOne({ id: campId, tenantId });
      expect(campDb?.status).toBe('DRAFT');
    });

    it('successfully activates a campaign backed by an implemented preset and valid dry run', async () => {
      // 1. Create campaign from implemented birthday preset
      const createRes = await apiPost('/api/v1/campaigns', {
        presetId: 'preset_birthday_shopping',
        name: 'Implemented Birthday Live Campaign'
      });
      expect(createRes.status).toBe(201);
      const campId = createRes.body.campaign.id;

      // 2. Perform dry run to obtain legitimate reviewFingerprint
      const draft = await CampaignVersionModel.findOne({ campaignId: campId, tenantId });
      expect(draft).not.toBeNull();

      const dryRunRes = await evaluateCampaignDryRun(draft as unknown as ICampaignVersion);
      draft!.reviewFingerprint = dryRunRes.draftFingerprint;
      await draft!.save();

      // Persist dry run execution record
      await CampaignDryRunModel.create({
        id: generateId('dry'),
        tenantId,
        campaignId: campId,
        draftVersion: 1,
        draftFingerprint: dryRunRes.draftFingerprint,
        summary: {
          totalEvaluated: 5,
          eligibleCount: 5,
          excludedCount: 0
        },
        reasonBreakdown: dryRunRes.reasonBreakdown,
        samplePlans: []
      });

      // 3. Activate campaign
      const actRes = await apiPost(`/api/v1/campaigns/${campId}/activate`, {
        expectedVersion: 1,
        reviewFingerprint: dryRunRes.draftFingerprint
      });

      expect(actRes.status).toBe(200);
      expect(actRes.body.success).toBe(true);

      // Database assertion: campaign transitioned to ACTIVE with activeVersionId
      const campDb = await CampaignModel.findOne({ id: campId, tenantId });
      expect(campDb?.status).toBe('ACTIVE');
      expect(campDb?.activeVersionId).toBe(draft!.id);
      expect(campDb?.activatedAt).not.toBeNull();
    });
  });
});
