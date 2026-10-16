import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';
import { UserRole } from '../../../shared/middleware/auth.middleware';

export interface IUser extends Document {
  id: string;
  tenantId: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  shopName: string;
  createdAt: Date;
  updatedAt: Date;
  verifyPassword(password: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: ['BOUTIQUE_OWNER', 'STORE_MANAGER', 'STAFF', 'SYSTEM']
    },
    shopName: { type: String, required: true }
  },
  {
    timestamps: true,
    collection: 'users'
  }
);

UserSchema.index({ username: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1 });

const LEGACY_SALT = 'grovastra_salt_heritage_boutique';
const DUMMY_SALT = '0123456789abcdef0123456789abcdef';

/**
 * Derives password hash using async scrypt with a per-user random 16-byte salt.
 * Format: scheme$salt$hash
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Checks if a stored password hash was created with the legacy scheme and requires upgrading.
 */
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith('scrypt$');
}

/**
 * Executes dummy scrypt hash computation to prevent username enumeration timing attacks.
 */
export async function dummyHash(password: string): Promise<void> {
  await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, DUMMY_SALT, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Verifies a password against either modern scrypt$salt$hash or legacy PBKDF2 hash.
 */
export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, expectedHashHex] = parts;
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      });
    });
    const expectedBuf = Buffer.from(expectedHashHex, 'hex');
    if (derivedKey.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedKey, expectedBuf);
  }

  // Legacy PBKDF2 fallback verification
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, LEGACY_SALT, 10000, 64, 'sha512', (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  const expectedBuf = Buffer.from(storedHash, 'hex');
  if (derivedKey.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derivedKey, expectedBuf);
}

UserSchema.methods.verifyPassword = async function (password: string): Promise<boolean> {
  return verifyPasswordHash(password, this.passwordHash);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
