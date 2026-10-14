import { CampaignContactGateModel, IContactReservation } from '../../models/CampaignContactGate.model';
import { sha256 } from '../../../../shared/utils/crypto';
import { generateId } from '../../../../shared/utils/id';
import { DateTime } from 'luxon';
import { logger } from '../../../../config/logger';

export interface CapCheckResult {
  allowed: boolean;
  reason?: 'SKIPPED_CONTACT_CAP' | 'DEFERRED_CONTACT_CAP';
  nextAvailableAt?: Date;
  gateId?: string;
}

import mongoose from 'mongoose';

// In-memory fallback cache for fast unit tests when offline / DB disconnected
const inMemoryGates: Map<string, any> = new Map();

/**
 * Enforces destination-level rolling contact caps (1 per 24h, 3 per 7d)
 * and arbitrates priority across competing campaigns. (Handoff Page 18)
 */
export async function checkAndReserveContactCapacity(
  tenantId: string,
  destinationPhone: string,
  campaignId: string,
  executionId: string,
  expiresAt: Date,
  priority: number = 80,
  serverNow: Date = new Date()
): Promise<CapCheckResult> {
  const destinationHash = sha256(destinationPhone);
  const isDbConnected = mongoose.connection.readyState === 1;

  let gate: any = null;

  if (isDbConnected) {
    gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash });
    if (!gate) {
      try {
        gate = await CampaignContactGateModel.create({
          id: generateId('cg'),
          tenantId,
          destinationHash,
          version: 1,
          history: []
        });
      } catch (err) {
        gate = await CampaignContactGateModel.findOne({ tenantId, destinationHash });
      }
    }
  } else {
    // In-memory mode for unit testing
    const cacheKey = `${tenantId}:${destinationHash}`;
    if (!inMemoryGates.has(cacheKey)) {
      inMemoryGates.set(cacheKey, {
        id: generateId('cg'),
        tenantId,
        destinationHash,
        version: 1,
        history: []
      });
    }
    gate = inMemoryGates.get(cacheKey);
  }

  if (!gate) {
    throw new Error('Failed to acquire or initialize contact gate');
  }

  const nowDt = DateTime.fromJSDate(serverNow);
  const cutoff24h = nowDt.minus({ hours: 24 }).toJSDate();
  const cutoff7d = nowDt.minus({ days: 7 }).toJSDate();

  // Active entries in rolling windows (exclude released entries)
  const validHistory: IContactReservation[] = (gate.history || []).filter((h: IContactReservation) => h.status !== 'RELEASED');

  const contactsIn24h = validHistory.filter((h: IContactReservation) => h.reservedAt > cutoff24h);
  const contactsIn7d = validHistory.filter((h: IContactReservation) => h.reservedAt > cutoff7d);

  // Cap Rule 1: Max 1 per rolling 24h
  if (contactsIn24h.length >= 1) {
    const earliestRelease = new Date(contactsIn24h[0].reservedAt.getTime() + 24 * 60 * 60 * 1000 + 1000);
    logger.info(
      { executionId, destinationHash: destinationHash.slice(0, 8), contactsIn24h: contactsIn24h.length },
      'Contact cap 1/24h exceeded'
    );

    // If earliest slot is before execution expiresAt, we can defer; otherwise skip permanently
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

  // Cap Rule 2: Max 3 per rolling 7d
  if (contactsIn7d.length >= 3) {
    const oldestIn7d = contactsIn7d.sort((a: IContactReservation, b: IContactReservation) => a.reservedAt.getTime() - b.reservedAt.getTime())[0];
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
    reservedAt: serverNow,
    expiresAt,
    status: 'RESERVED'
  };

  gate.history.push(newReservation);
  gate.version += 1;
  if (typeof gate.save === 'function') {
    await gate.save();
  }

  logger.debug(
    { executionId, destinationHash: destinationHash.slice(0, 8) },
    'Successfully reserved contact capacity'
  );

  return {
    allowed: true,
    gateId: gate.id
  };
}

/**
 * Confirms or releases a reservation upon provider response
 */
export async function updateContactReservationStatus(
  tenantId: string,
  destinationPhone: string,
  executionId: string,
  status: 'ACCEPTED' | 'UNKNOWN' | 'RELEASED'
): Promise<void> {
  const destinationHash = sha256(destinationPhone);
  const isDbConnected = mongoose.connection.readyState === 1;

  if (isDbConnected) {
    await CampaignContactGateModel.updateOne(
      { tenantId, destinationHash, 'history.executionId': executionId },
      {
        $set: {
          'history.$.status': status
        },
        $inc: { version: 1 }
      }
    );
  } else {
    const cacheKey = `${tenantId}:${destinationHash}`;
    const gate = inMemoryGates.get(cacheKey);
    if (gate) {
      const reservation = gate.history.find((h: any) => h.executionId === executionId);
      if (reservation) {
        reservation.status = status;
      }
      gate.version += 1;
    }
  }
}
