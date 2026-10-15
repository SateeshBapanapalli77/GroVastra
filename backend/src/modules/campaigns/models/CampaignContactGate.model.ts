import mongoose, { Document, Schema } from 'mongoose';

export interface IContactReservation {
  executionId: string;
  campaignId: string;
  priority: number;
  reservedAt: Date;
  expiresAt: Date;
  status: 'RESERVED' | 'ACCEPTED' | 'UNKNOWN' | 'RELEASED' | 'DISPLACED';
}

export interface ICampaignContactGate extends Document {
  id: string;
  tenantId: string;
  destinationHash: string; // SHA-256 of canonical phone number (e.g. +919876543210)
  version: number; // Mutex optimistic lock counter
  history: IContactReservation[];
  createdAt: Date;
  updatedAt: Date;
}

const ContactReservationSchema = new Schema<IContactReservation>(
  {
    executionId: { type: String, required: true },
    campaignId: { type: String, required: true },
    priority: { type: Number, required: true, default: 50 },
    reservedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['RESERVED', 'ACCEPTED', 'UNKNOWN', 'RELEASED', 'DISPLACED'],
      default: 'RESERVED'
    }
  },
  { _id: false }
);

const CampaignContactGateSchema = new Schema<ICampaignContactGate>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true },
    destinationHash: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    history: { type: [ContactReservationSchema], default: [] }
  },
  {
    timestamps: true,
    collection: 'campaignContactGates'
  }
);

// Compound Unique Index: Page 25 specification
CampaignContactGateSchema.index(
  { tenantId: 1, destinationHash: 1 },
  { unique: true }
);

export const CampaignContactGateModel = mongoose.model<ICampaignContactGate>(
  'CampaignContactGate',
  CampaignContactGateSchema
);
