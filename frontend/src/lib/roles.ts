import { UserRole } from './auth';

/**
 * Role Permission Gates for GroVastra Auto Campaigns (Phase 0, Non-negotiable 6)
 * STAFF can view activity and resolve holds only;
 * BOUTIQUE_OWNER and STORE_MANAGER manage campaigns and settings.
 */

export function canManageCampaigns(role?: UserRole | null): boolean {
  return role === 'BOUTIQUE_OWNER' || role === 'STORE_MANAGER';
}

export function canManageSettings(role?: UserRole | null): boolean {
  return role === 'BOUTIQUE_OWNER' || role === 'STORE_MANAGER';
}

export function canResolveHolds(role?: UserRole | null): boolean {
  return role === 'BOUTIQUE_OWNER' || role === 'STORE_MANAGER' || role === 'STAFF';
}

export function canViewActivity(role?: UserRole | null): boolean {
  return Boolean(role);
}

export function canViewReports(role?: UserRole | null): boolean {
  return Boolean(role);
}

export function getRoleBadgeLabel(role?: UserRole | null): string {
  switch (role) {
    case 'BOUTIQUE_OWNER':
      return 'Boutique Owner';
    case 'STORE_MANAGER':
      return 'Store Manager';
    case 'STAFF':
      return 'Store Staff';
    case 'SYSTEM':
      return 'System Automation';
    default:
      return 'Guest';
  }
}

export function getRoleDescription(role?: UserRole | null): string {
  switch (role) {
    case 'BOUTIQUE_OWNER':
      return 'Full access to campaign authoring, lifecycle management, and boutique configuration.';
    case 'STORE_MANAGER':
      return 'Full access to campaign authoring, publishing revisions, and boutique configuration.';
    case 'STAFF':
      return 'Access restricted to customer activity monitoring and resolving sales communication holds.';
    default:
      return 'Read-only access.';
  }
}
