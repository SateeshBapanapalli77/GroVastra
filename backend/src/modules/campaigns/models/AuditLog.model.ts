import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, any>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'auditLogs'
  }
);

AuditLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, targetId: 1 });

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
