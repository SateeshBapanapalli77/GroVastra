import { connectDatabase } from '../config/database';
import { runDispatchCycle } from '../modules/campaigns/engine/dispatchExecutor';
import { env } from '../config/env';
import { logger } from '../config/logger';

export async function startExecutorLoop(once: boolean = false): Promise<void> {
  logger.info('Starting GroVastra Execution Worker...');
  await connectDatabase();

  const tenantId = env.DEFAULT_TENANT_ID;

  const cycle = async () => {
    try {
      const stats = await runDispatchCycle(tenantId, 10);
      if (stats.claimedCount > 0) {
        logger.info(stats, 'Execution worker cycle finished with dispatches');
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
