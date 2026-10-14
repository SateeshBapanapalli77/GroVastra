import mongoose, { Document, Schema } from 'mongoose';

export type DeliveryIntentState = 'SUBMITTING' | 'ACCEPTED' | 'REJECTED' | 'OUTCOME_UNKNOWN';

export interface ICampaignDeliveryIntent extends Document {
  id: string;
  tenantId: string;
  executionId: string;
  deliveryKey: string; // equals executionId
  connectionId: string; // WhatsApp provisioned connection
  customerId: string;
  recipientVersion: number;
  encryptedRecipient: string; // AES-256-GCM encrypted phone number
  templateRef: {
    id: string;
    revision: number;
    language: string;
  };
  parameters: Record<string, string>;
  payloadHash: string; // canonical hash
  state: DeliveryIntentState;
  attemptId: string;
  providerMessageId: string | null;
  submittedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  errorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignDeliveryIntentSchema = new Schema<ICampaignDeliveryIntent>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    executionId: { type: String, required: true },
    deliveryKey: { type: String, required: true },
    connectionId: { type: String, required: true },
    customerId: { type: String, required: true },
    recipientVersion: { type: Number, required: true },
    encryptedRecipient: { type: String, required: true },
    templateRef: {
      id: { type: String, required: true },
      revision: { type: Number, required: true },
      language: { type: String, required: true, default: 'en' }
    },
    parameters: { type: Map, of: String, default: {} },
    payloadHash: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: ['SUBMITTING', 'ACCEPTED', 'REJECTED', 'OUTCOME_UNKNOWN'],
      default: 'SUBMITTING'
    },
    attemptId: { type: String, required: true },
    providerMessageId: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    errorCode: { type: String, default: null }
  },
  {
    timestamps: true,
    collection: 'campaignDeliveryIntents'
  }
);

// Compound Unique Index: Page 25 specification
CampaignDeliveryIntentSchema.index(
  { tenantId: 1, executionId: 1 },
  { unique: true }
);

CampaignDeliveryIntentSchema.index(
  { tenantId: 1, providerMessageId: 1 },
  { sparse: true }
);

export const CampaignDeliveryIntentModel = mongoose.model<ICampaignDeliveryIntent>(
  'CampaignDeliveryIntent',
  CampaignDeliveryIntentSchema
);
