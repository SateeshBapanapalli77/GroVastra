import { describe, it, expect } from 'vitest';
import { Request, Response } from 'express';
import { signJwt, verifyJwt, requireAuth, requireRole } from '../src/shared/middleware/auth.middleware';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: any) => ((res.body = b), res);
  return res as Response & { statusCode: number; body: any };
}
const run = (headers: Record<string, string>) => {
  const req = { headers } as unknown as Request;
  const res = mockRes();
  let nexted = false;
  requireAuth(req, res, () => (nexted = true));
  return { req, res, nexted };
};

describe('auth fails closed (no DB required)', () => {
  it('rejects a request with no token, even with an x-tenant-id header', () => {
    const { res, nexted } = run({ 'x-tenant-id': 'shop_victim' });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a forged token signed with another secret', () => {
    const forged = signJwt({ userId: 'x', tenantId: 'shop_a', role: 'SYSTEM' }, 'not-the-real-secret-not-the-real-secret');
    const { res, nexted } = run({ authorization: `Bearer ${forged}` });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a validly signed token with an unknown role', () => {
    const token = signJwt({ userId: 'x', tenantId: 'shop_a', role: 'GOD' as any });
    expect(() => verifyJwt(token)).toThrow('Invalid token claims');
  });

  it('blocks a token for tenant A that asks for tenant B via header', () => {
    const token = signJwt({ userId: 'u', tenantId: 'shop_a', role: 'STAFF' });
    const { res, nexted } = run({ authorization: `Bearer ${token}`, 'x-tenant-id': 'shop_b' });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('takes the tenant from the credential and enforces roles', () => {
    const token = signJwt({ userId: 'u', tenantId: 'shop_a', role: 'STAFF' });
    const { req, nexted } = run({ authorization: `Bearer ${token}` });
    expect(nexted).toBe(true);
    expect(req.tenantId).toBe('shop_a');
    const res = mockRes();
    let ok = false;
    requireRole(['BOUTIQUE_OWNER'])(req, res, () => (ok = true));
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /auth/token is gone', () => {
  it('no route in the campaign router mints tokens', async () => {
    const { campaignRouter } = await import('../src/modules/campaigns/routes/campaign.routes');
    const paths = campaignRouter.stack.map((l: any) => l.route?.path).filter(Boolean);
    expect(paths).not.toContain('/auth/token');
  });
});
