import dotenv from 'dotenv';
import crypto from 'crypto';
import { z } from 'zod';

dotenv.config();

const PLACEHOLDER_PATTERNS = [/grovastra_/i, /changeme/i, /example/i, /secret_key/i];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/grovastra?replicaSet=rs0'),
    ENCRYPTION_KEY: z.string().min(32).optional(),
    JWT_SECRET: z.string().min(32).optional(),
    INTERNAL_API_KEY: z.string().min(24).optional(),
    DEFAULT_TENANT_ID: z.string().default('shop_demo'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WHATSAPP_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
    WHATSAPP_CONNECTION_ID: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().min(16).optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
    ALLOW_INSECURE_DEV_AUTH: z.enum(['true', 'false']).default('false')
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'production') return;
    const required: Array<keyof typeof data> = [
      'ENCRYPTION_KEY', 'JWT_SECRET', 'INTERNAL_API_KEY',
      'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
    ];
    for (const key of required) {
      const value = data[key] as string | undefined;
      if (!value) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is mandatory in production` });
      } else if (PLACEHOLDER_PATTERNS.some((p) => p.test(value))) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} looks like a placeholder value` });
      }
    }
    if (data.ALLOW_INSECURE_DEV_AUTH === 'true') {
      ctx.addIssue({ code: 'custom', path: ['ALLOW_INSECURE_DEV_AUTH'],
        message: 'ALLOW_INSECURE_DEV_AUTH must be false in production' });
    }
    if (data.DEFAULT_TENANT_ID === 'shop_demo') {
      ctx.addIssue({ code: 'custom', path: ['DEFAULT_TENANT_ID'],
        message: 'DEFAULT_TENANT_ID must be set explicitly to a verified boutique tenant ID in production (no shop_demo)' });
    }
    if (data.WHATSAPP_MODE !== 'mock' && !data.WHATSAPP_CONNECTION_ID) {
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_CONNECTION_ID'],
        message: 'WHATSAPP_CONNECTION_ID (provided by the integration developer) is required' });
    }
  });

const parsed = envSchema.parse(process.env);
const devRandom = (bytes: number) => crypto.randomBytes(bytes).toString('hex');

export const env = {
  ...parsed,
  ENCRYPTION_KEY: parsed.ENCRYPTION_KEY ?? devRandom(16),
  JWT_SECRET: parsed.JWT_SECRET ?? devRandom(32),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: parsed.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? devRandom(16),
  WHATSAPP_CONNECTION_ID: parsed.WHATSAPP_CONNECTION_ID ?? 'conn_dev_sandbox'
};
