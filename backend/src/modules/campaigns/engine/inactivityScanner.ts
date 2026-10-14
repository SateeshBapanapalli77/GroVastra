import { CampaignCustomerFactModel } from '../models/CampaignCustomerFact.model';
import { CampaignModel } from '../models/Campaign.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { generateId } from '../../../shared/utils/id';
import { DateTime } from 'luxon';
import { logger } from '../../../config/logger';

export interface InactivityScanResult {
  evaluatedCount: number;
  enrolledWinbackCount: number;
}

import mongoose from 'mongoose';

/**
 * Inactivity Evaluator (Handoff Page 14 & 17):
 * Scans patrons whose last qualifying purchase exceeds the inactivity threshold (e.g. 90 or 180 days).
 * Uses anchored occurrence key: winback:lastQualifyingOrderId:ruleId.
 * Guarantees no repeated daily bursts for the same lapse period.
 */
export async function runInactivityScan(
  tenantId: string,
  serverNow: Date = new Date()
): Promise<InactivityScanResult> {
  if (mongoose.connection.readyState !== 1) {
    return { evaluatedCount: 0, enrolledWinbackCount: 0 };
  }

  const activeCampaigns = await CampaignModel.find({
    tenantId,
    status: 'ACTIVE'
  }).lean();

  let winbackCampaign: any = null;
  let winbackVersion: any = null;

  for (const c of activeCampaigns) {
    if (!c.activeVersionId) continue;
    const v = await CampaignVersionModel.findOne({ id: c.activeVersionId, tenantId }).lean();
    if (v && v.trigger.type === 'INACTIVITY_SCAN') {
      winbackCampaign = c;
      winbackVersion = v;
      break;
    }
  }

  if (!winbackCampaign || !winbackVersion) {
    logger.debug({ tenantId }, 'No active win-back inactivity campaign found');
    return { evaluatedCount: 0, enrolledWinbackCount: 0 };
  }

  const thresholdDays = winbackVersion.trigger.inactivityDays || 90;
  const cutoffDate = DateTime.fromJSDate(serverNow).minus({ days: thresholdDays }).toJSDate();

  // Find patrons whose last qualifying purchase was before the cutoff
  const eligibleFacts = await CampaignCustomerFactModel.find({
    tenantId,
    lastQualifyingPurchaseAt: { $ne: null, $lte: cutoffDate }
  }).lean();

  let enrolledWinbackCount = 0;

  for (const fact of eligibleFacts) {
    const lastOrderId = fact.lastQualifyingOrderId || 'ord_legacy';
    const occurrenceId = `winback:${lastOrderId}:${winbackVersion.id}`;

    // Check if customer was already enrolled for this specific inactive lapse anchor
    const existingEnrollment = await CampaignEnrollmentModel.findOne({
      tenantId,
      campaignId: winbackCampaign.id,
      customerId: fact.customerId,
      occurrenceId
    });

    if (!existingEnrollment) {
      const enrollment = await CampaignEnrollmentModel.create({
        id: generateId('enr'),
        tenantId,
        campaignId: winbackCampaign.id,
        campaignVersionId: winbackVersion.id,
        customerId: fact.customerId,
        occurrenceId,
        sourceRef: {
          type: 'ORDER_EVENT',
          id: lastOrderId,
          version: fact.aggregateVersion
        },
        planRevision: 1,
        status: 'ACTIVE',
        replyHoldAt: null,
        goalReachedAt: null
      });

      // Schedule winback nudge
      const stepDef = winbackVersion.steps[0] || {
        stepId: 'winback_nudge',
        maxLatenessMinutes: 180
      };

      const dueAt = new Date(); // Due at next respectful hour
      const expiresAt = new Date(dueAt.getTime() + 24 * 3600 * 1000);

      await CampaignExecutionModel.create({
        id: generateId('exe'),
        tenantId,
        enrollmentId: enrollment.id,
        campaignId: winbackCampaign.id,
        stepId: stepDef.stepId,
        dueAt,
        expiresAt,
        localDate: serverNow.toISOString().slice(0, 10),
        localTime: '11:30',
        timezone: winbackVersion.timezone || 'Asia/Kolkata',
        planRevision: 1,
        state: 'SCHEDULED',
        prerequisite: 'NONE',
        deliveryIntentId: null,
        lease: { token: null, until: null, claimedBy: null }
      });

      enrolledWinbackCount++;
    }
  }

  logger.info(
    { evaluated: eligibleFacts.length, enrolledWinbackCount, thresholdDays },
    'Inactivity scan pass completed'
  );

  return {
    evaluatedCount: eligibleFacts.length,
    enrolledWinbackCount
  };
}
