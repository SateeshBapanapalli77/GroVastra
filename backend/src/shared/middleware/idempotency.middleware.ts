import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { IdempotencyRecordModel } from '../../modules/campaigns/models/Idempotency.model';
import { generateId } from '../utils/id';
import { logger } from '../../config/logger';

export const IN_PROGRESS_RECOVERY_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Deterministically canonicalizes a JSON payload (sorting keys recursively)
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}';
}

/**
 * Computes SHA-256 hash of the canonical request body
 */
export function hashRequestBody(body: any): string {
  return crypto.createHash('sha256').update(canonicalizeJson(body)).digest('hex');
}

/**
 * Middleware ensuring hardened, idempotent mutation operations:
 * 1. Scopes the key to tenant + method + route + hash of request body.
 * 2. Replaying the same key with a different body returns 422.
 * 3. Recovers stale IN_PROGRESS records older than 2 minutes instead of 409 forever.
 * 4. Awaits the response-cache write before sending response to client.
 */
export async function requireIdempotency(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const key = (typeof headerKey === 'string' ? headerKey : req.body?.idempotencyKey) as string | undefined;

  // Strict Spec rule (Page 26, lines 1201-1202): "Mutations require idempotency keys"
  if (!key || key.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'IDEMPOTENCY_KEY_REQUIRED: State-mutating requests require an Idempotency-Key header.',
      code: 'IDEMPOTENCY_KEY_REQUIRED'
    });
  }

  const tenantId = (req as any).tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED: Tenant authentication context required.',
      code: 'UNAUTHORIZED'
    });
  }

  const method = req.method.toUpperCase();
  const route = (req.originalUrl || req.baseUrl + (req.route?.path || req.path)).split('?')[0];
  const bodyHash = hashRequestBody(req.body);

  try {
    const existing = await IdempotencyRecordModel.findOne({ tenantId, key });
    let targetRecordId: string;

    if (existing) {
      // Body or scope mismatch check: replaying key with different body/method/route returns 422
      if (
        (existing.requestBodyHash && existing.requestBodyHash !== bodyHash) ||
        (existing.method && existing.method !== method) ||
        (existing.route && existing.route !== route)
      ) {
        return res.status(422).json({
          success: false,
          error: 'IDEMPOTENCY_BODY_MISMATCH',
          code: 'IDEMPOTENCY_BODY_MISMATCH',
          message: 'The idempotency key was previously used with a different request payload, method, or route.'
        });
      }

      if (existing.status === 'COMPLETED') {
        return res.status(existing.statusCode || 200).json(existing.responseBody);
      }

      // Record is IN_PROGRESS: Check age for crash recovery (> 2 minutes)
      const recordAgeMs = Date.now() - (existing.updatedAt?.getTime() || existing.createdAt?.getTime() || 0);
      if (recordAgeMs <= IN_PROGRESS_RECOVERY_MS) {
        return res.status(409).json({
          success: false,
          error: 'A request with this idempotency key is currently being processed.',
          code: 'IDEMPOTENCY_IN_PROGRESS'
        });
      }

      // Recover stalled/crashed IN_PROGRESS record
      logger.warn(
        { tenantId, key, recordAgeMs, recordId: existing.id },
        'Recovering stalled IN_PROGRESS idempotency record exceeding 2 minutes'
      );

      const reclaimed = await IdempotencyRecordModel.findOneAndUpdate(
        { id: existing.id, status: 'IN_PROGRESS' },
        {
          $set: {
            status: 'IN_PROGRESS',
            method,
            route,
            requestBodyHash: bodyHash,
            statusCode: null,
            responseBody: null,
            updatedAt: new Date()
          }
        },
        { new: true }
      );

      if (!reclaimed) {
        return res.status(409).json({
          success: false,
          error: 'Concurrent mutation conflict while recovering idempotency record.',
          code: 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        });
      }

      targetRecordId = reclaimed.id;
    } else {
      try {
        const record = await IdempotencyRecordModel.create({
          id: generateId('idemp'),
          tenantId,
          key,
          method,
          route,
          requestBodyHash: bodyHash,
          status: 'IN_PROGRESS'
        });
        targetRecordId = record.id;
      } catch (insertErr: any) {
        if (insertErr?.code === 11000) {
          return res.status(409).json({
            success: false,
            error: 'Concurrent mutation conflict with the same idempotency key.',
            code: 'IDEMPOTENCY_CONCURRENT_CONFLICT'
          });
        }
        throw insertErr;
      }
    }

    // Wrap res.json to await response-cache write before sending
    const originalJson = res.json.bind(res);
    res.json = function (body: any): Response {
      (async () => {
        try {
          await IdempotencyRecordModel.updateOne(
            { id: targetRecordId },
            {
              $set: {
                status: 'COMPLETED',
                statusCode: res.statusCode || 200,
                responseBody: body,
                method,
                route,
                requestBodyHash: bodyHash
              }
            }
          );
        } catch (dbErr: any) {
          logger.error(
            { err: dbErr?.message, targetRecordId, key },
            'Failed to persist idempotency response cache'
          );
        } finally {
          originalJson(body);
        }
      })();
      return res;
    };

    next();
  } catch (err: any) {
    next(err);
  }
}
