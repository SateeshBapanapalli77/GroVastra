import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignDryRun extends Document {
  id: string;
  tenantId: string;
  campaignId: string;
  draftVersion: number;
  draftFingerprint: string;
  evaluatedAt: Date;
  summary: {
    totalEvaluated: number;
    eligibleCount: number;
    excludedCount: number;
  };
  reasonBreakdown: Record<string, number>; // e.g. { 'NO_UPCOMING_BIRTHDAY': 12, 'OPTED_OUT': 3 }
  samplePlans: Array<{
    customerId: string;
    customerName: string;
    occasionDate: string;
    steps: Array<{
      stepId: string;
      dueAtUtc: Date;
      localTime: string;
      renderedPreview: string;
    }>;
  }>;
  createdAt: Date;
}

const CampaignDryRunSchema = new Schema<ICampaignDryRun>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    campaignId: { type: String, required: true },
    draftVersion: { type: Number, required: true },
    draftFingerprint: { type: String, required: true },
    evaluatedAt: { type: Date, required: true, default: Date.now },
    summary: {
      totalEvaluated: { type: Number, required: true },
      eligibleCount: { type: Number, required: true },
      excludedCount: { type: Number, required: true }
    },
    reasonBreakdown: { type: Map, of: Number, default: {} },
    samplePlans: [{ type: Schema.Types.Mixed }]
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'campaignDryRuns'
  }
);

CampaignDryRunSchema.index({ tenantId: 1, campaignId: 1, draftFingerprint: 1 });

export const CampaignDryRunModel = mongoose.model<ICampaignDryRun>(
  'CampaignDryRun',
  CampaignDryRunSchema
);
