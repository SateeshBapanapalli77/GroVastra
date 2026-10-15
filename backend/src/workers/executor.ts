import { connectDatabase } from '../config/database';
import {
  runDispatchCycle,
  sweepStaleDispatching,
  sweepOutcomeUnknownExecutions,
  sweepExpiredPreSubmissionLeases
} from '../modules/campaigns/engine/dispatchExecutor';
import { CampaignExecutionModel } from '../modules/campaigns/models/CampaignExecution.model';
import { CampaignModel } from '../modules/campaigns/models/Campaign.model';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Discovers distinct tenants with pending work or active campaigns
 * to guarantee fair-share worker scheduling across multiple tenants (Handoff p.28, P1.h)
 */
async function getActiveTenants(): Promise<string[]> {
  const pendingTenants = await CampaignExecutionModel.distinct('tenantId', {
    state: { $in: ['SCHEDULED', 'DEFERRED', 'RETRY_WAIT', 'DISPATCHING', 'OUTCOME_UNKNOWN', 'EVALUATING'] }
  });

  if (pendingTenants.length > 0) {
    return pendingTenants;
  }

  const activeCampaignTenants = await CampaignModel.distinct('tenantId', { status: 'ACTIVE' });
  if (activeCampaignTenants.length > 0) {
    return activeCampaignTenants;
  }

  return env.DEFAULT_TENANT_ID ? [env.DEFAULT_TENANT_ID] : [];
}

export async function startExecutorLoop(once: boolean = false): Promise<void> {
  logger.info('Starting GroVastra Execution Worker (Tenant-Fair Scheduler)...');
  await connectDatabase();

  const cycle = async () => {
    try {
      const tenants = await getActiveTenants();
      for (const tenantId of tenants) {
        // Order matters:
        // 1. Recover expired pre-submission evaluating leases (Finding 1)
        // 2. Crash-stuck dispatches become UNKNOWN
        // 3. Reconcile from evidence
        // 4. Claim new work in priority order
        const preRecovered = await sweepExpiredPreSubmissionLeases(tenantId);
        const stale = await sweepStaleDispatching(tenantId);
        const recon = await sweepOutcomeUnknownExecutions(tenantId);
        if (preRecovered.recoveredCount || stale.movedToUnknown || recon.reconciledAccepted || recon.reconciledDelivered) {
          logger.warn({ tenantId, ...preRecovered, ...stale, ...recon }, 'Sweeper changed execution states');
        }

        // Fair-share batch of up to 10 per tenant per cycle
        const stats = await runDispatchCycle(tenantId, 10);
        if (stats.claimedCount > 0) {
          logger.info({ tenantId, ...stats }, 'Execution worker cycle finished with dispatches');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in execution worker cycle');
    }
  };

  await cycle();

  if (!once) {
    // Poll every 5 seconds for due work
    const INTERVAL_MS = 5000;
    setInterval(cycle, INTERVAL_MS);
  }
}

if (require.main === module) {
  startExecutorLoop().catch((err) => {
    logger.fatal({ err }, 'Fatal crash in execution worker');
    process.exit(1);
  });
}
