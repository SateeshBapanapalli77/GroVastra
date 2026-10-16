import { env } from '../config/env';
import { signInternalServiceToken, InternalServicePayload } from '../shared/middleware/internalAuth.middleware';

/**
 * Creates a scoped SYSTEM service token for upstream systems
 * (e.g., Shopify webhooks, external CRM connectors, POS sync).
 */
export function mintServiceToken(payload: InternalServicePayload): string {
  if (!payload.tenantId || typeof payload.tenantId !== 'string') {
    throw new Error('Valid tenantId is required to mint service token');
  }
  if (!payload.producer || typeof payload.producer !== 'string') {
    throw new Error('Valid producer is required to mint service token');
  }
  if (!payload.eventFamily || typeof payload.eventFamily !== 'string') {
    throw new Error('Valid eventFamily is required to mint service token');
  }

  return signInternalServiceToken(payload);
}

// CLI invocation handling
if (process.argv[1]?.includes('mintServiceToken')) {
  const tenantId = process.argv[2] || env.DEFAULT_TENANT_ID;
  const producer = process.argv[3] || 'upstream_service';
  const eventFamily = process.argv[4] || '*';

  try {
    const token = mintServiceToken({ tenantId, producer, eventFamily });
    console.log(token);
  } catch (err: any) {
    console.error(`Failed to mint service token: ${err.message}`);
    process.exit(1);
  }
}
