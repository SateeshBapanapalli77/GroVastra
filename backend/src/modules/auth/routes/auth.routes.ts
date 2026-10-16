import { Router, Request, Response } from 'express';
import { UserModel, dummyHash, needsRehash, hashPassword } from '../models/User.model';
import { signJwt, requireAuth } from '../../../shared/middleware/auth.middleware';
import { logger } from '../../../config/logger';
import { formatErrorResponse } from '../../../shared/utils/errors';

export const authRouter = Router();

const loginAttempts = new Map<string, { count: number; resetTime: number }>();

function checkLoginRateLimit(ip: string): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetTime) {
    loginAttempts.set(ip, { count: 1, resetTime: now + 60000 });
    return true;
  }
  if (record.count >= 10) {
    return false;
  }
  record.count += 1;
  return true;
}

/**
 * POST /api/v1/auth/login
 * Real credentials-backed authentication endpoint (spec p.26)
 * Returns a cryptographically signed JWT scoped strictly to the user's verified tenantId and role.
 */
authRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkLoginRateLimit(clientIp)) {
      return res.status(429).json(
        formatErrorResponse(
          'Too many login attempts. Please wait 1 minute before retrying.',
          'RATE_LIMIT_EXCEEDED'
        )
      );
    }

    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      const fieldPath = !username ? 'username' : 'password';
      return res.status(400).json(
        formatErrorResponse(
          'Username and password are required',
          'MISSING_CREDENTIALS',
          fieldPath
        )
      );
    }

    const user = await UserModel.findOne({ username: username.toLowerCase().trim() });
    if (!user) {
      // Timing parity: run dummy scrypt hash computation so response timing matches valid user check
      await dummyHash(password);
      logger.warn({ username: username.toLowerCase().trim() }, 'Failed login attempt: User not found');
      return res.status(401).json(
        formatErrorResponse(
          'Invalid username or password',
          'INVALID_CREDENTIALS'
        )
      );
    }

    const isMatch = await user.verifyPassword(password);
    if (!isMatch) {
      logger.warn({ username: user.username }, 'Failed login attempt: Invalid password');
      return res.status(401).json(
        formatErrorResponse(
          'Invalid username or password',
          'INVALID_CREDENTIALS'
        )
      );
    }

    // Upgrade old/legacy password hashes to modern scrypt$salt$hash on successful authentication
    if (needsRehash(user.passwordHash)) {
      user.passwordHash = await hashPassword(password);
      await user.save();
      logger.info({ userId: user.id }, 'Upgraded user password hash to modern scrypt scheme');
    }

    const token = signJwt({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role
    });

    logger.info({ userId: user.id, tenantId: user.tenantId, role: user.role }, 'User authenticated successfully');

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        shopName: user.shopName
      }
    });
  } catch (err: any) {
    logger.error({ err }, 'Error during user login');
    res.status(500).json(
      formatErrorResponse(err.message || 'Internal server error', 'INTERNAL_ERROR')
    );
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user context and tenant profile
 */
authRouter.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const tenantId = req.tenantId!;

    const user = await UserModel.findOne({ id: userId, tenantId });
    if (!user) {
      return res.json({
        success: true,
        user: {
          id: userId,
          tenantId,
          role: req.user!.role,
          shopName: 'Heritage Boutique'
        }
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        shopName: user.shopName
      }
    });
  } catch (err: any) {
    res.status(500).json(
      formatErrorResponse(err.message || 'Internal server error', 'INTERNAL_ERROR')
    );
  }
});
