import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/grovastra?replicaSet=rs0'),
  ENCRYPTION_KEY: z.string().min(32).default('grovastra_32_byte_secret_key_prod_01'), // 32-char key for AES-256
  DEFAULT_TENANT_ID: z.string().default('shop_padmavati_handlooms'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WHATSAPP_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().default('grovastra_meta_app_secret_test_key_2026'),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default('grovastra_verify_token_2026'),
  INTERNAL_API_KEY: z.string().default('grovastra_internal_secret_key_2026')
});

export const env = envSchema.parse(process.env);
