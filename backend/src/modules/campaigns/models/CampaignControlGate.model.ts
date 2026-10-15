import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignControlGate extends Document {
  id: string;
  tenantId: string;
  campaignId: string;
  paused: boolean;
  pauseGeneration: number;
  gateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignControlGateSchema = new Schema<ICampaignControlGate>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    campaignId: { type: String, required: true },
    paused: { type: Boolean, required: true, default: false },
    pauseGeneration: { type: Number, required: true, default: 0 },
    gateVersion: { type: Number, required: true, default: 1 }
  },
  {
    timestamps: true,
    collection: 'campaignControlGates'
  }
);

CampaignControlGateSchema.index({ tenantId: 1, campaignId: 1 }, { unique: true });

export const CampaignControlGateModel = mongoose.model<ICampaignControlGate>(
  'CampaignControlGate',
  CampaignControlGateSchema
);
