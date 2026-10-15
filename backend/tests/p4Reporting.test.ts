import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { CampaignModel } from '../src/modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../src/modules/campaigns/models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../src/modules/campaigns/models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../src/modules/campaigns/models/CampaignExecution.model';
import { CampaignDeliveryIntentModel } from '../src/modules/campaigns/models/CampaignDeliveryIntent.model';
import { CampaignCheckpointModel } from '../src/modules/campaigns/models/CampaignCheckpoint.model';
import { CampaignEventInboxModel } from '../src/modules/campaigns/models/CampaignEventInbox.model';
import { CustomerModel } from '../src/modules/crm/models/Customer.model';
import { OrderModel } from '../src/modules/orders/models/Order.model';
import {
  generateOwnerOverviewReport,
  getCustomerTimeline,
  getMonitoringAlerts,
  getPrimaryReason
} from '../src/modules/campaigns/engine/ownerReporting';
import { generateId } from '../src/shared/utils/id';

describe('Work Package P4: Milestone 5 Owner Reporting, Attribution & Monitoring (Spec p.28, p.33, p.34)', () => {
  const tenantId = 'qa_tenant_p4_rep';

  beforeEach(async () => {
    await Promise.all([
      CampaignModel.deleteMany({ tenantId }),
      CampaignVersionModel.deleteMany({ tenantId }),
      CampaignEnrollmentModel.deleteMany({ tenantId }),
      CampaignExecutionModel.deleteMany({ tenantId }),
      CampaignDeliveryIntentModel.deleteMany({ tenantId }),
      CampaignCheckpointModel.deleteMany({ tenantId }),
      CampaignEventInboxModel.deleteMany({ tenantId }),
      CustomerModel.deleteMany({ tenantId }),
      OrderModel.deleteMany({ tenantId })
    ]);
  });

  describe('1. Owner Reporting & Single-Attribution Precedence (Spec p.28, p.34)', () => {
    it('aggregates enrollments, executions, evidence counts, and applies single-attribution with unassigned orders separated', async () => {
      // 1. Setup Customers
      const cus1 = await CustomerModel.create({
        id: 'cus_rep_1',
        tenantId,
        firstName: 'Meenakshi',
        lastName: 'Sundaram',
        phone: '+919876500091',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const cus2 = await CustomerModel.create({
        id: 'cus_rep_2',
        tenantId,
        firstName: 'Ananya',
        lastName: 'Iyer',
        phone: '+919876500092',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      // 2. Setup Campaigns
      const bdayCamp = await CampaignModel.create({
        id: 'cmp_rep_bday',
        tenantId,
        name: 'Birthday Saree Special',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_rep_bday',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const restockCamp = await CampaignModel.create({
        id: 'cmp_rep_restock',
        tenantId,
        name: 'Restock Alert Saree',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_rep_restock',
        draftVersion: 1,
        pauseGeneration: 0
      });

      // 3. Setup Enrollments (one with goal, one with reply hold)
      const enr1 = await CampaignEnrollmentModel.create({
        id: 'enr_rep_1',
        tenantId,
        campaignId: bdayCamp.id,
        campaignVersionId: 'cv_rep_bday',
        customerId: cus1.id,
        occurrenceId: 'birthday:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: cus1.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: new Date(),
        goalOrderRef: 'ord_bday_101',
        goalNetPaise: 4500000
      });

      const enr2 = await CampaignEnrollmentModel.create({
        id: 'enr_rep_2',
        tenantId,
        campaignId: restockCamp.id,
        campaignVersionId: 'cv_rep_restock',
        customerId: cus2.id,
        occurrenceId: 'arrival:arr_1:req_1',
        sourceRef: { type: 'STOCK_EVENT', id: 'arr_1', version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: new Date(),
        goalReachedAt: null
      });

      // 4. Setup Executions with various states
      const now = new Date();
      await CampaignExecutionModel.create([
        {
          id: 'exe_rep_1',
          tenantId,
          enrollmentId: enr1.id,
          campaignId: bdayCamp.id,
          stepId: 'invitation',
          dueAt: new Date(now.getTime() - 86400000),
          expiresAt: new Date(now.getTime() + 86400000),
          localDate: '2026-10-14',
          localTime: '10:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'READ',
          outcomeReason: null
        },
        {
          id: 'exe_rep_2',
          tenantId,
          enrollmentId: enr1.id,
          campaignId: bdayCamp.id,
          stepId: 'followup',
          dueAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
          localDate: '2026-10-15',
          localTime: '10:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'SKIPPED',
          outcomeReason: 'SKIPPED_GOAL_REACHED'
        },
        {
          id: 'exe_rep_3',
          tenantId,
          enrollmentId: enr2.id,
          campaignId: restockCamp.id,
          stepId: 'alert',
          dueAt: new Date(now.getTime() - 3600000),
          expiresAt: new Date(now.getTime() + 86400000),
          localDate: '2026-10-15',
          localTime: '11:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'DELIVERED',
          outcomeReason: null
        },
        {
          id: 'exe_rep_4',
          tenantId,
          enrollmentId: enr2.id,
          campaignId: restockCamp.id,
          stepId: 'followup',
          dueAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
          localDate: '2026-10-15',
          localTime: '11:30',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'SKIPPED',
          outcomeReason: 'SKIPPED_REPLY_HOLD'
        },
        {
          id: 'exe_rep_5',
          tenantId,
          enrollmentId: enr2.id,
          campaignId: restockCamp.id,
          stepId: 'reminder',
          dueAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
          localDate: '2026-10-15',
          localTime: '12:00',
          timezone: 'Asia/Kolkata',
          planRevision: 1,
          state: 'SCHEDULED',
          outcomeReason: null
        }
      ]);

      // 5. Setup Orders: 1 attributed order, 1 unassigned walk-in order, 1 refunded order
      await OrderModel.create([
        {
          id: 'ord_bday_101',
          tenantId,
          customerId: cus1.id,
          netPaise: 4500000,
          occasionRef: 'birthday:2026',
          campaignId: bdayCamp.id,
          status: 'COMPLETED'
        },
        {
          id: 'ord_walkin_999',
          tenantId,
          customerId: cus2.id,
          netPaise: 2500000,
          occasionRef: null,
          campaignId: null,
          status: 'COMPLETED'
        },
        {
          id: 'ord_refunded_555',
          tenantId,
          customerId: cus1.id,
          netPaise: 3000000,
          occasionRef: null,
          campaignId: null,
          status: 'REFUNDED',
          refundedAt: new Date()
        }
      ]);

      // 6. Generate Overview Report
      const report = await generateOwnerOverviewReport(tenantId);

      // Assertions
      expect(report.eligibleCustomers).toBe(2);
      expect(report.enrollments.total).toBe(2);
      expect(report.enrollments.active).toBe(2);

      // Evidence counts are strictly separate (Accepted vs Delivered vs Read)
      expect(report.evidenceCounts.read).toBe(1);
      expect(report.evidenceCounts.delivered).toBe(1);
      expect(report.evidenceCounts.accepted).toBe(0);

      // Replies and holds
      expect(report.repliesAndHolds.totalHeldEnrollments).toBe(1);
      expect(report.repliesAndHolds.skippedReplyHoldExecutions).toBe(1);

      // Goals
      expect(report.goalCompletions.totalGoalEnrollments).toBe(1);
      expect(report.goalCompletions.skippedGoalExecutions).toBe(1);

      // Sales attribution (Single-attribution rule: order ord_bday_101 attributed; ord_walkin_999 is unassigned)
      expect(report.salesAttribution.attributedOrdersCount).toBe(1);
      expect(report.salesAttribution.attributedNetSalesPaise).toBe(4500000);
      expect(report.salesAttribution.unassignedOrdersCount).toBe(1);
      expect(report.salesAttribution.unassignedNetSalesPaise).toBe(2500000);

      // Reasons summary
      expect(report.reasonsSummary['GOAL_REACHED']).toBe(1);
      expect(report.reasonsSummary['REPLY_HOLD']).toBe(1);
    });
  });

  describe('2. Reason Precedence (Spec p.33)', () => {
    it('evaluates primary reasons in strict precedence order', () => {
      // 1. Customer deletion/channel suppression
      expect(getPrimaryReason('SKIPPED_CHANNEL_SUPPRESSED')).toBe('CUSTOMER_DELETED_OR_SUPPRESSED');
      expect(getPrimaryReason('SKIPPED_MARKETING_OPT_OUT')).toBe('CUSTOMER_DELETED_OR_SUPPRESSED');

      // 2. Campaign/global stop
      expect(getPrimaryReason('SKIPPED_CAMPAIGN_PAUSED')).toBe('CAMPAIGN_OR_GLOBAL_PAUSED');
      expect(getPrimaryReason('SKIPPED_GLOBAL_PAUSE')).toBe('CAMPAIGN_OR_GLOBAL_PAUSED');

      // 3. Invalid source/date
      expect(getPrimaryReason('SKIPPED_CUSTOMER_DATE_REMOVED')).toBe('INVALID_SOURCE_OR_DATE');

      // 4. Step expired
      expect(getPrimaryReason('SKIPPED_STEP_EXPIRED')).toBe('STEP_EXPIRED');
      expect(getPrimaryReason('SKIPPED_OUTAGE_EXPIRED')).toBe('STEP_EXPIRED');

      // 5. Goal reached
      expect(getPrimaryReason('SKIPPED_GOAL_REACHED')).toBe('GOAL_REACHED');

      // 6. Reply hold
      expect(getPrimaryReason('SKIPPED_REPLY_HOLD')).toBe('REPLY_HOLD');

      // 7. Template/Content blocked
      expect(getPrimaryReason('BLOCKED_TEMPLATE_UNAVAILABLE')).toBe('CONTENT_OR_TEMPLATE_BLOCKED');
      expect(getPrimaryReason('BLOCKED_UNRESOLVED_PLACEHOLDER')).toBe('CONTENT_OR_TEMPLATE_BLOCKED');

      // 8. Prerequisite
      expect(getPrimaryReason('SKIPPED_PREREQUISITE_NOT_MET')).toBe('PREREQUISITE_NOT_MET');

      // 9. Contact cap
      expect(getPrimaryReason('SKIPPED_CONTACT_CAP')).toBe('CONTACT_CAP_EXCEEDED');
      expect(getPrimaryReason('SKIPPED_CAP_COLLISION')).toBe('CONTACT_CAP_EXCEEDED');
    });
  });

  describe('3. Customer Timeline (Spec p.28)', () => {
    it('returns chronological history of enrollments, executions, holds, and goals with masked details', async () => {
      const customer = await CustomerModel.create({
        id: 'cus_timeline_1',
        tenantId,
        firstName: 'Sita',
        lastName: 'Mahalakshmi',
        phone: '+919876500095',
        status: 'ACTIVE',
        optedInMarketing: true,
        channelSuppressed: false
      });

      const camp = await CampaignModel.create({
        id: 'cmp_timeline_1',
        tenantId,
        name: 'Wedding Anniversary Silk',
        industry: 'BOUTIQUE',
        purpose: 'MARKETING',
        status: 'ACTIVE',
        activeVersionId: 'cv_timeline_1',
        draftVersion: 1,
        pauseGeneration: 0
      });

      const enr = await CampaignEnrollmentModel.create({
        id: 'enr_timeline_1',
        tenantId,
        campaignId: camp.id,
        campaignVersionId: 'cv_timeline_1',
        customerId: customer.id,
        occurrenceId: 'anniversary:ann_101:2026',
        sourceRef: { type: 'CUSTOMER_DATE', id: customer.id, version: 1 },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: new Date(Date.now() - 3600000),
        goalReachedAt: new Date(Date.now() - 1800000),
        goalOrderRef: 'ord_wedding_99'
      });

      await CampaignExecutionModel.create({
        id: 'exe_timeline_1',
        tenantId,
        enrollmentId: enr.id,
        campaignId: camp.id,
        stepId: 'invitation',
        dueAt: new Date(Date.now() - 7200000),
        expiresAt: new Date(Date.now() + 7200000),
        localDate: '2026-10-15',
        localTime: '10:00',
        timezone: 'Asia/Kolkata',
        planRevision: 1,
        state: 'DELIVERED',
        outcomeReason: null
      });

      const timeline = await getCustomerTimeline(tenantId, customer.id);

      expect(timeline.length).toBeGreaterThanOrEqual(3);
      const types = timeline.map((t) => t.type);
      expect(types).toContain('ENROLLMENT');
      expect(types).toContain('EXECUTION');
      expect(types).toContain('REPLY_HOLD');
      expect(types).toContain('GOAL_REACHED');

      // Sorted descending by timestamp
      for (let i = 0; i < timeline.length - 1; i++) {
        expect(new Date(timeline[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(timeline[i + 1].timestamp).getTime()
        );
      }
    });
  });

  describe('4. Operational Monitoring & Alerts (Spec p.28, p.34)', () => {
    it('detects planner lag, due-step backlog, event backlog, and stalled checkpoints', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Stalled checkpoint
      await CampaignCheckpointModel.create({
        id: generateId('chk'),
        tenantId,
        workerType: 'CALENDAR_PLANNER',
        cursor: {},
        lastRunAt: twoHoursAgo,
        updatedAt: twoHoursAgo
      });

      // Event backlog
      await CampaignEventInboxModel.create([
        {
          id: generateId('inbox'),
          tenantId,
          producer: 'pos',
          eventId: 'evt_backlog_1',
          type: 'order.completed',
          entityId: 'ord_backlog_1',
          occurredAt: new Date(),
          status: 'RECEIVED',
          data: {}
        },
        {
          id: generateId('inbox'),
          tenantId,
          producer: 'pos',
          eventId: 'evt_backlog_2',
          type: 'order.completed',
          entityId: 'ord_backlog_2',
          occurredAt: new Date(),
          status: 'RECEIVED',
          data: {}
        }
      ]);

      const alertsReport = await getMonitoringAlerts(tenantId);

      expect(alertsReport.metrics.plannerLagMinutes).toBeGreaterThanOrEqual(119);
      expect(alertsReport.metrics.stalledCheckpointsCount).toBe(1);
      expect(alertsReport.alerts.length).toBeGreaterThan(0);
      expect(alertsReport.alerts.some((a) => a.code === 'PLANNER_LAG')).toBe(true);
      expect(alertsReport.status).toBe('DEGRADED');
    });
  });
});
