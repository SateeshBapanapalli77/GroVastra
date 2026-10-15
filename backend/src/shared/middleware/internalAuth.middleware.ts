import { Request, Response, NextFunction } from 'express';
import { verifyJwt, signJwt, AuthPayload } from './auth.middleware';
import { logger } from '../../config/logger';

export interface InternalServicePayload {
  tenantId: string;
  producer: string;
  eventFamily: string; // e.g. 'orders', 'campaign-events', 'inventory', 'crm'
}

/**
 * Signs an internal service token scoped strictly by tenant and event family
 */
export function signInternalServiceToken(payload: InternalServicePayload): string {
  return signJwt({
    userId: `svc_${payload.producer}`,
    role: 'SYSTEM',
    ...payload
  } as any);
}

/**
 * Enforces per-producer, per-tenant internal service authentication.
 * Multi-Tenancy Rule 5: Tenant comes ONLY from the verified credential, never from a header or request body.
 */
export function requireInternalAuth(requiredEventFamily?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Extract credential from Authorization Bearer or x-internal-api-key header
    const authHeader = req.headers['authorization'];
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-internal-api-key']) {
      token = String(req.headers['x-internal-api-key']).trim();
    }

    if (!token) {
      logger.warn({ ip: req.ip, path: req.path }, 'Rejected request: Missing internal service credential');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Internal service credential is required'
      });
    }

    // 2. Verify cryptographically
    let payload: AuthPayload & { producer?: string; eventFamily?: string };
    try {
      payload = verifyJwt(token) as any;
    } catch (err: any) {
      logger.warn({ err: err.message, path: req.path }, 'Failed internal service credential verification');
      return res.status(401).json({
        success: false,
        error: `Unauthorized internal service call: ${err.message}`
      });
    }

    // 3. Validate role and event family
    if (payload.role !== 'SYSTEM' && payload.role !== 'BOUTIQUE_OWNER') {
      logger.warn({ role: payload.role, userId: payload.userId }, 'Internal service credential lacks SYSTEM permissions');
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Credential does not have system service access'
      });
    }

    if (requiredEventFamily && payload.eventFamily && payload.eventFamily !== '*' && payload.eventFamily !== requiredEventFamily) {
      logger.warn(
        { credentialFamily: payload.eventFamily, requiredFamily: requiredEventFamily },
        'Internal service credential event family mismatch'
      );
      return res.status(403).json({
        success: false,
        error: `Forbidden: Credential is scoped for event family '${payload.eventFamily}', but '${requiredEventFamily}' is required`
      });
    }

    // 4. Multi-Tenant Enforcement: Block conflicting header or body tenant
    const bodyTenant = req.body?.tenantId;
    const headerTenant = req.headers['x-tenant-id'] as string;

    if (bodyTenant && bodyTenant !== payload.tenantId) {
      logger.warn({ bodyTenant, credentialTenant: payload.tenantId }, 'Cross-tenant payload rejection');
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Request body tenantId does not match authenticated credential tenant'
      });
    }

    if (headerTenant && headerTenant !== payload.tenantId) {
      logger.warn({ headerTenant, credentialTenant: payload.tenantId }, 'Cross-tenant header rejection');
      return res.status(403).json({
        success: false,
        error: 'Forbidden: x-tenant-id header does not match authenticated credential tenant'
      });
    }

    // Bind strictly verified tenant
    req.user = payload;
    req.tenantId = payload.tenantId;

    next();
  };
}
