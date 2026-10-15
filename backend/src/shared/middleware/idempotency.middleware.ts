import { Request, Response, NextFunction } from 'express';
import { IdempotencyRecordModel } from '../../modules/campaigns/models/Idempotency.model';
import { generateId } from '../utils/id';

/**
 * Middleware ensuring idempotent mutation operations.
 * Caches and returns completed responses when the same Idempotency-Key is replayed.
 */
export async function requireIdempotency(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const key = (typeof headerKey === 'string' ? headerKey : req.body?.idempotencyKey) as string | undefined;

  if (!key) {
    return next();
  }

  const tenantId = (req as any).tenantId;
  if (!tenantId) {
    return next();
  }

  try {
    const existing = await IdempotencyRecordModel.findOne({ tenantId, key });
    if (existing) {
      if (existing.status === 'COMPLETED') {
        return res.status(existing.statusCode || 200).json(existing.responseBody);
      }
      return res.status(409).json({
        success: false,
        error: 'A request with this idempotency key is currently being processed.'
      });
    }

    const record = await IdempotencyRecordModel.create({
      id: generateId('idemp'),
      tenantId,
      key,
      status: 'IN_PROGRESS'
    });

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Async update cached response in background
      IdempotencyRecordModel.updateOne(
        { id: record.id },
        {
          $set: {
            status: 'COMPLETED',
            statusCode: res.statusCode,
            responseBody: body
          }
        }
      ).exec().catch(() => {});

      return originalJson(body);
    };

    next();
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Concurrent mutation conflict with the same idempotency key.'
      });
    }
    next(err);
  }
}
