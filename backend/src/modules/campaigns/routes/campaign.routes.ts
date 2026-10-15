import { Router, Request, Response } from 'express';
import { BOUTIQUE_CAMPAIGN_PRESETS, getCampaignPreset } from '../presets/boutiquePresets';
import { APPROVED_TEMPLATES, getApprovedTemplate } from '../adapters/templateCatalogue';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignDryRunModel } from '../models/CampaignDryRun.model';
import { TenantSettingsModel, REQUIRED_SETTINGS_NOTICE } from '../models/TenantSettings.model';
import { TenantControlGateModel } from '../models/TenantControlGate.model';
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
import {
  generateOwnerOverviewReport,
  getCustomerTimeline,
  getMonitoringAlerts
} from '../engine/ownerReporting';

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
    res.status(500).json({ success: false, error: err.message });
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
        blackouts
      } = req.body;

      let settings = await TenantSettingsModel.findOne({ tenantId });
      if (!settings) {
        settings = await TenantSettingsModel.create({
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
          notice: REQUIRED_SETTINGS_NOTICE
        });
      }

      // Optimistic concurrency control (Spec C16)
      if (typeof expectedVersion === 'number' && settings.version !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Settings version conflict: expected version ${expectedVersion}, but settings are at version ${settings.version}.`
        });
      }

      if (timezone) settings.timezone = timezone;
      if (allowedHours) settings.allowedHours = allowedHours;
      if (caps) settings.caps = caps;
      if (typeof outageGraceMinutes === 'number') settings.outageGraceMinutes = outageGraceMinutes;
      if (leapDayPolicy) settings.leapDayPolicy = leapDayPolicy;
      if (Array.isArray(holidays)) settings.holidays = holidays;
      if (Array.isArray(blackouts)) settings.blackouts = blackouts;

      if (typeof globalPause === 'boolean' && globalPause !== settings.globalPause) {
        settings.globalPause = globalPause;
        // Sync with TenantControlGateModel (P1.c)
        let tenantGate = await TenantControlGateModel.findOne({ tenantId });
        if (!tenantGate) {
          await TenantControlGateModel.create({
            id: generateId('tg'),
            tenantId,
            globalPause,
            gateVersion: 1
          });
        } else {
          tenantGate.globalPause = globalPause;
          tenantGate.gateVersion += 1;
          await tenantGate.save();
        }
      }

      settings.version += 1;
      settings.notice = REQUIRED_SETTINGS_NOTICE; // Strict invariant: cannot alter required notice
      await settings.save();

      // Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'owner',
        action: 'UPDATE_SETTINGS',
        targetType: 'TENANT_SETTINGS',
        targetId: settings.id,
        details: { version: settings.version, globalPause: settings.globalPause }
      });

      res.json({
        success: true,
        settings: {
          id: settings.id,
          version: settings.version,
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
      res.status(500).json({ success: false, error: err.message });
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
          activeVersion = await CampaignVersionModel.findOne({ id: c.activeVersionId }).lean();
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

      const preset = presetId ? getCampaignPreset(presetId) : null;
      const campaignId = generateId('cmp');
      const versionId = generateId('cv');

      const newCampaign = await CampaignModel.create({
        id: campaignId,
        tenantId,
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

      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' });
      }

      // Optimistic concurrency control (Spec C16)
      if (typeof expectedVersion === 'number' && campaign.draftVersion !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Draft version conflict: expected version ${expectedVersion}, but draft is at version ${campaign.draftVersion}.`
        });
      }

      const draft = await CampaignVersionModel.findOne({
        campaignId: campaign.id,
        tenantId,
        version: campaign.draftVersion
      });

      if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft version not found' });
      }

      // Invariant: If draft is currently the active/live version, clone a new immutable draft revision (Spec p.16)
      if (campaign.activeVersionId === draft.id) {
        const nextVersionNumber = (campaign.draftVersion || 1) + 1;
        const newVersionId = generateId('cv');

        const clonedDraft = await CampaignVersionModel.create({
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
        });

        campaign.draftVersion = nextVersionNumber;
        if (name) campaign.name = name;
        await campaign.save();

        return res.json({ success: true, campaign, draftVersion: clonedDraft });
      }

      if (name) {
        campaign.name = name;
        draft.name = name;
        await campaign.save();
      }
      if (trigger) draft.trigger = { ...draft.trigger, ...trigger };
      if (audience) draft.audience = audience;
      if (steps) draft.steps = steps;
      if (priority) draft.priority = priority;
      if (timezone) draft.timezone = timezone;

      draft.reviewFingerprint = `draft_${Date.now()}`;
      await draft.save();

      res.json({ success: true, campaign, draftVersion: draft });
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

      // Concurrency check (C16)
      if (typeof expectedVersion === 'number' && campaign.draftVersion !== expectedVersion) {
        return res.status(409).json({
          success: false,
          error: `Version conflict: expected base version ${expectedVersion}, but draft is at version ${campaign.draftVersion}.`
        });
      }

      const draft = await CampaignVersionModel.findOne({
        campaignId: campaign.id,
        tenantId,
        version: campaign.draftVersion
      });

      if (!draft) {
        return res.status(404).json({ success: false, error: 'Draft version not found' });
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

      // Activation Readiness Checks (Spec A05): Block activation if template, binding or connection missing
      for (const step of draft.steps || []) {
        const template = getApprovedTemplate(step.templateRef?.id);
        if (!template || template.status === 'PAUSED') {
          return res.status(422).json({
            success: false,
            error: `Activation blocked: Step '${step.stepId}' references unusable template '${step.templateRef?.id}'.`,
            fieldPath: `steps.${step.stepId}.templateRef.id`,
            resolutionOwner: 'INTEGRATION_DEVELOPER'
          });
        }
      }

      const connection = await TenantConnectionModel.findOne({ tenantId, active: true });
      if (!connection) {
        return res.status(422).json({
          success: false,
          error: 'Activation blocked: No active WhatsApp connection provisioned for this boutique.',
          fieldPath: 'connectionId',
          resolutionOwner: 'INTEGRATION_DEVELOPER'
        });
      }

      // Freeze immutable active version (Spec p.21)
      draft.publishedAt = new Date();
      draft.publishedBy = (req as any).user?.userId || 'owner';
      await draft.save();

      campaign.status = 'ACTIVE';
      campaign.activeVersionId = draft.id;
      campaign.activatedAt = new Date();
      await campaign.save();

      // Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'owner',
        action: 'ACTIVATE_CAMPAIGN',
        targetType: 'CAMPAIGN',
        targetId: campaign.id,
        details: { versionId: draft.id, version: draft.version, reviewFingerprint }
      });

      // Trigger calendar planning for annual date occasions
      let planningResult = null;
      if (draft.trigger.type === 'ANNUAL_DATE') {
        planningResult = await planAnnualOccasions(draft);
      }

      res.json({
        success: true,
        campaign,
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
 */
campaignRouter.post('/campaigns/:id/pause', requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    campaign.status = 'PAUSED';
    campaign.pauseGeneration += 1;
    await campaign.save();

    // Invalidate in-flight evaluation leases
    await CampaignExecutionModel.updateMany(
      { campaignId: campaign.id, tenantId, state: 'EVALUATING' },
      { $set: { state: 'DEFERRED', 'lease.token': null, 'lease.until': null, outcomeReason: 'DEFERRED_CAMPAIGN_PAUSED' } }
    );

    res.json({ success: true, campaign });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

campaignRouter.post('/campaigns/:id/resume', requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    campaign.status = 'ACTIVE';
    campaign.pauseGeneration += 1;
    await campaign.save();

    // Re-stamp all pending executions with the new pauseGeneration so they are re-enabled
    await CampaignExecutionModel.updateMany(
      { campaignId: campaign.id, tenantId, state: { $in: ['SCHEDULED', 'DEFERRED'] } },
      { $set: { pauseGeneration: campaign.pauseGeneration, 'lease.token': null, 'lease.until': null } }
    );

    res.json({ success: true, campaign });
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
  const connection = await TenantConnectionModel.findOne({ tenantId, active: true });
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
    for (const step of version.steps) {
      const template = getApprovedTemplate(step.templateRef?.id);
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

        for (const varKey of template.variableKeys) {
          const bound = rawBindings[varKey];
          if (!bound && varKey !== 'name' && varKey !== 'shop') {
            errors.push({
              fieldPath: `steps.${step.stepId}.bindings.${varKey}`,
              message: `Template variable '${varKey}' is not mapped to a customer or store attribute.`,
              resolutionOwner: 'BOUTIQUE_OWNER'
            });
          }
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

    const version = campaign.activeVersionId
      ? await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId })
      : await CampaignVersionModel.findOne({ campaignId: campaign.id, tenantId }).sort({ version: -1 });

    if (!version) {
      return res.status(400).json({ success: false, error: 'No campaign version found to validate' });
    }

    const { valid: isValid, errors, warnings } = await validateCampaignVersionDefinition(version, tenantId);

    if (isValid) {
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

      // 1. Optimistic Concurrency Control (expectedVersion check, C16)
      if (typeof expectedVersion === 'number' && campaign.draftVersion !== expectedVersion) {
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

      // 3. Template Validation
      for (const step of candidateSteps) {
        const tpl = getApprovedTemplate(step.templateRef?.id);
        if (!tpl) {
          return res.status(422).json({
            success: false,
            error: `Step '${step.stepId}' references unapproved template '${step.templateRef?.id}'`
          });
        }
      }

      // 4. Atomic draftVersion CAS increment
      const updatedCampaign = await CampaignModel.findOneAndUpdate(
        { id: campaign.id, tenantId, draftVersion: campaign.draftVersion },
        { $inc: { draftVersion: 1 } },
        { new: true }
      );

      if (!updatedCampaign) {
        return res.status(409).json({
          success: false,
          error: 'Concurrent version update conflict detected.'
        });
      }

      const baseVersion = currentVersion.toObject ? currentVersion.toObject() : currentVersion;
      const newVersionId = generateId('cv');
      const newVersionNumber = (currentVersion.version || 1) + 1;

      const newVersion = await CampaignVersionModel.create({
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
      });

      updatedCampaign.activeVersionId = newVersion.id;
      await updatedCampaign.save();

      // Audit Log
      await AuditLogModel.create({
        id: generateId('aud'),
        tenantId,
        userId: (req as any).user?.userId || 'owner',
        action: 'PUBLISH_REVISION',
        targetType: 'CAMPAIGN',
        targetId: campaign.id,
        details: { versionId: newVersion.id, version: newVersion.version, reviewFingerprint }
      });

      res.json({
        success: true,
        message: `Version ${newVersionNumber} published successfully`,
        campaign: updatedCampaign,
        activeVersion: newVersion
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

