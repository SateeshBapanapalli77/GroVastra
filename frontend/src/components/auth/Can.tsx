'use client';

import React from 'react';
import { UserRole } from '../../lib/auth';
import { canManageCampaigns, canManageSettings, canResolveHolds, canViewActivity, canViewReports } from '../../lib/roles';

export type PermissionAction =
  | 'manageCampaigns'
  | 'manageSettings'
  | 'resolveHolds'
  | 'viewReports'
  | 'viewActivity';

interface CanProps {
  role?: UserRole | null;
  do?: PermissionAction;
  roles?: UserRole[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function hasPermission(
  role: UserRole | null | undefined,
  action?: PermissionAction,
  allowedRoles?: UserRole[]
): boolean {
  if (!role) return false;

  if (allowedRoles && allowedRoles.length > 0) {
    return allowedRoles.includes(role);
  }

  if (action) {
    switch (action) {
      case 'manageCampaigns':
        return canManageCampaigns(role);
      case 'manageSettings':
        return canManageSettings(role);
      case 'resolveHolds':
        return canResolveHolds(role);
      case 'viewReports':
        return canViewReports(role);
      case 'viewActivity':
        return canViewActivity(role);
    }
  }

  return true;
}

/**
 * Declarative component for role gating in GroVastra UI (Phase 0, Item 7)
 */
export function Can({ role, do: action, roles, fallback = null, children }: CanProps) {
  const allowed = hasPermission(role, action, roles);

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
