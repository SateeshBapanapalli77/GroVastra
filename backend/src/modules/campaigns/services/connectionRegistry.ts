import { TenantConnectionModel } from '../models/TenantConnection.model';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

/**
 * Resolves the tenant identity mapped to a specific WhatsApp connection ID or Meta phone number ID.
 * Multi-tenant isolation: ensures inbound customer messages only query customers belonging to the
 * tenant owning the connection.
 */
export async function resolveTenantForConnection(connectionIdOrPhoneId: string): Promise<string | null> {
  if (!connectionIdOrPhoneId) return null;

  // Search by primary connectionId or phone number ID in metadata (Meta Cloud API standard)
  const conn = await TenantConnectionModel.findOne({
    $or: [
      { connectionId: connectionIdOrPhoneId },
      { 'metadata.phoneNumberId': connectionIdOrPhoneId },
      { 'metadata.phone_number_id': connectionIdOrPhoneId }
    ],
    status: 'ACTIVE'
  });
  if (conn) {
    return conn.tenantId;
  }

  // Match against configured environment connection ID or phone number ID if provisioned
  if (
    ((env.WHATSAPP_CONNECTION_ID && connectionIdOrPhoneId === env.WHATSAPP_CONNECTION_ID) ||
     (env.WHATSAPP_PHONE_NUMBER_ID && connectionIdOrPhoneId === env.WHATSAPP_PHONE_NUMBER_ID)) &&
    env.DEFAULT_TENANT_ID
  ) {
    return env.DEFAULT_TENANT_ID;
  }

  logger.warn({ connectionId: connectionIdOrPhoneId }, 'No active tenant connection found for provider connection ID / phone number ID (fail closed)');
  return null;
}
