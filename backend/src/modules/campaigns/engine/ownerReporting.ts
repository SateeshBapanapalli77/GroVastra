import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../models/CampaignDeliveryIntent.model';
import { CampaignEventInboxModel } from '../models/CampaignEventInbox.model';
import { CampaignCheckpointModel } from '../models/CampaignCheckpoint.model';
import { CustomerModel } from '../../crm/models/Customer.model';
import { OrderModel } from '../../orders/models/Order.model';
import { TenantSettingsModel } from '../models/TenantSettings.model';
import { maskPhone } from '../../../shared/utils/phone';

export interface OwnerOverviewReport {
  tenantId: string;
  generatedAt: string;
  eligibleCustomers: number;
  enrollments: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
  };
  executions: {
    scheduled: number;
    deferred: number;
    skipped: number;
    cancelled: number;
    expired: number;
    dispatching: number;
    accepted: number;
    delivered: number;
    read: number;
    unknown: number;
  };
  evidenceCounts: {
    accepted: number;
    delivered: number;
    read: number;
  };
  repliesAndHolds: {
    totalHeldEnrollments: number;
    skippedReplyHoldExecutions: number;
  };
  goalCompletions: {
    totalGoalEnrollments: number;
    skippedGoalExecutions: number;
  };
  salesAttribution: {
    rule: string;
    attributedOrdersCount: number;
    attributedNetSalesPaise: number;
    unassignedOrdersCount: number;
    unassignedNetSalesPaise: number;
  };
  reasonsSummary: Record<string, number>;
}

export interface CustomerTimelineItem {
  id: string;
  type: 'ENROLLMENT' | 'EXECUTION' | 'REPLY_HOLD' | 'GOAL_REACHED';
  campaignId: string;
  campaignName?: string;
  timestamp: string;
  status: string;
  stepId?: string;
  details?: Record<string, any>;
  reason?: string | null;
}

export interface MonitoringAlertsReport {
  tenantId: string;
  evaluatedAt: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  alerts: Array<{ severity: 'INFO' | 'WARNING' | 'CRITICAL'; code: string; message: string }>;
  metrics: {
    plannerLagMinutes: number;
    dueStepAgeMinutes: number;
    eventBacklogCount: number;
    unknownOutcomesCount: number;
    templateBlocksCount: number;
    stalledCheckpointsCount: number;
  };
}

/**
 * Standard Reason Precedence Evaluator (Spec p.33):
 * 1. CUSTOMER_DELETED or CHANNEL_SUPPRESSED
 * 2. CAMPAIGN_OR_GLOBAL_PAUSED
 * 3. INVALID_SOURCE_OR_DATE
 * 4. STEP_EXPIRED
 * 5. GOAL_REACHED
 * 6. REPLY_HOLD
 * 7. CONTENT_OR_TEMPLATE_BLOCKED
 * 8. PREREQUISITE_NOT_MET
 * 9. CONTACT_CAP_EXCEEDED
 */
export function getPrimaryReason(outcomeReason: string | null | undefined): string {
  if (!outcomeReason) return 'NONE';

  const reason = outcomeReason.toUpperCase();
  if (reason.includes('SUPPRESSED') || reason.includes('DELETED') || reason.includes('OPT_OUT') || reason.includes('OPTED_OUT')) {
    return 'CUSTOMER_DELETED_OR_SUPPRESSED';
  }
  if (reason.includes('PAUSE')) {
    return 'CAMPAIGN_OR_GLOBAL_PAUSED';
  }
  if (reason.includes('DATE') || reason.includes('INVALID_SOURCE') || reason.includes('NO_OCCASION')) {
    return 'INVALID_SOURCE_OR_DATE';
  }
  if (reason.includes('EXPIRE') || reason.includes('OUTAGE')) {
    return 'STEP_EXPIRED';
  }
  if (reason.includes('GOAL')) {
    return 'GOAL_REACHED';
  }
  if (reason.includes('REPLY') || reason.includes('_HOLD') || reason === 'HOLD') {
    return 'REPLY_HOLD';
  }
  if (reason.includes('TEMPLATE') || reason.includes('PLACEHOLDER') || reason.includes('CONTENT')) {
    return 'CONTENT_OR_TEMPLATE_BLOCKED';
  }
  if (reason.includes('PREREQUISITE')) {
    return 'PREREQUISITE_NOT_MET';
  }
  if (reason.includes('CAP') || reason.includes('COLLISION')) {
    return 'CONTACT_CAP_EXCEEDED';
  }

  return reason;
}

