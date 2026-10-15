import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignTombstone extends Document {
  id: string;
  tenantId: string;
  enrollmentKey: string; // ${tenantId}:${campaignId}:${customerId}:${occurrenceId}
  campaignId: string;
  customerId: string;
  occurrenceId: string;
  executionKeys: string[]; // ${tenantId}:${enrollmentId}:${stepId}
  prunedAt: Date;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignTombstoneSchema = new Schema<ICampaignTombstone>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    enrollmentKey: { type: String, required: true },
    campaignId: { type: String, required: true },
    customerId: { type: String, required: true },
    occurrenceId: { type: String, required: true },
    executionKeys: { type: [String], default: [] },
    prunedAt: { type: Date, required: true, default: Date.now },
    reason: { type: String, default: 'RETENTION_CLEANUP' }
  },
  {
    timestamps: true,
    collection: 'campaignTombstones'
  }
);

CampaignTombstoneSchema.index({ tenantId: 1, enrollmentKey: 1 }, { unique: true });
CampaignTombstoneSchema.index({ tenantId: 1, executionKeys: 1 });

export const CampaignTombstoneModel = mongoose.model<ICampaignTombstone>(
  'CampaignTombstone',
  CampaignTombstoneSchema
);
