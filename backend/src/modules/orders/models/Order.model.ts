import mongoose, { Document, Schema } from 'mongoose';

export type OrderStatus = 'COMPLETED' | 'REFUNDED' | 'CANCELLED';

export interface IOrder extends Document {
  id: string;
  tenantId: string;
  customerId: string;
  netPaise: number;
  occasionRef?: string;
  campaignId?: string | null;
  status: OrderStatus;
  refundedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    netPaise: { type: Number, required: true },
    occasionRef: { type: String, default: null },
    campaignId: { type: String, default: null, index: true },
    status: {
      type: String,
      required: true,
      enum: ['COMPLETED', 'REFUNDED', 'CANCELLED'],
      default: 'COMPLETED'
    },
    refundedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'orders'
  }
);

OrderSchema.index({ tenantId: 1, customerId: 1 });
OrderSchema.index({ tenantId: 1, occasionRef: 1 });
OrderSchema.index({ tenantId: 1, status: 1 });

export const OrderModel = mongoose.model<IOrder>('Order', OrderSchema);
