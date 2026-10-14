import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignCustomerFact extends Document {
  id: string;
  tenantId: string;
  customerId: string;
  lastQualifyingOrderId?: string | null;
  lastQualifyingPurchaseAt?: Date | null;
  nextEvaluationAt?: Date | null;
  aggregateVersion: number;
  tags: string[];
  preferences: {
    weave?: string[];
    budgetMaxPaise?: number;
    categories?: string[];
    preferredLanguage?: string;
  };
  serviceIssueOpen?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignCustomerFactSchema = new Schema<ICampaignCustomerFact>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true },
    lastQualifyingOrderId: { type: String, default: null },
    lastQualifyingPurchaseAt: { type: Date, default: null },
    nextEvaluationAt: { type: Date, default: null },
    aggregateVersion: { type: Number, required: true, default: 1 },
    tags: { type: [String], default: [] },
    preferences: {
      weave: { type: [String], default: [] },
      budgetMaxPaise: { type: Number },
      categories: { type: [String], default: [] },
      preferredLanguage: { type: String, default: 'en' }
    },
    serviceIssueOpen: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    collection: 'campaignCustomerFacts'
  }
);

CampaignCustomerFactSchema.index({ tenantId: 1, customerId: 1 }, { unique: true });
CampaignCustomerFactSchema.index({ tenantId: 1, nextEvaluationAt: 1 });

export const CampaignCustomerFactModel = mongoose.model<ICampaignCustomerFact>(
  'CampaignCustomerFact',
  CampaignCustomerFactSchema
);
