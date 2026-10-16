import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  BOUTIQUE_CAMPAIGN_PRESETS,
  getCampaignPreset,
  isScannerImplemented,
  isAnnualPlannerImplemented
} from '../presets/boutiquePresets';
import { isKnownEventType } from '../../../shared/events/registry';
import { APPROVED_TEMPLATES, getApprovedTemplate, resolveApprovedTemplate } from '../adapters/templateCatalogue';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignDryRunModel } from '../models/CampaignDryRun.model';
import { TenantSettingsModel, REQUIRED_SETTINGS_NOTICE } from '../models/TenantSettings.model';
import { TenantControlGateModel } from '../models/TenantControlGate.model';
import { CampaignControlGateModel } from '../models/CampaignControlGate.model';
import { TenantConnectionModel } from '../models/TenantConnection.model';
import { AuditLogModel } from '../models/AuditLog.model';
import { evaluateCampaignDryRun } from '../engine/dryRun';
import { planAnnualOccasions } from '../engine/annualDateStrategy';
import { validateAudienceConfig } from '../engine/audienceEngine';
import { CustomerModel } from '../../crm/models/Customer.model';
import { generateId } from '../../../shared/utils/id';
import { maskPhone } from '../../../shared/utils/phone';
import { requireAuth, requireRole } from '../../../shared/middleware/auth.middleware';
import { requireIdempotency } from '../../../shared/middleware/idempotency.middleware';
import { logger } from '../../../config/logger';
import {
  generateOwnerOverviewReport,
  getCustomerTimeline,
  getMonitoringAlerts
} from '../engine/ownerReporting';
import { resolveShopDisplayName } from '../services/shopResolver';
import { CAMPAIGN_REASON_CODES } from '../../../shared/reasonCodes';

export const campaignRouter = Router();

// Middleware: Authenticate credentials and enforce tenant isolation
campaignRouter.use(requireAuth);

/**
 * GET /api/v1/campaign-presets
 */
campaignRouter.get('/campaign-presets', (req: Request, res: Response) => {
  res.json({
    success: true,
    presets: BOUTIQUE_CAMPAIGN_PRESETS
  });
});

/**
 * GET /api/v1/approved-template-catalogue
 */
campaignRouter.get('/approved-template-catalogue', (req: Request, res: Response) => {
  res.json({
    success: true,
    templates: Object.values(APPROVED_TEMPLATES)
  });
});

/**
 * GET /api/v1/campaign-reason-codes
 * Returns reason codes with category SKIP|DEFER|BLOCK|FAIL, ownerMessage, and resolutionOwner
 */
campaignRouter.get('/campaign-reason-codes', (req: Request, res: Response) => {
  res.json({
    success: true,
    reasonCodes: CAMPAIGN_REASON_CODES
  });
});

/**
 * GET /api/v1/integration-readiness
 * Read-only readiness status: connection status, template statuses, missing configuration
 */
