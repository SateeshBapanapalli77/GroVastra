import { connectDatabase } from '../config/database';
import { CampaignModel } from '../modules/campaigns/models/Campaign.model';
import { CampaignVersionModel } from '../modules/campaigns/models/CampaignVersion.model';
import { CampaignCheckpointModel } from '../modules/campaigns/models/CampaignCheckpoint.model';
import { planAnnualOccasions } from '../modules/campaigns/engine/annualDateStrategy';
import { generateId } from '../shared/utils/id';
import { logger } from '../config/logger';
import { env } from '../config/env';

async function getActivePlannerTenants(): Promise<string[]> {
  const activeCampaignTenants = await CampaignModel.distinct('tenantId', { status: 'ACTIVE' });
  if (activeCampaignTenants.length > 0) {
    return activeCampaignTenants;
  }
  return env.DEFAULT_TENANT_ID ? [env.DEFAULT_TENANT_ID] : [];
}

export async function runPlannerLoop(once: boolean = false): Promise<void> {
  logger.info('Starting Calendar Planner Worker (Multi-Tenant)...');
  await connectDatabase();

  const executePass = async () => {
    try {
      logger.debug('Executing Calendar Planner cycle...');

      const tenants = await getActivePlannerTenants();
      for (const tenantId of tenants) {
        // Find all active campaigns for this tenant
        const activeCampaigns = await CampaignModel.find({
          tenantId,
          status: 'ACTIVE'
        }).lean();

        for (const campaign of activeCampaigns) {
          if (!campaign.activeVersionId) continue;

          const activeVersion = await CampaignVersionModel.findOne({
            id: campaign.activeVersionId,
            tenantId
          }).lean();

          if (activeVersion && activeVersion.trigger?.type === 'ANNUAL_DATE') {
            const result = await planAnnualOccasions(activeVersion as any);
            logger.info(
              {
                tenantId,
                campaignId: campaign.id,
                plannedEnrollments: result.plannedEnrollments,
                plannedExecutions: result.plannedExecutions
              },
              'Planned occurrences for active campaign'
            );
          }
        }

        // Update checkpoint per tenant
        await CampaignCheckpointModel.findOneAndUpdate(
          { tenantId, workerType: 'CALENDAR_PLANNER' },
          {
            id: generateId('chk'),
            tenantId,
            workerType: 'CALENDAR_PLANNER',
            lastRunAt: new Date(),
            completedAt: new Date()
          },
          { upsert: true }
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in Calendar Planner loop cycle');
    }
  };

  await executePass();

  if (!once) {
    // Run every 15 minutes as per Page 17 specification
    const INTERVAL_MS = 15 * 60 * 1000;
    setInterval(executePass, INTERVAL_MS);
  }
}

if (require.main === module) {
  runPlannerLoop().catch((err) => {
    logger.fatal({ err }, 'Fatal crash in planner worker');
    process.exit(1);
  });
}
