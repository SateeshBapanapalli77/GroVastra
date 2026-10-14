import mongoose, { Document, Schema } from 'mongoose';

export type EventProcessingStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface ICampaignEventInbox extends Document {
  id: string;
  tenantId: string;
  producer: string; // 'orders', 'inventory', 'crm', 'whatsapp'
  eventId: string;
  type: string; // 'order.completed', 'stock.published', etc.
  entityId: string;
  entityVersion: number;
  occurredAt: Date;
  receivedAt: Date;
  customerId?: string;
  data: Record<string, any>;
  status: EventProcessingStatus;
  processedAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignEventInboxSchema = new Schema<ICampaignEventInbox>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    producer: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    entityId: { type: String, required: true },
    entityVersion: { type: Number, required: true, default: 1 },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    customerId: { type: String },
    data: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      required: true,
      enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'],
      default: 'RECEIVED'
    },
    processedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null }
  },
  {
    timestamps: true,
    collection: 'campaignEventInbox'
  }
);

// Compound Unique Index: Page 25 specification
CampaignEventInboxSchema.index(
  { tenantId: 1, producer: 1, eventId: 1 },
  { unique: true }
);

CampaignEventInboxSchema.index({ tenantId: 1, status: 1, receivedAt: 1 });

export const CampaignEventInboxModel = mongoose.model<ICampaignEventInbox>(
  'CampaignEventInbox',
  CampaignEventInboxSchema
);
