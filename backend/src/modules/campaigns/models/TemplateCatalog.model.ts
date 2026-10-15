import mongoose, { Document, Schema } from 'mongoose';

export interface ITemplateCatalog extends Document {
  id: string; // e.g. 'tpl_birthday_invite'
  tenantId?: string | null; // null for global default templates, or tenant-scoped
  name: string;
  category: 'MARKETING' | 'UTILITY';
  revision: number;
  language: string;
  status: 'APPROVED' | 'PAUSED' | 'REJECTED';
  bodyTemplate: string;
  variableKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

const TemplateCatalogSchema = new Schema<ITemplateCatalog>(
  {
    id: { type: String, required: true },
    tenantId: { type: String, default: null, index: true },
    name: { type: String, required: true },
    category: { type: String, required: true, enum: ['MARKETING', 'UTILITY'] },
    revision: { type: Number, required: true, default: 1 },
    language: { type: String, required: true, default: 'en' },
    status: { type: String, required: true, enum: ['APPROVED', 'PAUSED', 'REJECTED'], default: 'APPROVED' },
    bodyTemplate: { type: String, required: true },
    variableKeys: { type: [String], default: [] }
  },
  {
    timestamps: true,
    collection: 'templateCatalogs'
  }
);

TemplateCatalogSchema.index({ tenantId: 1, id: 1 }, { unique: true });

export const TemplateCatalogModel = mongoose.model<ITemplateCatalog>(
  'TemplateCatalog',
  TemplateCatalogSchema
);
