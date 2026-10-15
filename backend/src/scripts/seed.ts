import { connectDatabase, disconnectDatabase } from '../config/database';
import { CustomerModel } from '../modules/crm/models/Customer.model';
import { ProductModel } from '../modules/inventory/models/Product.model';
import { env } from '../config/env';
import { logger } from '../config/logger';

async function seed() {
  logger.info('Starting GroVastra database seed...');
  await connectDatabase();

  const tenantId = env.DEFAULT_TENANT_ID;

  // 1. Seed CRM Customers
  await CustomerModel.deleteMany({ tenantId });

  const customers = [
    {
      id: 'cus_lakshmi_01',
      tenantId,
      firstName: 'Lakshmi',
      lastName: 'Devi',
      phone: '+919876543210',
      email: 'lakshmi@example.com',
      birthdayMonth: 10, // Upcoming birthday in October
      birthdayDay: 28,
      anniversaryMonth: 12,
      anniversaryDay: 15,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false,
      preferences: {
        weave: ['kanjeevaram', 'silk'],
        budgetMaxPaise: 4500000,
        preferredLanguage: 'en'
      },
      tags: ['vip', 'bridal', 'occasionwear']
    },
    {
      id: 'cus_ananya_02',
      tenantId,
      firstName: 'Ananya',
      lastName: 'Rao',
      phone: '+919876543211',
      email: 'ananya@example.com',
      birthdayMonth: 10,
      birthdayDay: 21, // Exactly D-7 window from mid October!
      anniversaryMonth: 5,
      anniversaryDay: 10,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false,
      preferences: {
        weave: ['banarasi', 'chanderi'],
        budgetMaxPaise: 3500000,
        preferredLanguage: 'en'
      },
      tags: ['occasionwear']
    },
    {
      id: 'cus_meera_03',
      tenantId,
      firstName: 'Meera',
      lastName: 'Sundaram',
      phone: '+919876543212',
      email: 'meera@example.com',
      birthdayMonth: 11,
      birthdayDay: 5,
      anniversaryMonth: 10,
      anniversaryDay: 25,
      status: 'ACTIVE',
      optedInMarketing: true,
      channelSuppressed: false,
      preferences: {
        weave: ['silk', 'tussar'],
        budgetMaxPaise: 2500000,
        preferredLanguage: 'en'
      },
      tags: ['repeat_client']
    },
    {
      id: 'cus_pooja_04',
      tenantId,
      firstName: 'Pooja',
      lastName: 'Sharma',
      phone: '+919876543213',
      email: 'pooja@example.com',
      birthdayMonth: 10,
      birthdayDay: 28,
      status: 'ACTIVE',
      optedInMarketing: false, // Opted out - test suppression!
      channelSuppressed: false,
      preferences: {
        weave: ['kanjeevaram'],
        preferredLanguage: 'en'
      },
      tags: ['opted_out_test']
    }
  ];

  await CustomerModel.insertMany(customers);
  logger.info({ count: customers.length }, 'Seeded CRM customers');

  // 2. Seed Products
  await ProductModel.deleteMany({ tenantId });

  const products = [
    {
      id: 'prd_kanjee_pure_red',
      tenantId,
      sku: 'KJ-RED-001',
      title: 'Kanjeevaram Pure Crimson Gold Zari Silk Saree',
      weave: 'Kanjeevaram',
      color: 'Crimson Red',
      pricePaise: 3850000, // ₹38,500
      stockCount: 3,
      isSellable: true
    },
    {
      id: 'prd_banarasi_royal_blue',
      tenantId,
      sku: 'BN-BLU-002',
      title: 'Banarasi Katan Silk Royal Blue Floral Jaal Saree',
      weave: 'Banarasi',
      color: 'Royal Blue',
      pricePaise: 2900000, // ₹29,000
      stockCount: 2,
      isSellable: true
    },
    {
      id: 'prd_chanderi_emerald',
      tenantId,
      sku: 'CH-EMR-003',
      title: 'Chanderi Handspun Emerald Green Tissue Saree',
      weave: 'Chanderi',
      color: 'Emerald Green',
      pricePaise: 1800000, // ₹18,000
      stockCount: 4,
      isSellable: true
    }
  ];

  await ProductModel.insertMany(products);
  logger.info({ count: products.length }, 'Seeded Inventory products');

  // 3. Seed Boutique Staff Credentials
  const { UserModel, hashPassword } = await import('../modules/auth/models/User.model');
  await UserModel.deleteMany({ tenantId });

  const users = [
    {
      id: 'usr_owner_01',
      tenantId,
      username: 'owner@padmavati.com',
      passwordHash: hashPassword('HeritageOwner2026!'),
      name: 'Padmavati Sundar',
      role: 'BOUTIQUE_OWNER' as const,
      shopName: 'Padmavati Handlooms'
    },
    {
      id: 'usr_staff_01',
      tenantId,
      username: 'staff@padmavati.com',
      passwordHash: hashPassword('HeritageStaff2026!'),
      name: 'Anjali Sharma',
      role: 'STAFF' as const,
      shopName: 'Padmavati Handlooms'
    }
  ];

  await UserModel.insertMany(users);
  logger.info({ count: users.length }, 'Seeded Boutique Owner and Staff credentials');

  logger.info('Database seed complete!');
  await disconnectDatabase();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed script failed');
  process.exit(1);
});
