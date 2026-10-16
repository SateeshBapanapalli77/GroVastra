import mongoose, { Document, Schema } from 'mongoose';

export type CampaignStatus = 'DRAFT' | 'VALIDATED' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface ICampaign extends Document {
  id: string;
  tenantId: string;
  presetId?: string | null;
  name: string;
  industry: 'BOUTIQUE' | 'HANDLOOM' | 'APPAREL';
  purpose: 'MARKETING' | 'ORDER_SERVICE';
  status: CampaignStatus;
  activeVersionId: string | null;
  draftVersion: number;
  pauseGeneration: number;
  activatedAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    presetId: { type: String, default: null },
    name: { type: String, required: true, minlength: 3, maxlength: 100 },
    industry: { type: String, required: true, enum: ['BOUTIQUE', 'HANDLOOM', 'APPAREL'], default: 'BOUTIQUE' },
    purpose: { type: String, required: true, enum: ['MARKETING', 'ORDER_SERVICE'], default: 'MARKETING' },
    status: {
      type: String,
      required: true,
      enum: ['DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'ARCHIVED'],
      default: 'DRAFT'
    },
    activeVersionId: { type: String, default: null },
    draftVersion: { type: Number, required: true, default: 1 },
    pauseGeneration: { type: Number, required: true, default: 0 },
    activatedAt: { type: Date, default: null },
    endAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'campaigns'
  }
);

CampaignSchema.index({ tenantId: 1, status: 1 });

export const CampaignModel = mongoose.model<ICampaign>('Campaign', CampaignSchema);
