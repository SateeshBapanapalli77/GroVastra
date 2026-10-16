import { TenantSettingsModel } from '../models/TenantSettings.model';
import { TenantConnectionModel } from '../models/TenantConnection.model';

/**
 * Resolves the display name of the boutique shop in authoritative priority order (Step 4):
 * 1. version.brandName
 * 2. tenant settings storeName
 * 3. connection metadata (metadata.storeName or metadata.wabaAccountName)
 * 4. otherwise null
 */
export async function resolveShopDisplayName(
  tenantId: string,
  version?: any
): Promise<string | null> {
  // 1. version.brandName
  if (version && typeof version.brandName === 'string' && version.brandName.trim().length > 0) {
    return version.brandName.trim();
  }

  // 2. tenant settings storeName
  try {
    const tSettings = await TenantSettingsModel.findOne({ tenantId }).lean();
    if (tSettings && typeof (tSettings as any).storeName === 'string' && (tSettings as any).storeName.trim().length > 0) {
      return (tSettings as any).storeName.trim();
    }
  } catch (err) {
    // continue to connection metadata
  }

  // 3. connection metadata
  try {
    const tConn = await TenantConnectionModel.findOne({ tenantId, status: 'ACTIVE' }).lean();
    const meta = tConn?.metadata || {};
    const metaName = meta.storeName || meta.wabaAccountName || meta.businessName || meta.displayName || meta.name;
    if (metaName && typeof metaName === 'string' && metaName.trim().length > 0) {
      return metaName.trim();
    }
  } catch (err) {
    // continue
  }

  // 4. otherwise return null
  return null;
}
