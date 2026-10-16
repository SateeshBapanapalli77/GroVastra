import { z } from 'zod';

/**
 * Zod Boundary Schemas for GroVastra Auto Campaigns (Phase 0, Item 4)
 * Parses and strictly validates all data crossing the HTTP boundary.
 */

export const UserRoleSchema = z.enum(['BOUTIQUE_OWNER', 'STORE_MANAGER', 'STAFF', 'SYSTEM']);

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().optional(),
  role: UserRoleSchema,
  tenantId: z.string(),
  shopName: z.string().default('Heritage Boutique')
});

export const LoginResponseSchema = z.object({
  success: z.boolean(),
  token: z.string(),
  user: UserSchema
});

export const MeResponseSchema = z.object({
  success: z.boolean(),
  user: UserSchema
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false).default(false),
  error: z.string(),
  code: z.string(),
  fieldPath: z.string().optional()
});

export const IntegrationReadinessSchema = z.object({
  success: z.boolean(),
  ready: z.boolean(),
  connection: z.object({
    status: z.string(),
    connectionId: z.string().nullable().optional(),
    phoneNumberId: z.string().nullable().optional(),
    verifiedName: z.string().nullable().optional()
  }),
  templates: z.array(
    z.object({
      templateId: z.string(),
      name: z.string(),
      category: z.string(),
      status: z.string(),
      languages: z.array(z.string()).default([])
    })
  ).default([]),
  missingConfiguration: z.array(z.string()).default([])
});

export const TenantSettingsDataSchema = z.object({
  id: z.string().optional(),
  version: z.number().default(1),
  storeName: z.string().nullable().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  allowedHours: z.object({
    start: z.string().default('10:00'),
    end: z.string().default('19:00')
  }),
  caps: z.object({
    marketing24h: z.number().default(1),
    marketing7d: z.number().default(3)
  }),
  globalPause: z.boolean().default(false),
  outageGraceMinutes: z.number().default(120),
  leapDayPolicy: z.enum(['FEB_28', 'MAR_01', 'LEAP_ONLY']).default('FEB_28'),
  holidays: z.array(z.string()).default([]),
  blackouts: z.array(z.string()).default([]),
  notice: z.string().default('')
});

export const TenantSettingsResponseSchema = z.object({
  success: z.boolean(),
  settings: TenantSettingsDataSchema
});

export const CampaignStatusSchema = z.enum(['DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'ARCHIVED']);

export const CampaignItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().default('MARKETING'),
  industry: z.string().default('BOUTIQUE'),
  type: z.string().optional(),
  status: CampaignStatusSchema,
  activeVersionId: z.string().nullable().optional(),
  draftVersion: z.number().default(1),
  pauseGeneration: z.number().default(0),
  enrolledCount: z.number().default(0),
  activeVersion: z.any().nullable().optional(),
  activatedAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional()
});

export const CampaignsListResponseSchema = z.object({
  success: z.boolean(),
  campaigns: z.array(CampaignItemSchema).default([])
});

export const CampaignDetailResponseSchema = z.object({
  success: z.boolean(),
  campaign: CampaignItemSchema,
  activeVersion: z.any().nullable().optional(),
  latestDraft: z.any().nullable().optional()
});

export const CampaignActivityItemSchema = z.object({
  id: z.string(),
  campaignName: z.string().default('Campaign'),
  stepId: z.string().optional(),
  customerId: z.string().default('patron'),
  occurrenceId: z.string().optional(),
  state: z.string(),
  outcomeReason: z.string().nullable().optional(),
  explanation: z.string().optional(),
  dueAt: z.string().optional(),
  updatedAt: z.string().optional(),
  enrollmentId: z.string().optional(),
  replyHoldAt: z.string().nullable().optional(),
  goalReachedAt: z.string().nullable().optional()
});

export const CampaignActivityResponseSchema = z.object({
  success: z.boolean(),
  activity: z.array(CampaignActivityItemSchema).default([])
});

