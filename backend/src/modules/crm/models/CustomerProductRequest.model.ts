import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomerProductRequest extends Document {
  id: string;
  tenantId: string;
  customerId: string;
  sku: string;
  weave?: string;
  color?: string;
  status: 'OPEN' | 'NOTIFIED' | 'PURCHASED' | 'CANCELLED';
  requestedAt: Date;
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerProductRequestSchema = new Schema<ICustomerProductRequest>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    sku: { type: String, required: true, index: true },
    weave: { type: String },
    color: { type: String },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'NOTIFIED', 'PURCHASED', 'CANCELLED'],
      default: 'OPEN'
    },
    requestedAt: { type: Date, required: true, default: Date.now },
    notifiedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'crmProductRequests'
  }
);

CustomerProductRequestSchema.index({ tenantId: 1, sku: 1, status: 1 });

export const CustomerProductRequestModel = mongoose.model<ICustomerProductRequest>(
  'CustomerProductRequest',
  CustomerProductRequestSchema
);
