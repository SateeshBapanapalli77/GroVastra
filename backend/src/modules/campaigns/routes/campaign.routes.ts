import { Router, Request, Response } from 'express';
import { BOUTIQUE_CAMPAIGN_PRESETS, getCampaignPreset } from '../presets/boutiquePresets';
import { APPROVED_TEMPLATES, getApprovedTemplate } from '../adapters/templateCatalogue';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignDryRunModel } from '../models/CampaignDryRun.model';
import { evaluateCampaignDryRun } from '../engine/dryRun';
import { planAnnualOccasions } from '../engine/annualDateStrategy';
import { CustomerModel } from '../../crm/models/Customer.model';
import { generateId } from '../../../shared/utils/id';
import { env } from '../../../config/env';

import { requireAuth, requireRole, signJwt } from '../../../shared/middleware/auth.middleware';

export const campaignRouter = Router();

// Middleware: Authenticate credentials and enforce tenant isolation
campaignRouter.use(requireAuth);

/**
 * POST /api/v1/auth/token
 * Generate development/test bearer token with tenant claims
 */
campaignRouter.post('/auth/token', (req: Request, res: Response) => {
  const tenantId = req.body.tenantId || req.tenantId || env.DEFAULT_TENANT_ID;
  const role = req.body.role || 'BOUTIQUE_OWNER';
  const token = signJwt({
    userId: req.body.userId || 'usr_boutique_owner',
    tenantId,
    role
  });
  res.json({ success: true, token, tenantId, role });
});

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
 */
campaignRouter.get('/campaign-settings', (req: Request, res: Response) => {
  res.json({
    success: true,
    settings: {
      timezone: 'Asia/Kolkata',
      allowedHours: { start: '10:00', end: '19:00' },
      caps: {
        marketing24h: 1,
        marketing7d: 3
      },
      globalPause: false,
      outageGraceMinutes: 120,
      leapDayPolicy: 'FEB_28',
      notice:
        'This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.'
    }
  });
});

/**
 * GET /api/v1/campaigns
 */
campaignRouter.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const campaigns = await CampaignModel.find({ tenantId }).sort({ updatedAt: -1 }).lean();

    // Attach activeVersion and enrolled counts
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
campaignRouter.post('/campaigns', async (req: Request, res: Response) => {
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
      publishedBy: 'owner',
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
});

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
 */
campaignRouter.patch('/campaigns/:id/draft', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, trigger, audience, steps, priority, timezone } = req.body;

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

    // Invariant: If draft is currently the active/live version, clone a new immutable draft revision (Page 16)
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
        publishedBy: 'owner',
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
});

/**
 * POST /api/v1/campaigns/:id/dry-runs
 * Run pre-flight dry-run evaluation on the draft version
 */
campaignRouter.post('/campaigns/:id/dry-runs', async (req: Request, res: Response) => {
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
});

/**
 * POST /api/v1/campaigns/:id/activate
 * Publish immutable version and execute calendar planner (requires reviewFingerprint from real dry run)
 */
