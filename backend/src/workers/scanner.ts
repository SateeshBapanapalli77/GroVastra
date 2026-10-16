import { connectDatabase } from '../config/database';
import { CampaignModel } from '../modules/campaigns/models/Campaign.model';
import { CampaignCustomerFactModel } from '../modules/campaigns/models/CampaignCustomerFact.model';
import { CampaignCheckpointModel, ICampaignCheckpoint } from '../modules/campaigns/models/CampaignCheckpoint.model';
import { runIndexedInactivityScan } from '../modules/campaigns/engine/lifecycleStrategy';
import { generateId } from '../shared/utils/id';
import { ulid } from 'ulid';
import { logger } from '../config/logger';
import { env } from '../config/env';

export interface ScannerOptions {
  workerId?: string;
  intervalMs?: number; // Configurable scan interval (default daily = 24h)
  leaseDurationMs?: number; // Lock duration to protect concurrent execution
  stalledThresholdMs?: number; // Threshold beyond which incomplete lease is flagged stalled
  serverNow?: Date;
  forceDue?: boolean; // Bypass interval check (e.g. for testing)
}

export interface ScannerTenantResult {
  tenantId: string;
  claimed: boolean;
  checkpointStatus: 'LEASED_AND_PROCESSED' | 'SKIPPED_NOT_DUE' | 'SKIPPED_ALREADY_LEASED' | 'STALLED_RECOVERED';
  evaluatedCount: number;
  enrolledCount: number;
  checkpointId?: string;
  isStalled?: boolean;
  error?: string;
}

export interface ScannerPassResult {
  tenantsEvaluated: number;
  totalEnrolledCount: number;
  stalledCheckpointsCount: number;
  results: ScannerTenantResult[];
}

/**
 * Default interval: Daily (24 hours) as per Spec Page 14 & 17
 */
export const DEFAULT_SCANNER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SCANNER_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_STALLED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Discovers distinct tenants with active campaigns or customer purchase facts
 */
export async function getActiveScannerTenants(): Promise<string[]> {
  const campaignTenants = await CampaignModel.distinct('tenantId', { status: 'ACTIVE' });
  const factTenants = await CampaignCustomerFactModel.distinct('tenantId');
  const set = new Set<string>([...campaignTenants, ...factTenants]);

  if (set.size > 0) {
    return Array.from(set);
  }
  return env.DEFAULT_TENANT_ID ? [env.DEFAULT_TENANT_ID] : [];
}

/**
 * Detects stalled checkpoints where a worker lease expired mid-run or failed to complete
 */
export async function detectStalledCheckpoints(
  tenantId?: string,
  stalledThresholdMs: number = DEFAULT_STALLED_THRESHOLD_MS,
  serverNow: Date = new Date()
): Promise<{ count: number; stalledTenantIds: string[] }> {
  const cutoff = new Date(serverNow.getTime() - stalledThresholdMs);
  const filter: any = {
    workerType: 'INACTIVITY_EVALUATOR',
    $or: [
      { 'lease.token': { $ne: null }, 'lease.until': { $lt: serverNow } },
      { lastRunAt: { $lt: cutoff }, completedAt: null }
    ]
  };

  if (tenantId) {
    filter.tenantId = tenantId;
  }

  const stalled = await CampaignCheckpointModel.find(filter).lean();
  return {
    count: stalled.length,
    stalledTenantIds: stalled.map((c) => c.tenantId)
  };
}

/**
 * Runs a single tenant's win-back inactivity scan guarded by a leased checkpoint
 * so that two running worker instances never run the same scan twice.
 */
