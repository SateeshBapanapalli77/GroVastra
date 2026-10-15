import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomer extends Document {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone: string; // Plain during seed/CRM input; encrypted when written to delivery intent
  email?: string;
  birthdayMonth?: number; // 1-12
  birthdayDay?: number;   // 1-31
  anniversaryMonth?: number;
  anniversaryDay?: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DELETED';
  optedInMarketing: boolean;
  channelSuppressed: boolean;
  preferences: {
    weave: string[]; // e.g. ['silk', 'kanjeevaram', 'banarasi', 'chanderi']
    budgetMaxPaise?: number; // e.g. 5000000 = ₹50,000
    preferredLanguage: string;
  };
  tags: string[]; // e.g. ['vip', 'occasionwear', 'bridal']
  totalSpendPaise?: number;
  savedOccasions?: Array<{
    eventId: string;
    type: 'ANNIVERSARY' | 'WEDDING';
    date: string; // 'YYYY-MM-DD'
    active: boolean;
    leadTimeDays?: number;
    recipientLabel?: string;
    budgetPaise?: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, required: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    birthdayMonth: { type: Number, min: 1, max: 12 },
    birthdayDay: { type: Number, min: 1, max: 31 },
    anniversaryMonth: { type: Number, min: 1, max: 12 },
    anniversaryDay: { type: Number, min: 1, max: 31 },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE', 'DELETED'], default: 'ACTIVE' },
    optedInMarketing: { type: Boolean, required: true, default: true },
    channelSuppressed: { type: Boolean, required: true, default: false },
    preferences: {
      weave: { type: [String], default: [] },
      budgetMaxPaise: { type: Number },
      preferredLanguage: { type: String, default: 'en' }
    },
    tags: { type: [String], default: [] },
    totalSpendPaise: { type: Number, default: 0 },
    savedOccasions: {
      type: [
        {
          eventId: { type: String, required: true },
          type: { type: String, required: true, enum: ['ANNIVERSARY', 'WEDDING'] },
          date: { type: String, required: true },
          active: { type: Boolean, required: true, default: true },
          leadTimeDays: { type: Number },
          recipientLabel: { type: String },
          budgetPaise: { type: Number }
        }
      ],
      default: []
    }
  },
  {
    timestamps: true,
    collection: 'crmCustomers'
  }
);

CustomerSchema.index({ tenantId: 1, phone: 1 });
CustomerSchema.index({ tenantId: 1, birthdayMonth: 1, birthdayDay: 1 });
CustomerSchema.index({ tenantId: 1, anniversaryMonth: 1, anniversaryDay: 1 });

export const CustomerModel = mongoose.model<ICustomer>('Customer', CustomerSchema);
