import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomerEnquiry extends Document {
  id: string;
  tenantId: string;
  customerId: string;
  channel: 'INSTAGRAM_DM' | 'WHATSAPP' | 'STORE_VISIT';
  inquiryText: string;
  itemInterest?: string;
  status: 'OPEN' | 'STAFF_HOLD' | 'RESOLVED' | 'PURCHASED' | 'DROPPED';
  lastInteractionAt: Date;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerEnquirySchema = new Schema<ICustomerEnquiry>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    channel: {
      type: String,
      required: true,
      enum: ['INSTAGRAM_DM', 'WHATSAPP', 'STORE_VISIT'],
      default: 'WHATSAPP'
    },
    inquiryText: { type: String, required: true },
    itemInterest: { type: String },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'STAFF_HOLD', 'RESOLVED', 'PURCHASED', 'DROPPED'],
      default: 'OPEN'
    },
    lastInteractionAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'crmEnquiries'
  }
);

CustomerEnquirySchema.index({ tenantId: 1, status: 1, lastInteractionAt: 1 });

export const CustomerEnquiryModel = mongoose.model<ICustomerEnquiry>(
  'CustomerEnquiry',
  CustomerEnquirySchema
);
