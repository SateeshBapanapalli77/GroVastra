import mongoose, { ClientSession } from 'mongoose';
import { CampaignContactGateModel, IContactReservation, ICampaignContactGate } from '../../models/CampaignContactGate.model';
import { CampaignExecutionModel } from '../../models/CampaignExecution.model';
import { sha256 } from '../../../../shared/utils/crypto';
import { generateId } from '../../../../shared/utils/id';
import { normalizeE164 } from '../../../../shared/utils/phone';
import { DateTime } from 'luxon';
import { logger } from '../../../../config/logger';

export interface CapCheckResult {
  allowed: boolean;
  reason?: 'SKIPPED_CONTACT_CAP' | 'DEFERRED_CONTACT_CAP';
  nextAvailableAt?: Date;
  gateId?: string;
}

/**
 * Enforces destination-level rolling contact caps (1 per 24h, 3 per 7d)
 * and arbitrates priority across competing campaigns (Handoff p.18, tests B09, B10).
 * Destination cap is enforced across duplicate CRM records sharing a phone number.
 */
export async function checkAndReserveContactCapacity(
  tenantId: string,
  destinationPhone: string,
  campaignId: string,
  executionId: string,
  expiresAt: Date,
  priority: number = 80,
  serverNow: Date = new Date(),
  session?: ClientSession
): Promise<CapCheckResult> {
  const canonicalPhone = normalizeE164(destinationPhone);
  const destinationHash = sha256(canonicalPhone);

  let gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash }).session(session || null);
  if (!gate) {
    try {
      const created = await CampaignContactGateModel.create(
        [
          {
            id: generateId('cg'),
            tenantId,
            destinationHash,
            version: 1,
            history: []
          }
        ],
        session ? { session } : {}
      );
      gate = created[0];
    } catch (err: any) {
      if (err.code === 11000) {
        gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash }).session(session || null);
      } else {
        throw err;
      }
    }
  }

  if (!gate) {
    throw new Error('Failed to acquire or initialize contact gate');
  }

  const nowDt = DateTime.fromJSDate(serverNow);
  const cutoff24h = nowDt.minus({ hours: 24 }).toJSDate();
  const cutoff7d = nowDt.minus({ days: 7 }).toJSDate();

  // Active entries in rolling windows (counting RESERVED, ACCEPTED, and UNKNOWN)
  // Spec p.18: Keep one rolling contact-ledger entry per execution; count reserved, accepted and unknown.
  // Only proven non-acceptance releases that attempt's reservation (to RELEASED or DISPLACED).
  const validHistory: IContactReservation[] = (gate.history || []).filter(
    (h: IContactReservation) => h.status !== 'RELEASED' && h.status !== 'DISPLACED'
  );

  // If this exact execution is retrying safely, reuse its existing reservation slot (C08, C20)
  const existingSelf = validHistory.find((h: IContactReservation) => h.executionId === executionId);
  if (existingSelf) {
    existingSelf.reservedAt = serverNow;
    existingSelf.expiresAt = expiresAt;
    existingSelf.priority = priority;
    existingSelf.status = 'RESERVED';
    gate.version += 1;
    await gate.save(session ? { session } : undefined);
    return { allowed: true, gateId: gate.id };
  }

  const contactsIn24h = validHistory.filter((h: IContactReservation) => h.reservedAt > cutoff24h);
  const contactsIn7d = validHistory.filter((h: IContactReservation) => h.reservedAt > cutoff7d);

  // Cap Rule 1: Max 1 marketing contact per rolling 24h with Collision Arbitration (Spec p.18, test B09)
  if (contactsIn24h.length >= 1) {
    // Collision arbitration: priority, then earliest expiry, then stable creation/ID order
    const displaceable = contactsIn24h.find((h: IContactReservation) => {
      if (h.status !== 'RESERVED') return false; // Cannot displace already accepted or unknown
      if (priority > (h.priority ?? 50)) return true;
      if (priority === (h.priority ?? 50)) {
        if (expiresAt.getTime() < h.expiresAt.getTime()) return true;
        if (expiresAt.getTime() === h.expiresAt.getTime() && executionId < h.executionId) return true;
      }
      return false;
    });

    if (displaceable) {
      logger.info(
        {
          candidateExecutionId: executionId,
          candidatePriority: priority,
          displacedExecutionId: displaceable.executionId,
          displacedPriority: displaceable.priority
        },
        'Collision Arbitration: Higher priority campaign displacing reserved contact slot'
      );

      displaceable.status = 'DISPLACED';

      // Defer the loser if still useful, otherwise mark skipped
      const displacedNextAvailable = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000 + 1000);
      const loserIsUseful = displacedNextAvailable < displaceable.expiresAt;

      await CampaignExecutionModel.updateOne(
        { id: displaceable.executionId, tenantId },
        {
          $set: {
            state: loserIsUseful ? 'DEFERRED' : 'SKIPPED',
            outcomeReason: loserIsUseful ? 'DEFERRED_CONTACT_CAP' : 'SKIPPED_CONTACT_CAP',
            dueAt: loserIsUseful ? displacedNextAvailable : undefined,
            'lease.token': null,
            'lease.until': null,
            'lease.claimedBy': null
          }
        },
        session ? { session } : {}
      );
    } else {
      const earliestRelease = new Date(contactsIn24h[0].reservedAt.getTime() + 24 * 60 * 60 * 1000 + 1000);
      logger.info(
        {
          executionId,
          destinationHash: destinationHash.slice(0, 8),
          contactsIn24h: contactsIn24h.length,
          priority
        },
        'Contact cap 1/24h exceeded and no lower priority reservation could be displaced'
      );

      if (earliestRelease < expiresAt) {
        return {
          allowed: false,
          reason: 'DEFERRED_CONTACT_CAP',
          nextAvailableAt: earliestRelease
        };
      }
      return {
        allowed: false,
        reason: 'SKIPPED_CONTACT_CAP'
      };
    }
  }

  // Cap Rule 2: Max 3 marketing contacts per rolling 7d (Spec p.18)
  if (contactsIn7d.length >= 3) {
    const oldestIn7d = [...contactsIn7d].sort(
      (a: IContactReservation, b: IContactReservation) => a.reservedAt.getTime() - b.reservedAt.getTime()
    )[0];
    const earliestRelease = new Date(oldestIn7d.reservedAt.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000);
    logger.info(
      { executionId, destinationHash: destinationHash.slice(0, 8), contactsIn7d: contactsIn7d.length },
      'Contact cap 3/7d exceeded'
    );

    if (earliestRelease < expiresAt) {
      return {
        allowed: false,
        reason: 'DEFERRED_CONTACT_CAP',
        nextAvailableAt: earliestRelease
      };
    }
    return {
      allowed: false,
      reason: 'SKIPPED_CONTACT_CAP'
    };
  }

  // Cap permits reservation! Atomically add reservation entry
  const newReservation: IContactReservation = {
    executionId,
    campaignId,
    priority,
    reservedAt: serverNow,
    expiresAt,
    status: 'RESERVED'
  };

  gate.history.push(newReservation);
  gate.version += 1;
  await gate.save(session ? { session } : undefined);

  logger.debug(
    { executionId, destinationHash: destinationHash.slice(0, 8), priority },
    'Successfully reserved contact capacity'
  );

  return {
    allowed: true,
    gateId: gate.id
  };
}

/**
 * Confirms or releases a reservation upon provider response (Spec p.18)
 */
export async function updateContactReservationStatus(
  tenantId: string,
  destinationPhone: string,
  executionId: string,
  status: 'ACCEPTED' | 'UNKNOWN' | 'RELEASED',
  session?: ClientSession
): Promise<void> {
  const canonicalPhone = normalizeE164(destinationPhone);
  const destinationHash = sha256(canonicalPhone);

  await CampaignContactGateModel.updateOne(
    { tenantId, destinationHash, 'history.executionId': executionId },
    {
      $set: {
        'history.$.status': status
      },
      $inc: { version: 1 }
    },
    session ? { session } : {}
  );
}

export async function releaseContactReservation(
  tenantId: string,
  executionId: string,
  destinationPhone: string
): Promise<void> {
  return updateContactReservationStatus(tenantId, destinationPhone, executionId, 'RELEASED');
}
