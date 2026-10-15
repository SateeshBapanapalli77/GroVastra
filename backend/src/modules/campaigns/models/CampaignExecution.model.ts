import mongoose, { Document, Schema } from 'mongoose';

export type ExecutionState =
  | 'SCHEDULED'
  | 'EVALUATING'
  | 'DISPATCHING'
  | 'PROVIDER_ACCEPTED'
  | 'DELIVERED'
  | 'READ'
  | 'OUTCOME_UNKNOWN'
  | 'SKIPPED'
  | 'DEFERRED'
  | 'FAILED';

export interface ICampaignExecution extends Document {
  id: string;
  tenantId: string;
  enrollmentId: string;
  campaignId: string;
  stepId: string; // Stable identifier e.g. 'invitation', 'followup', 'greeting'
  dueAt: Date;
  expiresAt: Date;
  localDate: string; // 'YYYY-MM-DD'
  localTime: string; // '10:00'
  timezone: string; // 'Asia/Kolkata'
  planRevision: number; // CAS revision counter
  state: ExecutionState;
  prerequisite: 'NONE' | 'PREVIOUS_ACCEPTED';
  deliveryIntentId: string | null;
  lease: {
    token: string | null;
    until: Date | null;
    claimedBy: string | null;
  };
  outcomeReason?: string; // Precedence reason e.g. 'SKIPPED_GOAL_REACHED', 'SKIPPED_CONTACT_CAP'
  retryCount: number;
  retryAt?: Date | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignExecutionSchema = new Schema<ICampaignExecution>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    enrollmentId: { type: String, required: true },
    campaignId: { type: String, required: true },
    stepId: { type: String, required: true },
    dueAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    localDate: { type: String, required: true },
    localTime: { type: String, required: true },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    planRevision: { type: Number, required: true, default: 1 },
    state: {
      type: String,
      required: true,
      enum: [
        'SCHEDULED',
        'EVALUATING',
        'DISPATCHING',
        'PROVIDER_ACCEPTED',
        'DELIVERED',
        'READ',
        'OUTCOME_UNKNOWN',
        'SKIPPED',
        'DEFERRED',
        'FAILED'
      ],
      default: 'SCHEDULED'
    },
    prerequisite: {
      type: String,
      required: true,
      enum: ['NONE', 'PREVIOUS_ACCEPTED'],
      default: 'NONE'
    },
    deliveryIntentId: { type: String, default: null },
    lease: {
      token: { type: String, default: null },
      until: { type: Date, default: null },
      claimedBy: { type: String, default: null }
    },
    outcomeReason: { type: String },
    retryCount: { type: Number, default: 0 },
    retryAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'campaignExecutions'
  }
);

// Compound Unique Index: Page 25 specification
CampaignExecutionSchema.index(
  { tenantId: 1, enrollmentId: 1, stepId: 1 },
  { unique: true }
);

// Poller Index for worker claims: Page 25 specification
CampaignExecutionSchema.index(
  { state: 1, dueAt: 1, _id: 1 }
);

CampaignExecutionSchema.index({ tenantId: 1, campaignId: 1, state: 1 });

export const CampaignExecutionModel = mongoose.model<ICampaignExecution>(
  'CampaignExecution',
  CampaignExecutionSchema
);
