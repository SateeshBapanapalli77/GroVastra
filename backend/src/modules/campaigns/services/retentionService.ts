import mongoose from 'mongoose';
import { CampaignEnrollmentModel } from '../models/CampaignEnrollment.model';
import { CampaignExecutionModel } from '../models/CampaignExecution.model';
import { CampaignTombstoneModel } from '../models/CampaignTombstone.model';
import { generateId } from '../../../shared/utils/id';
import { logger } from '../../../config/logger';

export interface RetentionPruneResult {
  tombstonesCreated: number;
  enrollmentsPruned: number;
  executionsPruned: number;
}

/**
 * Atomically prunes terminal campaign enrollments and executions into tombstones (Spec p.25, test B18).
 * Tombstone creation and detail removal are executed in ONE transaction.
 */
export async function pruneTerminalEnrollments(
  tenantId: string,
  cutoffDate: Date
): Promise<RetentionPruneResult> {
  const result: RetentionPruneResult = {
    tombstonesCreated: 0,
    enrollmentsPruned: 0,
    executionsPruned: 0
  };

  const terminalEnrollments = await CampaignEnrollmentModel.find({
    tenantId,
    status: { $in: ['COMPLETED', 'CANCELLED'] },
    updatedAt: { $lte: cutoffDate }
  }).exec();

  if (terminalEnrollments.length === 0) {
    return result;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const enrollment of terminalEnrollments) {
        const executions = await CampaignExecutionModel.find({
          tenantId,
          enrollmentId: enrollment.id
        }).session(session);

        const executionKeys = executions.map(
          (e) => `${tenantId}:${enrollment.id}:${e.stepId}`
        );

        const enrollmentKey = `${enrollment.tenantId}:${enrollment.campaignId}:${enrollment.customerId}:${enrollment.occurrenceId}`;

        // 1. Create durable tombstone with canonical enrollmentKey
        await CampaignTombstoneModel.create(
          [
            {
              id: generateId('tomb'),
              tenantId,
              enrollmentKey,
              campaignId: enrollment.campaignId,
              customerId: enrollment.customerId,
              occurrenceId: enrollment.occurrenceId,
              executionKeys,
              prunedAt: new Date(),
              reason: 'TERMINAL_RETENTION_CLEANUP'
            }
          ],
          { session }
        );

        // 2. Delete detailed executions
        const execDelete = await CampaignExecutionModel.deleteMany(
          { tenantId, enrollmentId: enrollment.id },
          { session }
        );

        // 3. Delete detailed enrollment
        await CampaignEnrollmentModel.deleteOne(
          { id: enrollment.id, tenantId },
          { session }
        );

        result.tombstonesCreated++;
        result.enrollmentsPruned++;
        result.executionsPruned += execDelete.deletedCount || 0;
      }
    });
  } finally {
    await session.endSession();
  }

  logger.info({ tenantId, ...result }, 'Pruned completed campaign records to tombstones');
  return result;
}

/**
 * Checks whether an enrollment key is already present in either live records OR retained tombstones (B18)
 */
export async function isEnrollmentReplayBlocked(
  tenantId: string,
  enrollmentKey: string
): Promise<boolean> {
  // Check live records
  const live = await CampaignEnrollmentModel.findOne({ tenantId, enrollmentKey });
  if (live) return true;

  // Check retained tombstones
  const tombstone = await CampaignTombstoneModel.findOne({ tenantId, enrollmentKey });
  return Boolean(tombstone);
}