export const OwnerOverviewReportSchema = z.object({
  tenantId: z.string(),
  generatedAt: z.string(),
  eligibleCustomers: z.number().default(0),
  enrollments: z.object({
    total: z.number().default(0),
    active: z.number().default(0),
    completed: z.number().default(0),
    cancelled: z.number().default(0)
  }),
  executions: z.object({
    scheduled: z.number().default(0),
    deferred: z.number().default(0),
    skipped: z.number().default(0),
    cancelled: z.number().default(0),
    expired: z.number().default(0),
    dispatching: z.number().default(0),
    accepted: z.number().default(0),
    delivered: z.number().default(0),
    read: z.number().default(0),
    unknown: z.number().default(0)
  }),
  evidenceCounts: z.object({
    accepted: z.number().default(0),
    delivered: z.number().default(0),
    read: z.number().default(0)
  }),
  repliesAndHolds: z.object({
    totalHeldEnrollments: z.number().default(0),
    skippedReplyHoldExecutions: z.number().default(0)
  }),
  goalCompletions: z.object({
    totalGoalEnrollments: z.number().default(0),
    skippedGoalExecutions: z.number().default(0)
  }),
  salesAttribution: z.object({
    rule: z.string().default('SINGLE_ATTRIBUTION_WINDOW'),
    attributedOrdersCount: z.number().default(0),
    attributedNetSalesPaise: z.number().default(0),
    unassignedOrdersCount: z.number().default(0),
    unassignedNetSalesPaise: z.number().default(0)
  }),
  reasonsSummary: z.record(z.string(), z.number()).default({})
});

export const OwnerOverviewReportResponseSchema = z.object({
  success: z.boolean(),
  report: OwnerOverviewReportSchema
});

export const ApprovedTemplateItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().default('MARKETING'),
  revision: z.number().default(1),
  language: z.string().default('en'),
  status: z.string().default('APPROVED'),
  bodyTemplate: z.string().optional(),
  variableKeys: z.array(z.string()).default([]),
  components: z.array(z.any()).default([])
});

export type ApprovedTemplateItem = z.infer<typeof ApprovedTemplateItemSchema>;

export const ApprovedTemplateCatalogueResponseSchema = z.object({
  success: z.boolean(),
  templates: z.array(ApprovedTemplateItemSchema)
});

export const CampaignPresetItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().default('OCCASION'),
  purpose: z.string().default('MARKETING'),
  type: z.string().optional(),
  implemented: z.boolean().default(true),
  isImplemented: z.boolean().optional(),
  defaultPriority: z.number().default(80),
  trigger: z.any().optional(),
  defaultSteps: z.array(z.any()).default([]),
  requiredEvents: z.array(z.string()).default([]),
  requiredData: z.array(z.string()).default([])
});

export const CampaignPresetsResponseSchema = z.object({
  success: z.boolean(),
  presets: z.array(CampaignPresetItemSchema)
});

export const CustomerItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  phone: z.string().optional(),
  tags: z.array(z.string()).default([]),
  preferences: z.any().optional(),
  optedOut: z.boolean().default(false),
  createdAt: z.string().optional()
});

export const CustomersResponseSchema = z.object({
  success: z.boolean(),
  customers: z.array(CustomerItemSchema).default([])
});

export const DryRunStepSchema = z.object({
  stepId: z.string(),
  dueAtUtc: z.union([z.string(), z.date()]),
  localTime: z.string(),
  renderedPreview: z.string()
});

export const DryRunSamplePlanSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  occasionDate: z.string(),
  steps: z.array(DryRunStepSchema).default([])
});

export const DryRunSummarySchema = z.object({
  totalEvaluated: z.number().default(0),
  eligibleCount: z.number().default(0),
  excludedCount: z.number().default(0)
});

export const DryRunDataSchema = z.object({
  dryRunId: z.string(),
  draftFingerprint: z.string(),
  evaluatedAt: z.union([z.string(), z.date()]),
  summary: DryRunSummarySchema,
  reasonBreakdown: z.record(z.string(), z.number()).default({}),
  samplePlans: z.array(DryRunSamplePlanSchema).default([])
});

