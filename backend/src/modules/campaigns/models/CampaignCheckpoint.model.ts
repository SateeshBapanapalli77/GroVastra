import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignCheckpoint extends Document {
  id: string;
  tenantId: string;
  workerType: 'CALENDAR_PLANNER' | 'EVENT_CONSUMER' | 'INACTIVITY_EVALUATOR' | 'DUE_EXECUTOR';
  cursor: Record<string, any>;
  lastRunAt: Date;
  completedAt: Date | null;
  lease: {
    token: string | null;
    until: Date | null;
    claimedBy: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CampaignCheckpointSchema = new Schema<ICampaignCheckpoint>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    workerType: {
      type: String,
      required: true,
      enum: ['CALENDAR_PLANNER', 'EVENT_CONSUMER', 'INACTIVITY_EVALUATOR', 'DUE_EXECUTOR']
    },
    cursor: { type: Schema.Types.Mixed, default: {} },
    lastRunAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date, default: null },
    lease: {
      token: { type: String, default: null },
      until: { type: Date, default: null },
      claimedBy: { type: String, default: null }
    }
  },
  {
    timestamps: true,
    collection: 'campaignCheckpoints'
  }
);

CampaignCheckpointSchema.index({ tenantId: 1, workerType: 1 }, { unique: true });

export const CampaignCheckpointModel = mongoose.model<ICampaignCheckpoint>(
  'CampaignCheckpoint',
  CampaignCheckpointSchema
);