/**
 * Owner Reporting Overview (Spec p.28, p.34)
 */
export async function generateOwnerOverviewReport(tenantId: string): Promise<OwnerOverviewReport> {
  const serverNow = new Date();

  // 1. Total customers matching active campaigns (estimate of eligible customers)
  const eligibleCustomers = await CustomerModel.countDocuments({
    tenantId,
    status: 'ACTIVE',
    channelSuppressed: false,
    optedInMarketing: true
  });

  // 2. Enrollments count
  const [totalEnr, activeEnr, completedEnr, cancelledEnr] = await Promise.all([
    CampaignEnrollmentModel.countDocuments({ tenantId }),
    CampaignEnrollmentModel.countDocuments({ tenantId, status: 'ACTIVE' }),
    CampaignEnrollmentModel.countDocuments({ tenantId, status: 'COMPLETED' }),
    CampaignEnrollmentModel.countDocuments({ tenantId, status: 'CANCELLED' })
  ]);

  // 3. Execution counts by state
  const executions = await CampaignExecutionModel.find({ tenantId }).lean();
  let scheduled = 0;
  let deferred = 0;
  let skipped = 0;
  let cancelled = 0;
  let expired = 0;
  let dispatching = 0;
  let accepted = 0;
  let delivered = 0;
  let read = 0;
  let unknown = 0;
  const reasonsSummary: Record<string, number> = {};

  for (const exe of executions) {
    switch (exe.state) {
      case 'SCHEDULED':
      case 'EVALUATING':
      case 'RETRY_WAIT':
        scheduled++;
        break;
      case 'DEFERRED':
        deferred++;
        break;
      case 'SKIPPED':
        if (exe.outcomeReason && (exe.outcomeReason.includes('EXPIRE') || exe.outcomeReason.includes('OUTAGE'))) {
          expired++;
        } else if (exe.outcomeReason && exe.outcomeReason.includes('CANCEL')) {
          cancelled++;
        } else {
          skipped++;
        }
        break;
      case 'BLOCKED':
      case 'FAILED':
        skipped++;
        break;
      case 'DISPATCHING':
        dispatching++;
        break;
      case 'PROVIDER_ACCEPTED':
        accepted++;
        break;
      case 'DELIVERED':
        delivered++;
        break;
      case 'READ':
        read++;
        break;
      case 'OUTCOME_UNKNOWN':
        unknown++;
        break;
    }

    if (exe.outcomeReason) {
      const primary = getPrimaryReason(exe.outcomeReason);
      reasonsSummary[primary] = (reasonsSummary[primary] || 0) + 1;
    }
  }

  // 4. Replies and holds
  const totalHeldEnrollments = await CampaignEnrollmentModel.countDocuments({
    tenantId,
    replyHoldAt: { $ne: null }
  });

  const skippedReplyHoldExecutions = await CampaignExecutionModel.countDocuments({
    tenantId,
    outcomeReason: { $regex: /REPLY_HOLD/i }
  });

  // 5. Goal completions
  const totalGoalEnrollments = await CampaignEnrollmentModel.countDocuments({
    tenantId,
    goalReachedAt: { $ne: null }
  });

  const skippedGoalExecutions = await CampaignExecutionModel.countDocuments({
    tenantId,
    outcomeReason: { $regex: /GOAL/i }
  });

  // 6. Linked orders and net sales with Single-Attribution Precedence (Spec p.28, test C18)
  const orders = await OrderModel.find({ tenantId }).lean();
  const enrollmentsWithGoals = await CampaignEnrollmentModel.find({
    tenantId,
    goalReachedAt: { $ne: null }
  }).lean();

  const attributedOrderIds = new Set<string>();
  let attributedNetSalesPaise = 0;
  let unassignedNetSalesPaise = 0;
  let unassignedOrdersCount = 0;

  // Single-attribution: match via explicit occasion link or goalOrderRef
  for (const order of orders) {
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') continue;

    const netAmount = order.netPaise;

    // Check if order links to an enrollment
    const matchingEnrollment = enrollmentsWithGoals.find(
      (e) =>
        e.goalOrderRef === order.id ||
        (order.occasionRef && (e.occurrenceId === order.occasionRef || e.sourceRef?.id === order.occasionRef))
    );

    if (matchingEnrollment && !attributedOrderIds.has(order.id)) {
      attributedOrderIds.add(order.id);
      attributedNetSalesPaise += netAmount;
    } else if (!attributedOrderIds.has(order.id)) {
      unassignedOrdersCount++;
      unassignedNetSalesPaise += netAmount;
    }
  }

  // Also include goalNetPaise directly recorded on enrollments if OrderModel was not populated
  for (const enr of enrollmentsWithGoals) {
    if (enr.goalOrderRef && !attributedOrderIds.has(enr.goalOrderRef) && typeof enr.goalNetPaise === 'number') {
      attributedOrderIds.add(enr.goalOrderRef);
      attributedNetSalesPaise += enr.goalNetPaise;
    }
  }

  return {
    tenantId,
    generatedAt: serverNow.toISOString(),
    eligibleCustomers,
    enrollments: {
      total: totalEnr,
      active: activeEnr,
      completed: completedEnr,
      cancelled: cancelledEnr
    },
    executions: {
      scheduled,
      deferred,
      skipped,
      cancelled,
      expired,
      dispatching,
      accepted,
      delivered,
      read,
      unknown
    },
    evidenceCounts: {
      accepted,
      delivered,
      read
    },
    repliesAndHolds: {
      totalHeldEnrollments,
      skippedReplyHoldExecutions
    },
    goalCompletions: {
      totalGoalEnrollments,
      skippedGoalExecutions
    },
    salesAttribution: {
      rule: 'SINGLE_ATTRIBUTION_OCCASION_PRECEDENCE',
      attributedOrdersCount: attributedOrderIds.size,
      attributedNetSalesPaise,
      unassignedOrdersCount,
      unassignedNetSalesPaise
    },
    reasonsSummary
  };
}

