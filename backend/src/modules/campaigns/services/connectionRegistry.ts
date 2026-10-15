import { TenantConnectionModel } from '../models/TenantConnection.model';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

/**
 * Resolves the tenant identity mapped to a specific WhatsApp connection ID or Meta phone number ID.
 * Multi-tenant isolation: ensures inbound customer messages only query customers belonging to the
 * tenant owning the connection.
 */
export async function resolveTenantForConnection(connectionId: string): Promise<string | null> {
  if (!connectionId) return null;

  const conn = await TenantConnectionModel.findOne({ connectionId, status: 'ACTIVE' });
  if (conn) {
    return conn.tenantId;
  }

  // Match against configured environment connection ID if provisioned
  if (env.WHATSAPP_CONNECTION_ID && connectionId === env.WHATSAPP_CONNECTION_ID && env.DEFAULT_TENANT_ID) {
    return env.DEFAULT_TENANT_ID;
  }

  logger.warn({ connectionId }, 'No active tenant connection found for provider connection ID (fail closed)');
  return null;
}
