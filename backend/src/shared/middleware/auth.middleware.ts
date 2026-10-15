import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export type UserRole = 'BOUTIQUE_OWNER' | 'STORE_MANAGER' | 'STAFF' | 'SYSTEM';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      tenantId?: string;
    }
  }
}

/**
 * Creates a signed JWT with HMAC-SHA256 signature
 */
export function signJwt(payload: AuthPayload, secret: string = env.JWT_SECRET): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 30 * 86400 // 30-day token lifetime
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Verifies a signed JWT using timing-safe comparison
 */
export function verifyJwt(token: string, secret: string = env.JWT_SECRET): AuthPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token structure');
  }

  const [b64Header, b64Payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  const bufSig = Buffer.from(signature);
  const bufExpected = Buffer.from(expectedSig);

  if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
    throw new Error('Invalid token signature');
  }

  const payload: AuthPayload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Authentication Middleware: Extracts, verifies and enforces tenant identity from bearer token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  // In test and local development, allow fallback to signed default owner token if no token is provided
  if (!token) {
    if (env.NODE_ENV !== 'production') {
      const devTenantId = (req.headers['x-tenant-id'] as string) || env.DEFAULT_TENANT_ID;
      token = signJwt({
        userId: 'dev_boutique_owner_01',
        tenantId: devTenantId,
        role: 'BOUTIQUE_OWNER'
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Missing Bearer token in Authorization header.'
      });
    }
  }

  try {
    const payload = verifyJwt(token);

    // Cross-tenant protection: if a client passes an x-tenant-id header that conflicts with credentials, block it!
    const requestedTenant = req.headers['x-tenant-id'] as string;
    if (requestedTenant && requestedTenant !== payload.tenantId && payload.role !== 'SYSTEM') {
      logger.warn(
        { requestedTenant, credentialTenant: payload.tenantId, userId: payload.userId },
        'Cross-tenant access attempt blocked'
      );
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot access resources outside your authenticated tenant scope.'
      });
    }

    req.user = payload;
    req.tenantId = payload.tenantId;
    next();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed JWT authentication check');
    return res.status(401).json({
      success: false,
      error: `Unauthorized: ${err.message}`
    });
  }
}

/**
 * Role-Based Access Control Middleware
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'SYSTEM') {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Role '${req.user.role}' lacks permission for this action.`
      });
    }

    next();
  };
}
