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
  verifyPassword(password: string): boolean;
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

export function hashPassword(password: string): string {
  const salt = 'grovastra_salt_heritage_boutique';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

UserSchema.methods.verifyPassword = function (password: string): boolean {
  const hash = hashPassword(password);
  const bufA = Buffer.from(this.passwordHash);
  const bufB = Buffer.from(hash);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
