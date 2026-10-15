import mongoose, { Document, Schema } from 'mongoose';

export type EnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface ICampaignEnrollment extends Document {
  id: string;
  tenantId: string;
  campaignId: string;
  campaignVersionId: string;
  customerId: string;
  occurrenceId: string; // e.g. 'birthday:2027', 'stockoffer:off_101', 'winback:ord_01:rule_1'
  sourceRef: {
    type: 'CUSTOMER_DATE' | 'STOCK_EVENT' | 'ORDER_EVENT' | 'ENQUIRY_EVENT';
    id: string;
    version: number;
  };
  occasionLocalDate?: string; // 'YYYY-MM-DD'
  planRevision: number; // CAS revision counter
  status: EnrollmentStatus;
  replyHoldAt: Date | null;
  goalReachedAt: Date | null;
  goalOrderRef?: string;
  correctionGroupId?: string;
  matchExplanation?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignEnrollmentSchema = new Schema<ICampaignEnrollment>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    campaignId: { type: String, required: true },
    campaignVersionId: { type: String, required: true },
    customerId: { type: String, required: true },
    occurrenceId: { type: String, required: true },
    sourceRef: {
      type: {
        type: String,
        required: true,
        enum: ['CUSTOMER_DATE', 'STOCK_EVENT', 'ORDER_EVENT', 'ENQUIRY_EVENT']
      },
      id: { type: String, required: true },
      version: { type: Number, required: true, default: 1 }
    },
    occasionLocalDate: { type: String },
    planRevision: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      required: true,
      enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
      default: 'ACTIVE'
    },
    replyHoldAt: { type: Date, default: null },
    goalReachedAt: { type: Date, default: null },
    goalOrderRef: { type: String },
    correctionGroupId: { type: String },
    matchExplanation: { type: String }
  },
  {
    timestamps: true,
    collection: 'campaignEnrollments'
  }
);

// Compound Unique Index: Page 25 specification
CampaignEnrollmentSchema.index(
  { tenantId: 1, campaignId: 1, customerId: 1, occurrenceId: 1 },
  { unique: true }
);

CampaignEnrollmentSchema.index({ tenantId: 1, customerId: 1, status: 1 });

export const CampaignEnrollmentModel = mongoose.model<ICampaignEnrollment>(
  'CampaignEnrollment',
  CampaignEnrollmentSchema
);
