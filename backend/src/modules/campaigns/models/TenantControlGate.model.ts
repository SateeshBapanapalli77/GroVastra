import mongoose, { Document, Schema } from 'mongoose';

export interface ITenantControlGate extends Document {
  id: string;
  tenantId: string;
  globalPause: boolean;
  gateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const TenantControlGateSchema = new Schema<ITenantControlGate>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, unique: true },
    globalPause: { type: Boolean, required: true, default: false },
    gateVersion: { type: Number, required: true, default: 1 }
  },
  {
    timestamps: true,
    collection: 'tenantControlGates'
  }
);


export const TenantControlGateModel = mongoose.model<ITenantControlGate>(
  'TenantControlGate',
  TenantControlGateSchema
);