export async function runScannerCycleForTenant(
  tenantId: string,
  options?: ScannerOptions
): Promise<ScannerTenantResult> {
  const serverNow = options?.serverNow || new Date();
  const intervalMs = options?.intervalMs ?? DEFAULT_SCANNER_INTERVAL_MS;
  const leaseDurationMs = options?.leaseDurationMs ?? DEFAULT_SCANNER_LEASE_DURATION_MS;
  const stalledThresholdMs = options?.stalledThresholdMs ?? DEFAULT_STALLED_THRESHOLD_MS;
  const workerId = options?.workerId || `scanner_${ulid().toLowerCase()}`;
  const leaseToken = `lease_${ulid().toLowerCase()}`;
  const leaseUntil = new Date(serverNow.getTime() + leaseDurationMs);

  // 1. Ensure checkpoint document exists with unique index { tenantId, workerType }
  await CampaignCheckpointModel.updateOne(
    { tenantId, workerType: 'INACTIVITY_EVALUATOR' },
    {
      $setOnInsert: {
        id: generateId('chk'),
        tenantId,
        workerType: 'INACTIVITY_EVALUATOR',
        cursor: {},
        lastRunAt: new Date(0),
        completedAt: null,
        lease: { token: null, until: null, claimedBy: null }
      }
    },
    { upsert: true }
  );

  // 2. Check for stalled checkpoint alert state
  const existingCheckpoint = await CampaignCheckpointModel.findOne({
    tenantId,
    workerType: 'INACTIVITY_EVALUATOR'
  }).lean();

  let isStalled = false;
  if (existingCheckpoint) {
    const leaseExpired = Boolean(
      existingCheckpoint.lease?.token &&
      existingCheckpoint.lease?.until &&
      existingCheckpoint.lease.until < serverNow
    );
    const runStalled = Boolean(
      existingCheckpoint.lastRunAt &&
      existingCheckpoint.lastRunAt.getTime() > 0 &&
      existingCheckpoint.lease?.claimedBy &&
      !existingCheckpoint.completedAt &&
      (serverNow.getTime() - existingCheckpoint.lastRunAt.getTime() > stalledThresholdMs)
    );
    if (leaseExpired || runStalled) {
      isStalled = true;
      logger.warn(
        {
          tenantId,
          checkpointId: existingCheckpoint.id,
          workerType: existingCheckpoint.workerType,
          lastRunAt: existingCheckpoint.lastRunAt,
          leaseUntil: existingCheckpoint.lease?.until
        },
        'Stalled checkpoint detected in inactivity scanner: lease expired or run incomplete'
      );
    }
  }

  // 3. Atomically acquire lease only if:
  //    (a) lease is not currently held by another live worker instance (lease.until is null or past)
  //    (b) scheduled scan is due (completedAt <= serverNow - intervalMs, or null, or recovering from stalled lease)
  const dueCondition: any = options?.forceDue
    ? {}
    : {
        $or: [
          { completedAt: null },
          { completedAt: { $lte: new Date(serverNow.getTime() - intervalMs) } },
          { 'lease.until': { $lt: serverNow } }
        ]
      };

  const claimedCheckpoint = await CampaignCheckpointModel.findOneAndUpdate(
    {
      tenantId,
      workerType: 'INACTIVITY_EVALUATOR',
      $and: [
        {
          $or: [
            { 'lease.until': null },
            { 'lease.until': { $lt: serverNow } }
          ]
        },
        dueCondition
      ]
    },
    {
      $set: {
        lastRunAt: serverNow,
        'lease.token': leaseToken,
        'lease.until': leaseUntil,
        'lease.claimedBy': workerId
      }
    },
    { new: true }
  );

  if (!claimedCheckpoint) {
    // Checkpoint was not acquired: inspect whether currently locked by peer or not yet due
    const current = await CampaignCheckpointModel.findOne({
      tenantId,
      workerType: 'INACTIVITY_EVALUATOR'
    }).lean();

    const isLeasedByOther = current?.lease?.until && current.lease.until >= serverNow;
    const status = isLeasedByOther ? 'SKIPPED_ALREADY_LEASED' : 'SKIPPED_NOT_DUE';

    return {
      tenantId,
      claimed: false,
      checkpointStatus: status,
      evaluatedCount: 0,
      enrolledCount: 0,
      checkpointId: current?.id,
      isStalled
    };
  }

  // 4. Execute inactivity scan for this tenant
  try {
    const scanResult = await runIndexedInactivityScan(tenantId, serverNow);

    // 5. Complete scan and release lease inside checkpoint
    await CampaignCheckpointModel.updateOne(
      {
        tenantId,
        workerType: 'INACTIVITY_EVALUATOR',
        'lease.token': leaseToken
      },
      {
        $set: {
          completedAt: new Date(),
          cursor: {
            evaluatedCount: scanResult.evaluatedCount,
            enrolledCount: scanResult.enrolledCount,
            lastScanAt: serverNow
          },
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        }
      }
    );

    return {
      tenantId,
      claimed: true,
      checkpointStatus: isStalled ? 'STALLED_RECOVERED' : 'LEASED_AND_PROCESSED',
      evaluatedCount: scanResult.evaluatedCount,
      enrolledCount: scanResult.enrolledCount,
      checkpointId: claimedCheckpoint.id,
      isStalled
    };
  } catch (err: any) {
    logger.error({ tenantId, err }, 'Inactivity scanner execution failed for tenant');

    // Release lease on unexpected failure so other instances can recover
    await CampaignCheckpointModel.updateOne(
      { tenantId, workerType: 'INACTIVITY_EVALUATOR', 'lease.token': leaseToken },
      {
        $set: {
          'lease.token': null,
          'lease.until': null,
          'lease.claimedBy': null
        }
      }
    );

    return {
      tenantId,
      claimed: true,
      checkpointStatus: 'LEASED_AND_PROCESSED',
      evaluatedCount: 0,
      enrolledCount: 0,
      checkpointId: claimedCheckpoint.id,
      isStalled,
      error: err.message
    };
  }
}

/**
 * Runs a complete scanner pass across all active tenants
 */
export async function runScannerPass(options?: ScannerOptions): Promise<ScannerPassResult> {
  const tenants = await getActiveScannerTenants();
  const results: ScannerTenantResult[] = [];
  let totalEnrolledCount = 0;

  for (const tenantId of tenants) {
    const res = await runScannerCycleForTenant(tenantId, options);
    results.push(res);
    totalEnrolledCount += res.enrolledCount;
  }

  const stalledReport = await detectStalledCheckpoints(undefined, options?.stalledThresholdMs, options?.serverNow);

  return {
    tenantsEvaluated: tenants.length,
    totalEnrolledCount,
    stalledCheckpointsCount: stalledReport.count,
    results
  };
}

/**
 * Continuous loop for the inactivity scan worker
 */
export async function startScannerLoop(options?: {
  once?: boolean;
  intervalMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  logger.info('Starting Inactivity Scanner Worker (Multi-Tenant Leased Checkpoint)...');
  await connectDatabase();

  const pollIntervalMs = options?.pollIntervalMs || 60 * 1000; // Check every 60s for due tenant scans

  const pass = async () => {
    try {
      const summary = await runScannerPass({ intervalMs: options?.intervalMs });
      if (summary.totalEnrolledCount > 0 || summary.stalledCheckpointsCount > 0) {
        logger.info(
          {
            tenants: summary.tenantsEvaluated,
            totalEnrolled: summary.totalEnrolledCount,
            stalledCheckpoints: summary.stalledCheckpointsCount
          },
          'Inactivity scanner pass completed'
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in inactivity scanner loop cycle');
    }
  };

  await pass();

  if (!options?.once) {
    setInterval(pass, pollIntervalMs);
  }
}

if (require.main === module) {
  startScannerLoop().catch((err) => {
    logger.fatal({ err }, 'Fatal crash in scanner worker');
    process.exit(1);
  });
}