campaignRouter.get('/integration-readiness', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const connection = await TenantConnectionModel.findOne({ tenantId });
    const settings = await TenantSettingsModel.findOne({ tenantId });

    const phoneNumberId =
      connection?.metadata?.phoneNumberId ||
      connection?.metadata?.phone_number_id ||
      connection?.connectionId ||
      null;
    const verifiedName =
      connection?.metadata?.verifiedName ||
      connection?.metadata?.verified_name ||
      null;

    const connectionStatus = connection?.status === 'ACTIVE'
      ? {
          status: 'ACTIVE' as const,
          connectionId: connection.connectionId,
          phoneNumberId,
          verifiedName
        }
      : {
          status: (connection?.status as any) || 'NOT_PROVISIONED',
          connectionId: connection?.connectionId || null,
          phoneNumberId: null,
          verifiedName: null
        };

    const templateStatuses = Object.values(APPROVED_TEMPLATES).map((tmpl) => ({
      templateId: tmpl.id,
      name: tmpl.name,
      category: tmpl.category,
      status: tmpl.status || 'APPROVED',
      languages: [tmpl.language]
    }));

    const missingConfiguration: string[] = [];
    if (!connection || connection.status !== 'ACTIVE') {
      missingConfiguration.push('WHATSAPP_CONNECTION_NOT_PROVISIONED');
    }
    if (!settings?.storeName) {
      missingConfiguration.push('STORE_NAME_NOT_CONFIGURED');
    }
    if (!settings?.allowedHours?.start || !settings?.allowedHours?.end) {
      missingConfiguration.push('ALLOWED_HOURS_NOT_CONFIGURED');
    }
    const unapprovedTemplates = templateStatuses.filter((t) => t.status !== 'APPROVED');
    if (unapprovedTemplates.length > 0) {
      missingConfiguration.push('TEMPLATES_NOT_APPROVED');
    }

    const ready = missingConfiguration.length === 0;

    res.json({
      success: true,
      ready,
      connection: connectionStatus,
      templates: templateStatuses,
      missingConfiguration
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/v1/campaign-settings
 * Backed by real tenant settings document with exact required notice text (Spec p.8, P2.j)
 */
campaignRouter.get('/campaign-settings', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    let settings = await TenantSettingsModel.findOne({ tenantId });
    if (!settings) {
      settings = await TenantSettingsModel.create({
        id: generateId('set'),
        tenantId,
        version: 1,
        storeName: null,
        timezone: 'Asia/Kolkata',
        allowedHours: { start: '10:00', end: '19:00' },
        caps: {
          marketing24h: 1,
          marketing7d: 3
        },
        globalPause: false,
        outageGraceMinutes: 120,
        leapDayPolicy: 'FEB_28',
        holidays: [],
        blackouts: [],
        notice: REQUIRED_SETTINGS_NOTICE
      });
    }

    res.json({
      success: true,
      settings: {
        id: settings.id,
        version: settings.version,
        storeName: settings.storeName ?? null,
        timezone: settings.timezone,
        allowedHours: settings.allowedHours,
        caps: settings.caps,
        globalPause: settings.globalPause,
        outageGraceMinutes: settings.outageGraceMinutes,
        leapDayPolicy: settings.leapDayPolicy,
        holidays: settings.holidays,
        blackouts: settings.blackouts,
        notice: REQUIRED_SETTINGS_NOTICE
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * PATCH /api/v1/campaign-settings
 * Real tenant settings update with optimistic concurrency control and notice lock (P2.j, C16)
 */
campaignRouter.patch(
  '/campaign-settings',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const {
        expectedVersion,
        timezone,
        allowedHours,
        caps,
        globalPause,
        outageGraceMinutes,
        leapDayPolicy,
        holidays,
        blackouts,
        storeName
      } = req.body;

      // Mandatory optimistic concurrency control (Review 2, Spec C16)
      if (typeof expectedVersion !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'EXPECTED_VERSION_REQUIRED: expectedVersion is mandatory and must be a number.',
          code: 'EXPECTED_VERSION_REQUIRED',
          fieldPath: 'expectedVersion'
        });
      }

      // Atomic conditional update on settings and control gate (Review 2 A)
      const session = await mongoose.startSession();
      try {
        let updatedSettings: any = null;
        await session.withTransaction(async () => {
          let settings = await TenantSettingsModel.findOne({ tenantId }).session(session);
          if (!settings) {
            const created = await TenantSettingsModel.create(
              [
                {
                  id: generateId('set'),
                  tenantId,
                  version: 1,
                  timezone: 'Asia/Kolkata',
                  allowedHours: { start: '10:00', end: '19:00' },
                  caps: { marketing24h: 1, marketing7d: 3 },
                  globalPause: false,
                  outageGraceMinutes: 120,
                  leapDayPolicy: 'FEB_28',
                  holidays: [],
                  blackouts: [],
                  storeName: typeof storeName === 'string' ? storeName.trim() : null,
                  notice: REQUIRED_SETTINGS_NOTICE
                }
              ],
              { session }
            );
            settings = created[0];
          }

          if (settings.version !== expectedVersion) {
            throw new Error('VERSION_CONFLICT');
          }

          const updateFields: any = {
            $inc: { version: 1 },
            $set: { notice: REQUIRED_SETTINGS_NOTICE }
          };
          if (timezone) updateFields.$set.timezone = timezone;
          if (allowedHours) updateFields.$set.allowedHours = allowedHours;
          if (caps) updateFields.$set.caps = caps;
          if (typeof outageGraceMinutes === 'number') updateFields.$set.outageGraceMinutes = outageGraceMinutes;
          if (leapDayPolicy) updateFields.$set.leapDayPolicy = leapDayPolicy;
          if (Array.isArray(holidays)) updateFields.$set.holidays = holidays;
          if (Array.isArray(blackouts)) updateFields.$set.blackouts = blackouts;
          if (typeof globalPause === 'boolean') updateFields.$set.globalPause = globalPause;
          if (typeof storeName === 'string') {
            updateFields.$set.storeName = storeName.trim();
          } else if (storeName === null) {
            updateFields.$set.storeName = null;
          }

          updatedSettings = await TenantSettingsModel.findOneAndUpdate(
            { tenantId, version: expectedVersion },
            updateFields,
            { session, new: true }
          );

          if (!updatedSettings) {
            throw new Error('VERSION_CONFLICT');
          }

          // Atomically sync global pause with TenantControlGateModel (Consistent Lock Order: 1, Spec p.25)
          if (typeof globalPause === 'boolean') {
            await TenantControlGateModel.findOneAndUpdate(
              { tenantId },
              {
                $set: { globalPause },
                $inc: { gateVersion: 1 }
              },
              { session, upsert: true, new: true }
            );

            if (globalPause) {
              // Invalidate in-flight evaluation leases across tenant
              await CampaignExecutionModel.updateMany(
                { tenantId, state: 'EVALUATING' },
                {
                  $set: {
                    state: 'DEFERRED',
                    'lease.token': null,
                    'lease.until': null,
                    'lease.claimedBy': null,
                    outcomeReason: 'DEFERRED_GLOBAL_PAUSED'
                  }
                },
                { session }
              );
            }
          }

          // Audit Log inside transaction
          await AuditLogModel.create(
            [
              {
                id: generateId('aud'),
                tenantId,
                userId: (req as any).user?.userId || 'owner',
                action: 'UPDATE_SETTINGS',
                targetType: 'TENANT_SETTINGS',
                targetId: updatedSettings.id,
                details: { version: updatedSettings.version, globalPause: updatedSettings.globalPause }
              }
            ],
            { session }
          );
        });

        res.json({
          success: true,
          settings: {
            id: updatedSettings.id,
            version: updatedSettings.version,
            storeName: updatedSettings.storeName ?? null,
            timezone: updatedSettings.timezone,
            allowedHours: updatedSettings.allowedHours,
            caps: updatedSettings.caps,
            globalPause: updatedSettings.globalPause,
            outageGraceMinutes: updatedSettings.outageGraceMinutes,
            leapDayPolicy: updatedSettings.leapDayPolicy,
            holidays: updatedSettings.holidays,
            blackouts: updatedSettings.blackouts,
            notice: REQUIRED_SETTINGS_NOTICE
          }
        });
      } catch (txErr: any) {
        if (txErr.message === 'VERSION_CONFLICT') {
          return res.status(409).json({
            success: false,
            error: `Settings version conflict: expected version ${expectedVersion} does not match current version.`,
            code: 'VERSION_CONFLICT',
            fieldPath: 'expectedVersion'
          });
        }
        throw txErr;
      } finally {
        await session.endSession();
      }
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }
);

/**
 * GET /api/v1/campaigns
 */
campaignRouter.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const campaigns = await CampaignModel.find({ tenantId }).sort({ updatedAt: -1 }).lean();

    const populated = await Promise.all(
      campaigns.map(async (c) => {
        let activeVersion = null;
        if (c.activeVersionId) {
          activeVersion = await CampaignVersionModel.findOne({ id: c.activeVersionId, tenantId }).lean();
        }
        const enrolledCount = await CampaignEnrollmentModel.countDocuments({
          tenantId,
          campaignId: c.id,
          status: 'ACTIVE'
        });
        return {
          ...c,
          activeVersion,
          enrolledCount
        };
      })
    );

    res.json({ success: true, campaigns: populated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/campaigns
 * Create a new campaign from a preset
 */
campaignRouter.post(
  '/campaigns',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { presetId, name } = req.body;

      if (presetId) {
        const preset = getCampaignPreset(presetId);
        if (!preset || !preset.implemented) {
          return res.status(422).json({
            success: false,
            error: 'PRESET_NOT_IMPLEMENTED',
            message: `Preset '${presetId}' cannot be used because it is not implemented.`
          });
        }
      }

      const preset = presetId ? getCampaignPreset(presetId) : null;
      const campaignId = generateId('cmp');
      const versionId = generateId('cv');

      const newCampaign = await CampaignModel.create({
        id: campaignId,
        tenantId,
        presetId: preset?.id || null,
        name: name || (preset ? preset.name : 'Birthday Boutique Shopping'),
        industry: 'BOUTIQUE',
        purpose: preset?.purpose || 'MARKETING',
        status: 'DRAFT',
        activeVersionId: null,
        draftVersion: 1,
        pauseGeneration: 0
      });

      const steps = preset
        ? preset.defaultSteps.map((s) => ({
            stepId: s.stepId,
            offsetDays: s.offsetDays,
            localTime: s.localTime,
            prerequisite: s.prerequisite,
            templateRef: { id: s.templateId, revision: s.templateRevision, language: 'en' },
            bindings: s.bindings,
            stopOnReply: s.stopOnReply,
            stopOnGoal: s.stopOnGoal,
            maxLatenessMinutes: s.maxLatenessMinutes
          }))
        : [];

      const draftVersion = await CampaignVersionModel.create({
        id: versionId,
        tenantId,
        campaignId,
        presetId: preset?.id || null,
        version: 1,
        name: newCampaign.name,
        industry: 'BOUTIQUE',
        purpose: newCampaign.purpose,
        trigger: preset?.trigger || { type: 'ANNUAL_DATE', field: 'customer.birthday', leapDayPolicy: 'FEB_28' },
        timezone: 'Asia/Kolkata',
        audience: { mode: 'ALL_ELIGIBLE' },
        goal: { type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED', windowDays: 14 },
        steps,
        priority: preset?.defaultPriority || 80,
        resumePolicy: 'FUTURE_ONLY',
        importPolicy: 'FUTURE_ONLY',
        enabledBranches: ['default'],
        publishedBy: (req as any).user?.userId || 'owner',
        reviewFingerprint: 'draft_initial'
      });

      res.status(201).json({
        success: true,
        campaign: newCampaign,
        draftVersion
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * GET /api/v1/campaigns/:id
 */
campaignRouter.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId }).lean();
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const versions = await CampaignVersionModel.find({ campaignId: campaign.id, tenantId })
      .sort({ version: -1 })
      .lean();

    const activeVersion = versions.find((v) => v.id === campaign.activeVersionId) || null;
    const latestDraft = versions.find((v) => v.version === campaign.draftVersion) || versions[0];

    res.json({
      success: true,
      campaign,
      activeVersion,
      latestDraft
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/v1/campaigns/:id/draft
 * Update draft configuration (Trigger, Audience, Steps, Rules)
 * Never mutates a published version (Spec p.9, P2.f, C16)
 */
campaignRouter.patch(
  '/campaigns/:id/draft',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { expectedVersion, name, trigger, audience, steps, priority, timezone } = req.body;

      // Mandatory optimistic concurrency control (Review 2, Spec C16)
      if (typeof expectedVersion !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'EXPECTED_VERSION_REQUIRED: expectedVersion is mandatory and must be a number.'
        });
      }

      const session = await mongoose.startSession();
      try {
        let finalCampaign: any = null;
        let finalDraft: any = null;

        await session.withTransaction(async () => {
          const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId }).session(session);
          if (!campaign) {
            throw new Error('NOT_FOUND');
          }

          if (campaign.draftVersion !== expectedVersion) {
            throw new Error('VERSION_CONFLICT');
          }

          const draft = await CampaignVersionModel.findOne({
            campaignId: campaign.id,
            tenantId,
            version: expectedVersion
          }).session(session);

          if (!draft) {
            throw new Error('DRAFT_NOT_FOUND');
          }

          // Invariant: If draft is currently the active/live version, clone a new immutable draft revision (Spec p.16)
          if (campaign.activeVersionId === draft.id) {
            const nextVersionNumber = expectedVersion + 1;
            const newVersionId = generateId('cv');

            const clonedDraft = await CampaignVersionModel.create(
              [
                {
                  id: newVersionId,
                  tenantId,
                  campaignId: campaign.id,
                  version: nextVersionNumber,
                  name: name || draft.name,
                  industry: draft.industry,
                  purpose: draft.purpose,
                  trigger: trigger ? { ...draft.trigger, ...trigger } : draft.trigger,
                  timezone: timezone || draft.timezone,
                  audience: audience || draft.audience,
                  goal: draft.goal,
                  steps: steps || draft.steps,
                  priority: priority || draft.priority,
                  resumePolicy: draft.resumePolicy,
                  importPolicy: draft.importPolicy,
                  enabledBranches: draft.enabledBranches,
                  publishedBy: (req as any).user?.userId || 'owner',
                  reviewFingerprint: `draft_${Date.now()}`
                }
              ],
              { session }
            );

            const updatedCampaign = await CampaignModel.findOneAndUpdate(
              { id: campaign.id, tenantId, draftVersion: expectedVersion },
              {
                $set: {
                  draftVersion: nextVersionNumber,
                  ...(name ? { name } : {})
                }
              },
              { session, new: true }
            );

            if (!updatedCampaign) {
              throw new Error('VERSION_CONFLICT');
            }

            finalCampaign = updatedCampaign;
            finalDraft = clonedDraft[0];
          } else {
            // Updating an unpublished draft revision
            const nextVersion = expectedVersion + 1;
            if (name) {
              draft.name = name;
            }
            if (trigger) draft.trigger = { ...draft.trigger, ...trigger };
            if (audience) draft.audience = audience;
            if (steps) draft.steps = steps;
            if (priority) draft.priority = priority;
            if (timezone) draft.timezone = timezone;
            draft.version = nextVersion;

            draft.reviewFingerprint = `draft_${Date.now()}`;
            await draft.save({ session });

            const updatedCampaign = await CampaignModel.findOneAndUpdate(
              { id: campaign.id, tenantId, draftVersion: expectedVersion },
              {
                $set: {
                  draftVersion: nextVersion,
                  ...(name ? { name } : {})
                }
              },
              { session, new: true }
            );

            if (!updatedCampaign) {
              throw new Error('VERSION_CONFLICT');
            }

            finalCampaign = updatedCampaign;
            finalDraft = draft;
          }
        });

        res.json({ success: true, campaign: finalCampaign, draftVersion: finalDraft });
      } catch (txErr: any) {
        if (txErr.message === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Campaign not found' });
        if (txErr.message === 'DRAFT_NOT_FOUND') return res.status(404).json({ success: false, error: 'Draft version not found' });
        if (txErr.message === 'VERSION_CONFLICT') {
          return res.status(409).json({
            success: false,
            error: `Draft version conflict: expected version ${expectedVersion} does not match current draft version.`
          });
        }
        throw txErr;
      } finally {
        await session.endSession();
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/campaigns/:id/dry-runs
 * Run pre-flight dry-run evaluation on the draft version
 */
campaignRouter.post(
  '/campaigns/:id/dry-runs',
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' });
      }

      const draft = await CampaignVersionModel.findOne({
        campaignId: campaign.id,
        tenantId,
        version: campaign.draftVersion
      });

      if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft version not found' });
      }

      const result = await evaluateCampaignDryRun(draft);
      draft.reviewFingerprint = result.draftFingerprint;
      await draft.save();

      res.json({ success: true, dryRun: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/campaigns/:id/activate
 * Publish immutable version and execute calendar planner (requires reviewFingerprint from real dry run, A03, A05, C01)
 */
campaignRouter.post(
  '/campaigns/:id/activate',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { reviewFingerprint, expectedVersion } = req.body;

      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' });
      }

      // Mandatory optimistic concurrency control (Review 2, Spec C16)
      if (typeof expectedVersion !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'EXPECTED_VERSION_REQUIRED: expectedVersion is mandatory and must be a number.'
        });
      }

      if (campaign.draftVersion !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Version conflict: expected base version ${expectedVersion}, but draft is at version ${campaign.draftVersion}.`
        });
      }

      const draft = await CampaignVersionModel.findOne({
        campaignId: campaign.id,
        tenantId,
        version: expectedVersion
      });

      if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft version not found' });
      }

      // Preset capability and activation guard (Step 10)
      const campaignPresetId = (campaign as any).presetId || (draft as any).presetId;
      if (campaignPresetId) {
        const preset = getCampaignPreset(campaignPresetId);
        if (!preset || !preset.implemented) {
          return res.status(422).json({
            success: false,
            error: 'PRESET_NOT_IMPLEMENTED',
            message: `Activation blocked: Preset '${campaignPresetId}' is not implemented.`
          });
        }
      }

      if (draft.trigger) {
        if (draft.trigger.type === 'EVENT_DRIVEN') {
          const eventType = draft.trigger.eventType;
          if (!eventType || !isKnownEventType(eventType)) {
            return res.status(422).json({
              success: false,
              error: 'PRESET_NOT_IMPLEMENTED',
              message: `Activation blocked: Trigger event type '${eventType}' has no registered evaluator.`
            });
          }
        } else if (draft.trigger.type === 'INACTIVITY_SCAN') {
          if (!isScannerImplemented()) {
            return res.status(422).json({
              success: false,
              error: 'PRESET_NOT_IMPLEMENTED',
              message: 'Activation blocked: Inactivity scanner worker is not implemented.'
            });
          }
        } else if (draft.trigger.type === 'ANNUAL_DATE') {
          if (!isAnnualPlannerImplemented(draft.trigger.field)) {
            return res.status(422).json({
              success: false,
              error: 'PRESET_NOT_IMPLEMENTED',
              message: `Activation blocked: Annual date field '${draft.trigger.field}' is not implemented.`
            });
          }
        }
      }

      // Mandatory review fingerprint check (Spec p.21, A03)
      if (!reviewFingerprint) {
        return res.status(400).json({
          success: false,
          error: 'Mandatory reviewFingerprint is required to activate a campaign. Run dry run first.'
        });
      }

      // Verify fingerprint matches draft review (A03: Draft changed after dry run -> reject old review fingerprint)
      if (draft.reviewFingerprint !== reviewFingerprint) {
        return res.status(400).json({
          success: false,
          error: 'Review fingerprint mismatch. The draft was modified after the dry run.'
        });
      }

      // Verify that a real persisted dry run audit exists (C01)
      const dryRunReport = await CampaignDryRunModel.findOne({
        tenantId,
        campaignId: campaign.id,
        draftFingerprint: reviewFingerprint
      });

      if (!dryRunReport) {
        return res.status(400).json({
          success: false,
          error: 'No dry run execution record found for this review fingerprint.'
        });
      }

      // Activation Readiness Checks (Spec A05, Finding 5): Exact approved template ID, revision, and locale
      for (const step of draft.steps || []) {
        let template;
        try {
          template = await resolveApprovedTemplate(
            step.templateRef?.id,
            tenantId,
            step.templateRef?.revision,
            step.templateRef?.language
          );
        } catch (tmplErr: any) {
          logger.error({ tmplErr: tmplErr?.message, stepId: step.stepId }, 'Template resolution failed closed due to database error');
          return res.status(503).json({
            success: false,
            error: `Activation failed: Template catalogue is currently unavailable for step '${step.stepId}'.`,
            fieldPath: `steps.${step.stepId}.templateRef.id`,
            resolutionOwner: 'INTEGRATION_DEVELOPER'
          });
        }
        if (!template || template.status === 'PAUSED') {
          return res.status(422).json({
            success: false,
            error: `Activation blocked: Step '${step.stepId}' references unusable template '${step.templateRef?.id}' (revision: ${step.templateRef?.revision}, locale: ${step.templateRef?.language}).`,
            fieldPath: `steps.${step.stepId}.templateRef.id`,
            resolutionOwner: 'INTEGRATION_DEVELOPER'
          });
        }
        if (draft.purpose === 'ORDER_SERVICE' && template.category === 'MARKETING') {
          return res.status(422).json({
            success: false,
            error: `Activation blocked: Step '${step.stepId}' template purpose mismatch. Service campaign cannot use marketing template.`,
            fieldPath: `steps.${step.stepId}.templateRef.id`,
            resolutionOwner: 'BOUTIQUE_OWNER'
          });
        }
      }

      const connection = await TenantConnectionModel.findOne({ tenantId, status: 'ACTIVE' });
      if (!connection) {
        return res.status(422).json({
          success: false,
          error: 'Activation blocked: No active WhatsApp connection provisioned for this boutique.',
          fieldPath: 'connectionId',
          resolutionOwner: 'INTEGRATION_DEVELOPER'
        });
      }

      // Atomic MongoDB transaction for version publishing, campaign activation, and audit (Spec p.21, Finding 3)
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const updatedCampaign = await CampaignModel.findOneAndUpdate(
            {
              id: campaign.id,
              tenantId,
              status: 'DRAFT',
              draftVersion: expectedVersion
            },
            {
              $inc: { draftVersion: 1 },
              $set: {
                status: 'ACTIVE',
                activeVersionId: draft.id,
                activatedAt: new Date()
              }
            },
            { session, new: true }
          );

          if (!updatedCampaign) {
            throw new Error('VERSION_CONFLICT');
          }

          const updatedDraft = await CampaignVersionModel.findOneAndUpdate(
            {
              id: draft.id,
              tenantId,
              version: expectedVersion
            },
            {
              $set: {
                publishedAt: new Date(),
                publishedBy: (req as any).user?.userId || 'owner'
              }
            },
            { session, new: true }
          );

          if (!updatedDraft) {
            throw new Error('VERSION_CONFLICT');
          }

          await AuditLogModel.create(
            [
              {
                id: generateId('aud'),
                tenantId,
                userId: (req as any).user?.userId || 'owner',
                action: 'ACTIVATE_CAMPAIGN',
                targetType: 'CAMPAIGN',
                targetId: campaign.id,
                details: { versionId: draft.id, version: draft.version, reviewFingerprint }
              }
            ],
            { session }
          );
        });
      } catch (txErr: any) {
        if (txErr.message === 'VERSION_CONFLICT') {
          return res.status(409).json({
            success: false,
            error: 'Version conflict: campaign draft was modified concurrently.'
          });
        }
        throw txErr;
      } finally {
        await session.endSession();
      }

      const finalCampaign = await CampaignModel.findOne({ id: campaign.id, tenantId });

      // Trigger calendar planning for annual date occasions post-commit (idempotent, Spec p.17)
      let planningResult = null;
      if (draft.trigger.type === 'ANNUAL_DATE') {
        try {
          planningResult = await planAnnualOccasions(draft);
        } catch (planErr: any) {
          // Log error; background planner will reconcile
        }
      }

      res.json({
        success: true,
        campaign: finalCampaign || campaign,
        activeVersion: draft,
        planningResult
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/campaigns/:id/pause | resume
 * Serialized via CampaignControlGate transaction matching dispatch submission protocol (Review 2 B)
 */
campaignRouter.post(
  '/campaigns/:id/pause',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

      const session = await mongoose.startSession();
      let updatedCampaign: any = null;
      try {
        await session.withTransaction(async () => {
          const nextPauseGen = campaign.pauseGeneration + 1;

          // 1. Lock & Conditionally Update CampaignControlGate (Consistent Lock Order: 2, Spec p.25)
          await CampaignControlGateModel.findOneAndUpdate(
            { tenantId, campaignId: campaign.id },
            {
              $set: { paused: true, pauseGeneration: nextPauseGen },
              $inc: { gateVersion: 1 }
            },
            { session, upsert: true, new: true }
          );

          // 2. Update campaign state inside same transaction
          updatedCampaign = await CampaignModel.findOneAndUpdate(
            { id: campaign.id, tenantId },
            {
              $set: { status: 'PAUSED', pauseGeneration: nextPauseGen }
            },
            { session, new: true }
          );

          // 3. Invalidate in-flight evaluation leases inside same transaction
          await CampaignExecutionModel.updateMany(
            { campaignId: campaign.id, tenantId, state: 'EVALUATING' },
            {
              $set: {
                state: 'DEFERRED',
                'lease.token': null,
                'lease.until': null,
                'lease.claimedBy': null,
                outcomeReason: 'DEFERRED_CAMPAIGN_PAUSED'
              }
            },
            { session }
          );

          // 4. Audit log entry inside same transaction
          await AuditLogModel.create(
            [
              {
                id: generateId('aud'),
                tenantId,
                userId: (req as any).user?.userId || 'owner',
                action: 'PAUSE_CAMPAIGN',
                targetType: 'CAMPAIGN',
                targetId: campaign.id,
                details: { pauseGeneration: nextPauseGen }
              }
            ],
            { session }
          );
        });
      } finally {
        await session.endSession();
      }

      res.json({ success: true, campaign: updatedCampaign });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

campaignRouter.post(
  '/campaigns/:id/resume',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    const session = await mongoose.startSession();
    let updatedCampaign: any = null;
    try {
      await session.withTransaction(async () => {
        const nextPauseGen = campaign.pauseGeneration + 1;

        // 1. Lock & Conditionally Update CampaignControlGate (Consistent Lock Order: 2, Spec p.25)
        await CampaignControlGateModel.findOneAndUpdate(
          { tenantId, campaignId: campaign.id },
          {
            $set: { paused: false, pauseGeneration: nextPauseGen },
            $inc: { gateVersion: 1 }
          },
          { session, upsert: true, new: true }
        );

        // 2. Update campaign status inside same transaction
        updatedCampaign = await CampaignModel.findOneAndUpdate(
          { id: campaign.id, tenantId },
          {
            $set: { status: 'ACTIVE', pauseGeneration: nextPauseGen }
          },
          { session, new: true }
        );

        // 3. Skip missed steps that became overdue while paused (FUTURE_ONLY, Spec p.9, p.17)
        const serverNow = new Date();
        await CampaignExecutionModel.updateMany(
          {
            campaignId: campaign.id,
            tenantId,
            state: { $in: ['SCHEDULED', 'DEFERRED'] },
            dueAt: { $lt: serverNow }
          },
          {
            $set: {
              state: 'SKIPPED',
              outcomeReason: 'SKIPPED_STEP_EXPIRED',
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          },
          { session }
        );

        // 4. Re-stamp all future pending and retry executions with the new pauseGeneration
        await CampaignExecutionModel.updateMany(
          {
            campaignId: campaign.id,
            tenantId,
            state: { $in: ['SCHEDULED', 'DEFERRED', 'RETRY_WAIT'] }
          },
          {
            $set: {
              pauseGeneration: nextPauseGen,
              'lease.token': null,
              'lease.until': null,
              'lease.claimedBy': null
            }
          },
          { session }
        );

        // 5. Audit log inside same transaction
        await AuditLogModel.create(
          [
            {
              id: generateId('aud'),
              tenantId,
              userId: (req as any).user?.userId || 'owner',
              action: 'RESUME_CAMPAIGN',
              targetType: 'CAMPAIGN',
              targetId: campaign.id,
              details: { pauseGeneration: nextPauseGen }
            }
          ],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    res.json({ success: true, campaign: updatedCampaign });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export async function validateCampaignVersionDefinition(version: any, tenantId: string) {
  const errors: Array<{ fieldPath: string; message: string; resolutionOwner: 'BOUTIQUE_OWNER' | 'INTEGRATION_DEVELOPER' }> = [];
  const warnings: Array<{ fieldPath: string; message: string; resolutionOwner: string }> = [];

  // 1. Audience validation
  const audVal = validateAudienceConfig(version.audience);
  if (!audVal.valid && audVal.errors.length > 0) {
    for (const err of audVal.errors) {
      errors.push({
        fieldPath: 'audience',
        message: err,
        resolutionOwner: 'BOUTIQUE_OWNER'
      });
    }
  }

  // 2. Channel Connection Readiness check (Spec A05)
  const connection = await TenantConnectionModel.findOne({ tenantId, status: 'ACTIVE' });
  if (!connection) {
    errors.push({
      fieldPath: 'connectionId',
      message: 'No active WhatsApp channel connection found for this boutique.',
      resolutionOwner: 'INTEGRATION_DEVELOPER'
    });
  }

  // 3. Step validation
  if (!version.steps || version.steps.length === 0) {
    errors.push({
      fieldPath: 'steps',
      message: 'Campaign must have at least one execution step configured.',
      resolutionOwner: 'BOUTIQUE_OWNER'
    });
  } else {
    const shopDisplayName = await resolveShopDisplayName(tenantId, version);

    for (const step of version.steps) {
      let template;
      try {
        template = await resolveApprovedTemplate(
          step.templateRef?.id,
          tenantId,
          step.templateRef?.revision,
          step.templateRef?.language
        );
      } catch (tmplErr: any) {
        errors.push({
          fieldPath: `steps.${step.stepId}.templateRef.id`,
          message: `Template catalogue is currently unavailable due to database error.`,
          resolutionOwner: 'INTEGRATION_DEVELOPER'
        });
        continue;
      }
      if (!template) {
        errors.push({
          fieldPath: `steps.${step.stepId}.templateRef.id`,
          message: `Template '${step.templateRef?.id}' is missing or not in the approved catalogue.`,
          resolutionOwner: 'INTEGRATION_DEVELOPER'
        });
      } else if (template.status === 'PAUSED') {
        errors.push({
          fieldPath: `steps.${step.stepId}.templateRef.id`,
          message: `Template '${step.templateRef?.id}' is paused by the WhatsApp provider.`,
          resolutionOwner: 'INTEGRATION_DEVELOPER'
        });
      } else {
        const rawBindings = step.bindings instanceof Map
          ? Object.fromEntries(step.bindings.entries())
          : (step.bindings || {});

        let stepRequiresShop = false;
        for (const varKey of template.variableKeys) {
          const bound = rawBindings[varKey];
          if (varKey === 'shop' || bound === 'shop.displayName' || bound === 'shop.name' || bound === 'shop' || bound === 'store') {
            if (!bound || bound === 'shop.displayName' || bound === 'shop.name' || bound === 'shop' || bound === 'store') {
              stepRequiresShop = true;
            }
          }
          if (!bound && varKey !== 'name' && varKey !== 'shop') {
            errors.push({
              fieldPath: `steps.${step.stepId}.bindings.${varKey}`,
              message: `Template variable '${varKey}' is not mapped to a customer or store attribute.`,
              resolutionOwner: 'BOUTIQUE_OWNER'
            });
          }
        }

        if (stepRequiresShop && !shopDisplayName && !errors.some((e) => e.fieldPath === 'settings.storeName')) {
          errors.push({
            fieldPath: 'settings.storeName',
            message: 'Shop display name is not configured. Please configure storeName in settings or brandName on the campaign version.',
            resolutionOwner: 'BOUTIQUE_OWNER'
          });
        }
      }

      if (!step.localTime || !/^\d{2}:\d{2}$/.test(step.localTime)) {
        errors.push({
          fieldPath: `steps.${step.stepId}.localTime`,
          message: `Invalid localTime '${step.localTime}'. Must be in HH:mm format.`,
          resolutionOwner: 'BOUTIQUE_OWNER'
        });
      }
    }
  }

  const eligibleCount = await CustomerModel.countDocuments({
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false,
    optedInMarketing: true
  });
  if (eligibleCount === 0) {
    warnings.push({
      fieldPath: 'audience.customers',
      message: 'No eligible customers currently in CRM. Future customers will qualify when added.',
      resolutionOwner: 'BOUTIQUE_OWNER'
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * POST /api/v1/campaigns/:id/validate
 * Validates campaign configuration, step approved templates, parameter bindings, and channel readiness (A05)
 */
campaignRouter.post('/campaigns/:id/validate', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    const { expectedVersion } = req.body || {};
    if (expectedVersion !== undefined) {
      if (typeof expectedVersion !== 'number') {
        return res.status(400).json({ success: false, error: 'expectedVersion must be a number' });
      }
      if (campaign.draftVersion !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Version conflict: expected draft version ${expectedVersion}, but current draft is version ${campaign.draftVersion}.`
        });
      }
    }

    // Always validate the draft version being edited/prepared (Spec p.21, Finding 2)
    const version = await CampaignVersionModel.findOne({
      campaignId: campaign.id,
      tenantId,
      version: campaign.draftVersion
    }) || await CampaignVersionModel.findOne({ campaignId: campaign.id, tenantId }).sort({ version: -1 });

    if (!version) {
      return res.status(400).json({ success: false, error: 'No campaign version found to validate' });
    }

    const { valid: isValid, errors, warnings } = await validateCampaignVersionDefinition(version, tenantId);

    if (isValid && campaign.status === 'DRAFT') {
      campaign.status = 'VALIDATED';
      await campaign.save();
    }

    res.json({
      success: true,
      valid: isValid,
      errors,
      warnings,
      campaign,
      versionId: version.id,
      draftVersion: version.version,
      reviewFingerprint: version.reviewFingerprint || null,
      validatedSteps: version.steps?.length || 0
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/publish-revision
 * Enforces full review lifecycle (optimistic concurrency, template check, dry-run fingerprint)
 */
campaignRouter.post(
  '/campaigns/:id/publish-revision',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { expectedVersion, reviewFingerprint } = req.body;

      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

      // 1. Mandatory optimistic concurrency control (Review 2, Spec C16)
      if (typeof expectedVersion !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'EXPECTED_VERSION_REQUIRED: expectedVersion is mandatory and must be a number.'
        });
      }
      if (campaign.draftVersion !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Version conflict: expected base version ${expectedVersion}, but draft is at version ${campaign.draftVersion}.`
        });
      }

      // 2. Mandatory dry-run reviewFingerprint
      if (!reviewFingerprint) {
        return res.status(400).json({
          success: false,
          error: 'Mandatory reviewFingerprint is required. Please evaluate dry run before publishing revision.'
        });
      }

      const dryRunReport = await CampaignDryRunModel.findOne({
        tenantId,
        campaignId: campaign.id,
        draftFingerprint: reviewFingerprint
      });

      if (!dryRunReport) {
        return res.status(400).json({
          success: false,
          error: 'No dry run evaluation found matching reviewFingerprint. Cannot publish unverified revision.'
        });
      }

      const currentVersion = campaign.activeVersionId
        ? await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId })
        : await CampaignVersionModel.findOne({ campaignId: campaign.id, tenantId }).sort({ version: -1 });

      if (!currentVersion) {
        return res.status(400).json({ success: false, error: 'No base version found to revise' });
      }

      const candidateSteps = req.body.steps || currentVersion.steps;

      // 3. Template Validation (Finding 5)
      for (const step of candidateSteps) {
        let tpl;
        try {
          tpl = await resolveApprovedTemplate(
            step.templateRef?.id,
            tenantId,
            step.templateRef?.revision,
            step.templateRef?.language
          );
        } catch (tmplErr: any) {
          logger.error({ tmplErr: tmplErr?.message, stepId: step.stepId }, 'Template resolution failed closed due to database error');
          return res.status(503).json({
            success: false,
            error: `Publishing revision failed: Template catalogue is currently unavailable for step '${step.stepId}'.`
          });
        }
        if (!tpl || tpl.status === 'PAUSED') {
          return res.status(422).json({
            success: false,
            error: `Step '${step.stepId}' references unapproved or paused template '${step.templateRef?.id}' (revision: ${step.templateRef?.revision}, locale: ${step.templateRef?.language})`
          });
        }
      }

      // 4. Atomic draftVersion CAS increment and transaction (Finding 3)
      const baseVersion = currentVersion.toObject ? currentVersion.toObject() : currentVersion;
      const newVersionId = generateId('cv');
      const newVersionNumber = (currentVersion.version || 1) + 1;
      let newVersion: any = null;
      let finalCampaign: any = null;

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const updatedCampaign = await CampaignModel.findOneAndUpdate(
            { id: campaign.id, tenantId, draftVersion: expectedVersion },
            {
              $inc: { draftVersion: 1 },
              $set: {
                activeVersionId: newVersionId,
                status: 'ACTIVE'
              }
            },
            { session, new: true }
          );

          if (!updatedCampaign) {
            throw new Error('VERSION_CONFLICT');
          }

          newVersion = await CampaignVersionModel.create(
            [
              {
                id: newVersionId,
                tenantId,
                campaignId: campaign.id,
                version: newVersionNumber,
                name: baseVersion.name,
                industry: baseVersion.industry,
                purpose: baseVersion.purpose,
                trigger: req.body.trigger || baseVersion.trigger,
                timezone: req.body.timezone || baseVersion.timezone,
                audience: req.body.audience || baseVersion.audience,
                goal: req.body.goal || baseVersion.goal,
                steps: candidateSteps,
                priority: req.body.priority || baseVersion.priority,
                resumePolicy: baseVersion.resumePolicy || 'FUTURE_ONLY',
                importPolicy: 'FUTURE_ONLY',
                enabledBranches: baseVersion.enabledBranches || [],
                publishedBy: (req as any).user?.userId || 'boutique_manager',
                publishedAt: new Date(),
                reviewFingerprint
              }
            ],
            { session }
          );

          await AuditLogModel.create(
            [
              {
                id: generateId('aud'),
                tenantId,
                userId: (req as any).user?.userId || 'owner',
                action: 'PUBLISH_REVISION',
                targetType: 'CAMPAIGN',
                targetId: campaign.id,
                details: { versionId: newVersionId, version: newVersionNumber, reviewFingerprint }
              }
            ],
            { session }
          );

          finalCampaign = updatedCampaign;
        });
      } catch (txErr: any) {
        if (txErr.message === 'VERSION_CONFLICT') {
          return res.status(409).json({
            success: false,
            error: 'Concurrent version update conflict detected.'
          });
        }
        throw txErr;
      } finally {
        await session.endSession();
      }

      res.json({
        success: true,
        message: `Version ${newVersionNumber} published successfully`,
        campaign: finalCampaign,
        activeVersion: Array.isArray(newVersion) ? newVersion[0] : newVersion
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/campaigns/:id/archive
 * Archives a campaign, cancels pending executions and marks enrollments CANCELLED
 */
campaignRouter.post(
  '/campaigns/:id/archive',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

      campaign.status = 'ARCHIVED';
      campaign.pauseGeneration += 1;
      await campaign.save();

      // Cancel all scheduled or deferred executions for this campaign
      const cancelledExecutions = await CampaignExecutionModel.updateMany(
        {
          campaignId: campaign.id,
          tenantId,
          state: { $in: ['SCHEDULED', 'DEFERRED', 'EVALUATING'] }
        },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: 'SKIPPED_CAMPAIGN_ARCHIVED',
            'lease.token': null,
            'lease.until': null
          }
        }
      );

      // Cancel active enrollments (marked CANCELLED, NOT COMPLETED!)
      await CampaignEnrollmentModel.updateMany(
        {
          campaignId: campaign.id,
          tenantId,
          status: 'ACTIVE'
        },
        {
          $set: {
            status: 'CANCELLED'
          }
        }
      );

      // Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'owner',
        action: 'ARCHIVE_CAMPAIGN',
        targetType: 'CAMPAIGN',
        targetId: campaign.id,
        details: { cancelledExecutions: cancelledExecutions.modifiedCount }
      });

      res.json({
        success: true,
        message: 'Campaign archived, active enrollments cancelled, and pending executions skipped',
        campaign,
        cancelledExecutionsCount: cancelledExecutions.modifiedCount
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * GET /api/v1/campaigns/:id/enrollments
 * Real paginated enrollments and executions with masked phone and match explanations (Spec p.28, P2.j)
 */
campaignRouter.get('/campaigns/:id/enrollments', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const [enrollments, total] = await Promise.all([
      CampaignEnrollmentModel.find({ tenantId, campaignId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CampaignEnrollmentModel.countDocuments({ tenantId, campaignId: req.params.id })
    ]);

    const populated = await Promise.all(
      enrollments.map(async (enr) => {
        const customer = await CustomerModel.findOne({ id: enr.customerId, tenantId }).lean();
        const executions = await CampaignExecutionModel.find({
          tenantId,
          enrollmentId: enr.id
        }).lean();

        return {
          ...enr,
          customer: customer
            ? {
                id: customer.id,
                firstName: customer.firstName,
                lastName: customer.lastName,
                maskedPhone: maskPhone(customer.phone)
              }
            : null,
          executions
        };
      })
    );

    res.json({
      success: true,
      enrollments: populated,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/campaigns/:id/history
 * Real paginated executions history with masked phone numbers (Spec p.28, P2.j)
 */
campaignRouter.get('/campaigns/:id/history', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const [executions, total] = await Promise.all([
      CampaignExecutionModel.find({ tenantId, campaignId: req.params.id })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CampaignExecutionModel.countDocuments({ tenantId, campaignId: req.params.id })
    ]);

    const populated = await Promise.all(
      executions.map(async (exe) => {
        const enrollment = await CampaignEnrollmentModel.findOne({ id: exe.enrollmentId, tenantId }).lean();
        const customer = enrollment
          ? await CustomerModel.findOne({ id: enrollment.customerId, tenantId }).lean()
          : null;

        return {
          id: exe.id,
          stepId: exe.stepId,
          state: exe.state,
          outcomeReason: exe.outcomeReason,
          dueAt: exe.dueAt,
          updatedAt: exe.updatedAt,
          maskedPhone: customer ? maskPhone(customer.phone) : null,
          customerName: customer ? `${customer.firstName} ${customer.lastName}` : null
        };
      })
    );

    res.json({
      success: true,
      history: populated,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/enrollments/:id/resolve-hold
 * Staff action to release a conversation hold after replying to a customer (audited)
 */
campaignRouter.post(
  '/enrollments/:id/resolve-hold',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER', 'STAFF']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const enrollment = await CampaignEnrollmentModel.findOne({ id: req.params.id, tenantId });
      if (!enrollment) {
        return res.status(404).json({ success: false, error: 'Enrollment not found' });
      }

      enrollment.replyHoldAt = null;
      enrollment.planRevision += 1;
      await enrollment.save();

      // Append-only Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'staff',
        action: 'RESOLVE_HOLD',
        targetType: 'CAMPAIGN_ENROLLMENT',
        targetId: enrollment.id,
        details: { planRevision: enrollment.planRevision }
      });

      res.json({ success: true, message: 'Hold released by boutique staff', enrollment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/enrollments/:id/mark-goal
 * Staff action to manually mark occasion purchase or goal reached (audited)
 */
campaignRouter.post(
  '/enrollments/:id/mark-goal',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER', 'STAFF']),
  requireIdempotency,
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const enrollment = await CampaignEnrollmentModel.findOne({ id: req.params.id, tenantId });
      if (!enrollment) {
        return res.status(404).json({ success: false, error: 'Enrollment not found' });
      }

      enrollment.goalReachedAt = new Date();
      enrollment.goalOrderRef = req.body.orderRef || 'manual_staff_completion';
      enrollment.planRevision += 1;
      await enrollment.save();

      // Mark pending executions as SKIPPED_GOAL_REACHED
      await CampaignExecutionModel.updateMany(
        {
          tenantId,
          enrollmentId: enrollment.id,
          state: { $in: ['SCHEDULED', 'DEFERRED'] }
        },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: 'SKIPPED_GOAL_REACHED'
          }
        }
      );

      // Append-only Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'staff',
        action: 'MARK_GOAL',
        targetType: 'CAMPAIGN_ENROLLMENT',
        targetId: enrollment.id,
        details: { goalOrderRef: enrollment.goalOrderRef, planRevision: enrollment.planRevision }
      });

      res.json({ success: true, message: 'Goal marked; pending sales follow-ups skipped', enrollment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * GET /api/v1/campaign-activity
 * Activity log with plain-English explanation reasons (Spec p.28)
 */
campaignRouter.get('/campaign-activity', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const executions = await CampaignExecutionModel.find({ tenantId })
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean();

    const activity = await Promise.all(
      executions.map(async (exe) => {
        const enrollment = await CampaignEnrollmentModel.findOne({ id: exe.enrollmentId, tenantId }).lean();
        const campaign = await CampaignModel.findOne({ id: exe.campaignId, tenantId }).lean();

        let explanation = 'Scheduled for future due time';
        if (exe.state === 'PROVIDER_ACCEPTED') {
          explanation = 'Accepted by WhatsApp provider and delivered to patron.';
        } else if (exe.outcomeReason === 'SKIPPED_GOAL_REACHED') {
          explanation = 'Follow-up stopped because qualifying purchase was completed.';
        } else if (exe.outcomeReason === 'SKIPPED_REPLY_HOLD') {
          explanation = 'Follow-up held because customer replied; awaiting staff handling.';
        } else if (exe.outcomeReason === 'SKIPPED_CONTACT_CAP') {
          explanation = 'Skipped because patron already received marketing contact within 24h.';
        } else if (exe.outcomeReason === 'DEFERRED_CONTACT_CAP') {
          explanation = 'Deferred to next available slot due to 24h contact cap.';
        } else if (exe.outcomeReason === 'SKIPPED_MARKETING_OPT_OUT') {
          explanation = 'Skipped because customer opted out of promotional messages.';
        } else if (exe.outcomeReason === 'SKIPPED_STEP_EXPIRED') {
          explanation = 'Skipped because step passed its useful expiry window.';
        } else if (exe.outcomeReason === 'SKIPPED_ELAPSED') {
          explanation = 'Skipped past step on activation (future-only policy).';
        } else if (exe.outcomeReason === 'SKIPPED_CUSTOMER_DATE_REMOVED') {
          explanation = 'Cancelled because saved occasion date was removed.';
        } else if (exe.outcomeReason === 'SKIPPED_ALREADY_ACCEPTED') {
          explanation = 'Step was already accepted under previous date correction.';
        }

        return {
          id: exe.id,
          campaignName: campaign?.name || 'Campaign',
          stepId: exe.stepId,
          customerId: enrollment?.customerId || 'patron',
          occurrenceId: enrollment?.occurrenceId || '',
          state: exe.state,
          outcomeReason: exe.outcomeReason,
          explanation,
          dueAt: exe.dueAt,
          updatedAt: exe.updatedAt,
          enrollmentId: exe.enrollmentId,
          replyHoldAt: enrollment?.replyHoldAt,
          goalReachedAt: enrollment?.goalReachedAt
        };
      })
    );

    res.json({ success: true, activity });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/customers
 * Returns all patrons for tenant
 */
campaignRouter.get('/customers', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const customers = await CustomerModel.find({ tenantId }).lean();
    res.json({ success: true, customers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/templates
 * Returns pre-approved Meta WhatsApp templates
 */
campaignRouter.get('/templates', async (_req: Request, res: Response) => {
  res.json({ success: true, templates: APPROVED_TEMPLATES });
});

/**
 * GET /api/v1/campaigns/reports/owner-overview
 * Owner reporting overview with single-attribution net sales and reason precedence (Spec p.28, p.34)
 */
campaignRouter.get('/campaigns/reports/owner-overview', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const report = await generateOwnerOverviewReport(tenantId);
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/campaigns/reports/customer-timeline/:customerId
 * Customer lifecycle and execution timeline with masked recipient phone (Spec p.28)
 */
campaignRouter.get('/campaigns/reports/customer-timeline/:customerId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const timeline = await getCustomerTimeline(tenantId, customerId);
    res.json({ success: true, customerId, timeline });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/campaigns/monitoring/alerts
 * Operational alerts: planner lag, due-step age, event backlog, unknown outcomes, template blocks, stalled checkpoints (Spec p.28, p.34)
 */
campaignRouter.get('/campaigns/monitoring/alerts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const alertsReport = await getMonitoringAlerts(tenantId);
    res.json({ success: true, monitoring: alertsReport });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

