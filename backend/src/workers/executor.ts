import { connectDatabase } from '../config/database';
import {
  runDispatchCycle,
  sweepStaleDispatching,
  sweepOutcomeUnknownExecutions
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
    state: { $in: ['SCHEDULED', 'DEFERRED', 'RETRY_WAIT', 'DISPATCHING', 'OUTCOME_UNKNOWN'] }
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
        // Order matters: crash-stuck dispatches become UNKNOWN, then reconcile from evidence, then claim new work.
        const stale = await sweepStaleDispatching(tenantId);
        const recon = await sweepOutcomeUnknownExecutions(tenantId);
        if (stale.movedToUnknown || recon.reconciledAccepted || recon.reconciledDelivered) {
          logger.warn({ tenantId, ...stale, ...recon }, 'Sweeper changed execution states');
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
