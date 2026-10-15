import mongoose, { Document, Schema } from 'mongoose';

export interface IIdempotencyRecord extends Document {
  id: string;
  tenantId: string;
  key: string;
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
    status: { type: String, required: true, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
    statusCode: { type: Number },
    responseBody: { type: Schema.Types.Mixed }
  },
  {
    timestamps: true,
    collection: 'idempotencyRecords'
  }
);

IdempotencyRecordSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const IdempotencyRecordModel = mongoose.model<IIdempotencyRecord>(
  'IdempotencyRecord',
  IdempotencyRecordSchema
);