campaignRouter.post(
  '/campaigns/:id/activate',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { reviewFingerprint } = req.body;

      // Mandatory review fingerprint check (Handoff Page 21)
      if (!reviewFingerprint) {
        return res.status(400).json({
          success: false,
          error: 'Mandatory reviewFingerprint is required to activate a campaign. Run dry run first.'
        });
      }

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

      // Verify fingerprint matches draft review
      if (draft.reviewFingerprint !== reviewFingerprint) {
        return res.status(400).json({
          success: false,
          error: 'Review fingerprint mismatch. The draft was modified after the dry run.'
        });
      }

      // Verify that a real persisted dry run audit exists
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

      // Freeze active version
      campaign.status = 'ACTIVE';
      campaign.activeVersionId = draft.id;
      campaign.activatedAt = new Date();
      await campaign.save();

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

    // Re-stamp all pending executions with the new pauseGeneration so they are re-enabled and not stranded!
    await CampaignExecutionModel.updateMany(
      { campaignId: campaign.id, tenantId, state: { $in: ['SCHEDULED', 'DEFERRED'] } },
      { $set: { pauseGeneration: campaign.pauseGeneration, 'lease.token': null, 'lease.until': null } }
    );

    res.json({ success: true, campaign });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/validate
 * Validates campaign configuration, step approved templates, and parameter bindings
 */
campaignRouter.post('/campaigns/:id/validate', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    // Load active or draft version
    const version = campaign.activeVersionId
      ? await CampaignVersionModel.findOne({ id: campaign.activeVersionId, tenantId })
      : await CampaignVersionModel.findOne({ campaignId: campaign.id, tenantId }).sort({ version: -1 });

    if (!version) {
      return res.status(400).json({ success: false, error: 'No campaign version found to validate' });
    }

    const validationErrors: string[] = [];

    if (!version.steps || version.steps.length === 0) {
      validationErrors.push('Campaign must have at least one execution step');
    }

    for (const step of version.steps || []) {
      const template = getApprovedTemplate(step.templateRef.id);
      if (!template) {
        validationErrors.push(`Step '${step.stepId}' references unapproved template '${step.templateRef.id}'`);
      }
      if (!step.localTime || !/^\d{2}:\d{2}$/.test(step.localTime)) {
        validationErrors.push(`Step '${step.stepId}' has invalid localTime '${step.localTime}' (expected HH:mm)`);
      }
    }

    if (validationErrors.length > 0) {
      return res.status(422).json({
        success: false,
        valid: false,
        errors: validationErrors
      });
    }

    campaign.status = 'VALIDATED';
    await campaign.save();

    res.json({
      success: true,
      valid: true,
      status: 'VALIDATED',
      campaign,
      versionId: version.id,
      validatedSteps: version.steps.length
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/publish-revision
 * Creates a new immutable version revision and updates activeVersionId atomically
 */
/**
 * POST /api/v1/campaigns/:id/publish-revision
 * Enforces full review lifecycle (optimistic concurrency, template check, dry-run fingerprint)
 */
campaignRouter.post(
  '/campaigns/:id/publish-revision',
  requireRole(['BOUTIQUE_OWNER', 'STORE_MANAGER']),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { expectedVersion, reviewFingerprint } = req.body;

      const campaign = await CampaignModel.findOne({ id: req.params.id, tenantId });
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

      // 1. Optimistic Concurrency Control (expectedVersion check)
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

      const newVersionNumber = updatedCampaign.draftVersion;
      const newVersionId = generateId('cv');

      const newVersion = await CampaignVersionModel.create({
        id: newVersionId,
        tenantId,
        campaignId: campaign.id,
        version: newVersionNumber,
        name: currentVersion.name,
        industry: currentVersion.industry,
        purpose: currentVersion.purpose,
        trigger: req.body.trigger || currentVersion.trigger,
        timezone: req.body.timezone || currentVersion.timezone,
        audience: req.body.audience || currentVersion.audience,
        goal: req.body.goal || currentVersion.goal,
        steps: candidateSteps,
        priority: req.body.priority || currentVersion.priority,
        resumePolicy: currentVersion.resumePolicy || 'FUTURE_ONLY',
        importPolicy: 'FUTURE_ONLY',
        enabledBranches: currentVersion.enabledBranches || [],
        publishedBy: req.user?.userId || 'boutique_manager',
        publishedAt: new Date(),
        reviewFingerprint
      });

      updatedCampaign.activeVersionId = newVersion.id;
      await updatedCampaign.save();

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
 * Real paginated enrollments and executions
 */
campaignRouter.get('/campaigns/:id/enrollments', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const enrollments = await CampaignEnrollmentModel.find({
      tenantId,
      campaignId: req.params.id
    })
      .sort({ createdAt: -1 })
      .lean();

    const populated = await Promise.all(
      enrollments.map(async (enr) => {
        const executions = await CampaignExecutionModel.find({
          tenantId,
          enrollmentId: enr.id
        }).lean();
        return {
          ...enr,
          executions
        };
      })
    );

    res.json({ success: true, enrollments: populated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/enrollments/:id/resolve-hold
 * Staff action to release a conversation hold after replying to a customer
 */
campaignRouter.post('/enrollments/:id/resolve-hold', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const enrollment = await CampaignEnrollmentModel.findOne({ id: req.params.id, tenantId });
    if (!enrollment) {
      return res.status(404).json({ success: false, error: 'Enrollment not found' });
    }

    enrollment.replyHoldAt = null;
    enrollment.planRevision += 1;
    await enrollment.save();

    res.json({ success: true, message: 'Hold released by boutique staff', enrollment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/enrollments/:id/mark-goal
 * Staff action to manually mark occasion purchase or goal reached
 */
campaignRouter.post('/enrollments/:id/mark-goal', async (req: Request, res: Response) => {
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

    res.json({ success: true, message: 'Goal marked; pending sales follow-ups skipped', enrollment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/campaign-activity
 * Activity log with plain-English explanation reasons (Handoff Page 28)
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

