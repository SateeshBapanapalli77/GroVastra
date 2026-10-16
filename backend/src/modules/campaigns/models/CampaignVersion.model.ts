import mongoose, { Document, Schema } from 'mongoose';
import { LeapDayPolicy } from '../../../shared/utils/clock';

export interface ICampaignStep {
  stepId: string;
  offsetDays: number;
  localTime: string; // 'HH:mm' e.g. '10:00'
  prerequisite: 'NONE' | 'PREVIOUS_ACCEPTED';
  templateRef: {
    id: string;
    revision: number;
    language: string;
  };
  bindings: Record<string, string>; // e.g. { name: 'customer.firstName', shop: 'shop.displayName' }
  stopOnReply: boolean;
  stopOnGoal: boolean;
  maxLatenessMinutes: number; // default 120
}

export interface ICampaignVersion extends Document {
  id: string;
  tenantId: string;
  campaignId: string;
  presetId?: string | null;
  version: number;
  name: string;
  brandName?: string;
  industry: 'BOUTIQUE' | 'HANDLOOM' | 'APPAREL';
  purpose: 'MARKETING' | 'ORDER_SERVICE';
  trigger: {
    type: 'ANNUAL_DATE' | 'EVENT_DRIVEN' | 'INACTIVITY_SCAN';
    field?: string; // e.g. 'customer.birthday', 'customer.anniversary'
    eventType?: string; // e.g. 'stock.published', 'order.completed'
    inactivityDays?: number; // e.g. 90, 180
    leapDayPolicy?: LeapDayPolicy;
  };
  timezone: string; // 'Asia/Kolkata'
  audience: {
    mode: 'ALL_ELIGIBLE' | 'RULE_BASED';
    rules?: {
      all?: Array<{ field: string; op: string; value: any }>;
      any?: Array<{ field: string; op: string; value: any }>;
      none?: Array<{ field: string; op: string; value: any }>;
    };
  };
  goal?: {
    type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED' | 'ORDER_COMPLETED' | 'APPOINTMENT_ATTENDED';
    windowDays?: number;
  };
  steps: ICampaignStep[];
  priority: number; // e.g. Birthday=80, Wedding=70, Restock=60, Festival=50, Winback=30
  resumePolicy: 'FUTURE_ONLY' | 'REPLAY_RECENT';
  importPolicy: 'FUTURE_ONLY';
  enabledBranches: string[];
  publishedBy: string;
  publishedAt: Date;
  reviewFingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignStepSchema = new Schema<ICampaignStep>(
  {
    stepId: { type: String, required: true },
    offsetDays: { type: Number, required: true },
    localTime: { type: String, required: true, default: '10:00' },
    prerequisite: { type: String, required: true, enum: ['NONE', 'PREVIOUS_ACCEPTED'], default: 'NONE' },
    templateRef: {
      id: { type: String, required: true },
      revision: { type: Number, required: true },
      language: { type: String, required: true, default: 'en' }
    },
    bindings: { type: Map, of: String, default: {} },
    stopOnReply: { type: Boolean, required: true, default: true },
    stopOnGoal: { type: Boolean, required: true, default: true },
    maxLatenessMinutes: { type: Number, required: true, default: 120 }
  },
  { _id: false }
);

const CampaignVersionSchema = new Schema<ICampaignVersion>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    campaignId: { type: String, required: true },
    presetId: { type: String, default: null },
    version: { type: Number, required: true },
    name: { type: String, required: true },
    brandName: { type: String, default: null },
    industry: { type: String, required: true, default: 'BOUTIQUE' },
    purpose: { type: String, required: true, default: 'MARKETING' },
    trigger: {
      type: { type: String, required: true, enum: ['ANNUAL_DATE', 'EVENT_DRIVEN', 'INACTIVITY_SCAN'] },
      field: { type: String },
      eventType: { type: String },
      inactivityDays: { type: Number },
      leapDayPolicy: { type: String, enum: ['FEB_28', 'MAR_01', 'LEAP_ONLY'], default: 'FEB_28' }
    },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    audience: {
      mode: { type: String, required: true, enum: ['ALL_ELIGIBLE', 'RULE_BASED'], default: 'ALL_ELIGIBLE' },
      rules: { type: Schema.Types.Mixed, default: {} }
    },
    goal: {
      type: { type: String, default: 'OCCASION_TAGGED_OR_STAFF_COMPLETED' },
      windowDays: { type: Number, default: 14 }
    },
    steps: { type: [CampaignStepSchema], required: true },
    priority: { type: Number, required: true, default: 50 },
    resumePolicy: { type: String, required: true, default: 'FUTURE_ONLY' },
    importPolicy: { type: String, required: true, default: 'FUTURE_ONLY' },
    enabledBranches: { type: [String], default: ['default'] },
    publishedBy: { type: String, required: true, default: 'owner' },
    publishedAt: { type: Date, required: true, default: Date.now },
    reviewFingerprint: { type: String, required: true }
  },
  {
    timestamps: true,
    collection: 'campaignVersions'
  }
);

// Compound Unique Index: Page 25 specification
CampaignVersionSchema.index({ tenantId: 1, campaignId: 1, version: 1 }, { unique: true });

export const CampaignVersionModel = mongoose.model<ICampaignVersion>('CampaignVersion', CampaignVersionSchema);
