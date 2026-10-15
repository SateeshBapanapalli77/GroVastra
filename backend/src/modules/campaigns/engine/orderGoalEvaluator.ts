import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignVersionModel } from '../models/CampaignVersion.model';
import { logger } from '../../../config/logger';

export interface OrderCompletedEventData {
  tenantId: string;
  customerId?: string;
  orderId: string;
  occasionRef?: string;
  netPaise?: number;
}

/**
 * Evaluates an order.completed event and applies goal stop rules strictly per spec p.11, p.16:
 * - Only sets goalReachedAt on enrollments whose occasion matches order's occasionRef or an explicit staff goal.
 * - Respects each step's stopOnGoal: does NOT skip steps that have stopOnGoal=false (e.g. birthday greetings).
 */
export async function evaluateOrderCompletedGoal(params: OrderCompletedEventData): Promise<{ matchedCount: number; updatedEnrollments: string[] }> {
  const { tenantId, customerId, orderId, occasionRef } = params;

  if (!customerId || !occasionRef) {
    logger.info({ orderId, customerId, occasionRef }, 'Order without customer or occasionRef ignored for campaign goal attribution');
    return { matchedCount: 0, updatedEnrollments: [] };
  }

  // 1. Strictly tenant-scoped query for active enrollments matching the occasionRef
  const matchedEnrollments = await CampaignEnrollmentModel.find({
    tenantId,
    customerId,
    status: 'ACTIVE',
    $or: [{ occurrenceId: occasionRef }, { 'sourceRef.id': occasionRef }]
  });

  if (matchedEnrollments.length === 0) {
    logger.info({ orderId, customerId, occasionRef, tenantId }, 'Order completed with occasionRef but no matching active enrollments found');
    return { matchedCount: 0, updatedEnrollments: [] };
  }

  const enrollmentIds = matchedEnrollments.map((e) => e.id);

  // 2. Mark goalReachedAt on matched enrollments
  await CampaignEnrollmentModel.updateMany(
    { tenantId, id: { $in: enrollmentIds } },
    {
      $set: {
        goalReachedAt: new Date(),
        goalOrderRef: orderId
      }
    }
  );

  // 3. For each enrollment, check version steps and ONLY skip executions where stopOnGoal is true
  for (const enrollment of matchedEnrollments) {
    const version = await CampaignVersionModel.findOne({ id: enrollment.campaignVersionId, tenantId });
    if (!version) continue;

    // Steps with stopOnGoal === false MUST NOT be skipped
    const stopOnGoalStepIds = version.steps
      .filter((s) => s.stopOnGoal !== false)
      .map((s) => s.stepId);

    if (stopOnGoalStepIds.length > 0) {
      await CampaignExecutionModel.updateMany(
        {
          tenantId,
          enrollmentId: enrollment.id,
          stepId: { $in: stopOnGoalStepIds },
          state: { $in: ['SCHEDULED', 'DEFERRED'] }
        },
        {
          $set: {
            state: 'SKIPPED',
            outcomeReason: 'SKIPPED_GOAL_REACHED'
          }
        }
      );
    }
  }

  logger.info(
    { tenantId, orderId, customerId, occasionRef, matchedCount: matchedEnrollments.length },
    'Successfully applied occasion order goal completion to enrollments'
  );

  return { matchedCount: matchedEnrollments.length, updatedEnrollments: enrollmentIds };
}