/**
 * Per-Customer Timeline (Spec p.28)
 */
export async function getCustomerTimeline(tenantId: string, customerId: string): Promise<CustomerTimelineItem[]> {
  const [enrollments, executions] = await Promise.all([
    CampaignEnrollmentModel.find({ tenantId, customerId }).lean(),
    CampaignExecutionModel.find({ tenantId, customerId }).lean()
  ]);

  const campaigns = await CampaignModel.find({ tenantId }).lean();
  const campaignMap = new Map(campaigns.map((c) => [c.id, c.name]));

  const timeline: CustomerTimelineItem[] = [];

  for (const enr of enrollments) {
    timeline.push({
      id: enr.id,
      type: 'ENROLLMENT',
      campaignId: enr.campaignId,
      campaignName: campaignMap.get(enr.campaignId) || enr.campaignId,
      timestamp: (enr.createdAt || new Date()).toISOString(),
      status: enr.status,
      details: {
        occurrenceId: enr.occurrenceId,
        sourceRef: enr.sourceRef,
        matchExplanation: enr.matchExplanation
      }
    });

    if (enr.replyHoldAt) {
      timeline.push({
        id: `hold_${enr.id}`,
        type: 'REPLY_HOLD',
        campaignId: enr.campaignId,
        campaignName: campaignMap.get(enr.campaignId),
        timestamp: enr.replyHoldAt.toISOString(),
        status: 'HELD_REPLY',
        reason: 'Customer replied to campaign message'
      });
    }

    if (enr.goalReachedAt) {
      timeline.push({
        id: `goal_${enr.id}`,
        type: 'GOAL_REACHED',
        campaignId: enr.campaignId,
        campaignName: campaignMap.get(enr.campaignId),
        timestamp: enr.goalReachedAt.toISOString(),
        status: 'GOAL_COMPLETED',
        details: { goalOrderRef: enr.goalOrderRef, goalNetPaise: enr.goalNetPaise }
      });
    }
  }

  for (const exe of executions) {
    timeline.push({
      id: exe.id,
      type: 'EXECUTION',
      campaignId: exe.campaignId,
      campaignName: campaignMap.get(exe.campaignId),
      stepId: exe.stepId,
      timestamp: (exe.dueAt || exe.createdAt || new Date()).toISOString(),
      status: exe.state,
      reason: exe.outcomeReason,
      details: {
        localDate: exe.localDate,
        localTime: exe.localTime,
        planRevision: exe.planRevision
      }
    });
  }

  // Sort descending by timestamp
  return timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Operational Monitoring & Alerts (Spec p.28, p.34)
 */
export async function getMonitoringAlerts(tenantId: string): Promise<MonitoringAlertsReport> {
  const serverNow = new Date();
  const alerts: Array<{ severity: 'INFO' | 'WARNING' | 'CRITICAL'; code: string; message: string }> = [];

  // 1. Planner lag: check latest calendar checkpoint
  const plannerCheckpoint = await CampaignCheckpointModel.findOne({ tenantId, workerType: 'CALENDAR_PLANNER' });
  let plannerLagMinutes = 0;
  if (plannerCheckpoint) {
    plannerLagMinutes = Math.max(0, Math.floor((serverNow.getTime() - plannerCheckpoint.lastRunAt.getTime()) / 60000));
    if (plannerLagMinutes > 60) {
      alerts.push({
        severity: 'WARNING',
        code: 'PLANNER_LAG',
        message: `Calendar planner lag is ${plannerLagMinutes} minutes (last run at ${plannerCheckpoint.lastRunAt.toISOString()})`
      });
    }
  }

  // 2. Due-step age: oldest execution in SCHEDULED where dueAt < serverNow
  const oldestDue = await CampaignExecutionModel.findOne({
    tenantId,
    state: 'SCHEDULED',
    dueAt: { $lt: serverNow }
  })
    .sort({ dueAt: 1 })
    .lean();

  let dueStepAgeMinutes = 0;
  if (oldestDue && oldestDue.dueAt) {
    dueStepAgeMinutes = Math.max(0, Math.floor((serverNow.getTime() - oldestDue.dueAt.getTime()) / 60000));
    if (dueStepAgeMinutes > 15) {
      alerts.push({
        severity: dueStepAgeMinutes > 120 ? 'CRITICAL' : 'WARNING',
        code: 'DUE_STEP_BACKLOG',
        message: `Overdue step execution detected: age is ${dueStepAgeMinutes} minutes`
      });
    }
  }

  // 3. Event backlog: unprocessed events in inbox
  const eventBacklogCount = await CampaignEventInboxModel.countDocuments({
    tenantId,
    status: 'RECEIVED'
  });
  if (eventBacklogCount > 10) {
    alerts.push({
      severity: 'WARNING',
      code: 'EVENT_BACKLOG',
      message: `Event inbox backlog has ${eventBacklogCount} unprocessed events`
    });
  }

  // 4. Unknown send outcomes: executions in OUTCOME_UNKNOWN
  const unknownOutcomesCount = await CampaignExecutionModel.countDocuments({
    tenantId,
    state: 'OUTCOME_UNKNOWN'
  });
  if (unknownOutcomesCount > 0) {
    alerts.push({
      severity: 'WARNING',
      code: 'UNKNOWN_OUTCOMES',
      message: `${unknownOutcomesCount} message deliveries have ambiguous OUTCOME_UNKNOWN status requiring investigation`
    });
  }

  // 5. Template blocks: executions blocked by missing template or placeholder
  const templateBlocksCount = await CampaignExecutionModel.countDocuments({
    tenantId,
    outcomeReason: { $regex: /TEMPLATE|PLACEHOLDER/i }
  });
  if (templateBlocksCount > 0) {
    alerts.push({
      severity: 'WARNING',
      code: 'TEMPLATE_BLOCKS',
      message: `${templateBlocksCount} steps blocked due to template unavailability or placeholder binding errors`
    });
  }

  // 6. Stalled checkpoints: checkpoints with lastRunAt or updatedAt > 30 mins ago while active
  const thirtyMinsAgo = new Date(serverNow.getTime() - 30 * 60 * 1000);
  const stalledCheckpointsCount = await CampaignCheckpointModel.countDocuments({
    tenantId,
    $or: [{ lastRunAt: { $lt: thirtyMinsAgo } }, { updatedAt: { $lt: thirtyMinsAgo } }]
  });

  const overallStatus = alerts.some((a) => a.severity === 'CRITICAL')
    ? 'CRITICAL'
    : alerts.length > 0
    ? 'DEGRADED'
    : 'HEALTHY';

  return {
    tenantId,
    evaluatedAt: serverNow.toISOString(),
    status: overallStatus,
    alerts,
    metrics: {
      plannerLagMinutes,
      dueStepAgeMinutes,
      eventBacklogCount,
      unknownOutcomesCount,
      templateBlocksCount,
      stalledCheckpointsCount
    }
  };
}
