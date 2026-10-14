import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  id: string;
  tenantId: string;
  sku: string;
  title: string;
  weave: string; // e.g. 'Kanjeevaram', 'Banarasi', 'Chanderi'
  color: string;
  pricePaise: number;
  stockCount: number;
  isSellable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    sku: { type: String, required: true },
    title: { type: String, required: true },
    weave: { type: String, required: true },
    color: { type: String, required: true },
    pricePaise: { type: Number, required: true },
    stockCount: { type: Number, required: true, default: 1 },
    isSellable: { type: Boolean, required: true, default: true }
  },
  {
    timestamps: true,
    collection: 'inventoryProducts'
  }
);

ProductSchema.index({ tenantId: 1, sku: 1 }, { unique: true });

export const ProductModel = mongoose.model<IProduct>('Product', ProductSchema);
