import mongoose, { Document, Schema } from 'mongoose';

export interface IIdempotencyRecord extends Document {
  id: string;
  tenantId: string;
  key: string;
  method?: string;
  route?: string;
  requestBodyHash?: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  statusCode?: number;
  responseBody?: any;
  createdAt: Date;
  updatedAt: Date;
}

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    key: { type: String, required: true },
    method: { type: String },
    route: { type: String },
    requestBodyHash: { type: String },
    status: { type: String, required: true, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
    statusCode: { type: Number },
    responseBody: { type: Schema.Types.Mixed }
  },
  {
    timestamps: true,
    collection: 'idempotencyRecords'
  }
);

// Unique scoped key per tenant
IdempotencyRecordSchema.index({ tenantId: 1, key: 1 }, { unique: true });

// TTL index: 24 hours (86,400 seconds)
IdempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const IdempotencyRecordModel = mongoose.model<IIdempotencyRecord>(
  'IdempotencyRecord',
  IdempotencyRecordSchema
);
