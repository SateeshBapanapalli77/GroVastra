import mongoose, { Document, Schema } from 'mongoose';

export interface IBoutiqueJob extends Document {
  id: string;
  tenantId: string;
  customerId: string;
  orderId?: string;
  jobType: 'ALTERATION' | 'BLOUSE_STITCHING' | 'FALL_PICO';
  itemTitle: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' | 'COLLECTED';
  readyAt?: Date | null;
  collectedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const BoutiqueJobSchema = new Schema<IBoutiqueJob>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    orderId: { type: String },
    jobType: {
      type: String,
      required: true,
      enum: ['ALTERATION', 'BLOUSE_STITCHING', 'FALL_PICO'],
      default: 'ALTERATION'
    },
    itemTitle: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'COLLECTED'],
      default: 'PENDING'
    },
    readyAt: { type: Date, default: null },
    collectedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    collection: 'boutiqueJobs'
  }
);

BoutiqueJobSchema.index({ tenantId: 1, status: 1 });

export const BoutiqueJobModel = mongoose.model<IBoutiqueJob>(
  'BoutiqueJob',
  BoutiqueJobSchema
);