export const DryRunResponseSchema = z.object({
  success: z.boolean(),
  dryRun: DryRunDataSchema
});

export const MonitoringAlertItemSchema = z.object({
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  code: z.string(),
  message: z.string()
});

export const MonitoringAlertsSchema = z.object({
  tenantId: z.string(),
  evaluatedAt: z.string(),
  status: z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL']),
  alerts: z.array(MonitoringAlertItemSchema).default([]),
  metrics: z.object({
    plannerLagMinutes: z.number().default(0),
    dueStepAgeMinutes: z.number().default(0),
    eventBacklogCount: z.number().default(0),
    unknownOutcomesCount: z.number().default(0),
    templateBlocksCount: z.number().default(0),
    stalledCheckpointsCount: z.number().default(0)
  })
});

export const MonitoringAlertsResponseSchema = z.object({
  success: z.boolean(),
  monitoring: MonitoringAlertsSchema
});

export const CampaignEnrollmentItemSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  campaignId: z.string(),
  campaignVersionId: z.string().optional(),
  customerId: z.string(),
  occurrenceId: z.string(),
  sourceRef: z.any().optional(),
  occasionLocalDate: z.string().optional(),
  planRevision: z.number().default(1),
  status: z.string().default('ACTIVE'),
  replyHoldAt: z.union([z.string(), z.date()]).nullish(),
  goalReachedAt: z.union([z.string(), z.date()]).nullish(),
  goalOrderRef: z.string().optional(),
  goalNetPaise: z.number().optional(),
  matchExplanation: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  customer: z
    .object({
      id: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      maskedPhone: z.string().optional()
    })
    .nullish(),
  executions: z.array(z.any()).default([])
});

export const PaginationMetaSchema = z.object({
  page: z.number().default(1),
  limit: z.number().default(20),
  total: z.number().default(0),
  totalPages: z.number().default(1)
});

export const CampaignEnrollmentsResponseSchema = z.object({
  success: z.boolean(),
  enrollments: z.array(CampaignEnrollmentItemSchema).default([]),
  pagination: PaginationMetaSchema
});

export const CampaignHistoryItemSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  state: z.string(),
  outcomeReason: z.string().nullish(),
  dueAt: z.union([z.string(), z.date()]).nullish(),
  updatedAt: z.union([z.string(), z.date()]).nullish(),
  maskedPhone: z.string().nullish(),
  customerName: z.string().nullish()
});

export const CampaignHistoryResponseSchema = z.object({
  success: z.boolean(),
  history: z.array(CampaignHistoryItemSchema).default([]),
  pagination: PaginationMetaSchema
});

export const CustomerTimelineItemSchema = z.object({
  id: z.string(),
  type: z.enum(['ENROLLMENT', 'EXECUTION', 'REPLY_HOLD', 'GOAL_REACHED']),
  campaignId: z.string(),
  campaignName: z.string().optional(),
  stepId: z.string().optional(),
  timestamp: z.string(),
  status: z.string(),
  reason: z.string().nullish(),
  details: z.record(z.string(), z.any()).optional()
});

export const CustomerTimelineResponseSchema = z.object({
  success: z.boolean(),
  customerId: z.string(),
  timeline: z.array(CustomerTimelineItemSchema).default([])
});

export type CampaignPresetItem = z.infer<typeof CampaignPresetItemSchema>;
export type CampaignItem = z.infer<typeof CampaignItemSchema>;
export type TenantSettingsData = z.infer<typeof TenantSettingsDataSchema>;
export type DryRunData = z.infer<typeof DryRunDataSchema>;
export type DryRunSamplePlan = z.infer<typeof DryRunSamplePlanSchema>;
export type MonitoringAlerts = z.infer<typeof MonitoringAlertsSchema>;
export type CampaignEnrollmentItem = z.infer<typeof CampaignEnrollmentItemSchema>;
export type CampaignHistoryItem = z.infer<typeof CampaignHistoryItemSchema>;
export type CustomerTimelineItem = z.infer<typeof CustomerTimelineItemSchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
