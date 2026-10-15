import mongoose, { Document, Schema } from 'mongoose';

export interface ITenantConnection extends Document {
  id: string;
  tenantId: string;
  connectionId: string; // WhatsApp Phone Number ID / Connection ID e.g. 'conn_padmavati' or Meta phone number ID
  provider: 'mock' | 'whatsapp_cloud';
  status: 'ACTIVE' | 'REVOKED';
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const TenantConnectionSchema = new Schema<ITenantConnection>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    connectionId: { type: String, required: true, unique: true },
    provider: { type: String, required: true, enum: ['mock', 'whatsapp_cloud'], default: 'whatsapp_cloud' },
    status: { type: String, required: true, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  {
    timestamps: true,
    collection: 'tenantConnections'
  }
);

TenantConnectionSchema.index({ tenantId: 1, status: 1 });

export const TenantConnectionModel = mongoose.model<ITenantConnection>(
  'TenantConnection',
  TenantConnectionSchema
);
