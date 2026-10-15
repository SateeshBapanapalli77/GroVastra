import mongoose, { Document, Schema } from 'mongoose';

export interface ITenantSettings extends Document {
  id: string;
  tenantId: string;
  version: number;
  timezone: string;
  allowedHours: {
    start: string; // '10:00'
    end: string;   // '19:00'
  };
  caps: {
    marketing24h: number; // default 1
    marketing7d: number;  // default 3
  };
  globalPause: boolean;
  outageGraceMinutes: number; // default 120 (2h)
  leapDayPolicy: 'FEB_28' | 'MAR_01' | 'LEAP_ONLY';
  holidays: string[]; // ['YYYY-MM-DD']
  blackouts: string[]; // ['YYYY-MM-DD']
  notice: string;
  createdAt: Date;
  updatedAt: Date;
}

export const REQUIRED_SETTINGS_NOTICE =
  'This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.';

const TenantSettingsSchema = new Schema<ITenantSettings>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, unique: true },
    version: { type: Number, required: true, default: 1 },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    allowedHours: {
      start: { type: String, required: true, default: '10:00' },
      end: { type: String, required: true, default: '19:00' }
    },
    caps: {
      marketing24h: { type: Number, required: true, default: 1 },
      marketing7d: { type: Number, required: true, default: 3 }
    },
    globalPause: { type: Boolean, required: true, default: false },
    outageGraceMinutes: { type: Number, required: true, default: 120 },
    leapDayPolicy: { type: String, required: true, enum: ['FEB_28', 'MAR_01', 'LEAP_ONLY'], default: 'FEB_28' },
    holidays: { type: [String], default: [] },
    blackouts: { type: [String], default: [] },
    notice: { type: String, required: true, default: REQUIRED_SETTINGS_NOTICE }
  },
  {
    timestamps: true,
    collection: 'tenantSettings'
  }
);

export const TenantSettingsModel = mongoose.model<ITenantSettings>(
  'TenantSettings',
  TenantSettingsSchema
);
