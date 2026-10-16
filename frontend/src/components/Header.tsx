'use client';

import React from 'react';
import { ChevronRight, ShieldCheck, LogOut, Radio } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/api';
import { UserProfile } from '../lib/auth';
import { getRoleBadgeLabel } from '../lib/roles';

interface HeaderProps {
  breadcrumbs: string[];
  user?: UserProfile | null;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ breadcrumbs, user, onLogout }) => {
  const { data: readinessData } = useQuery({
    queryKey: queryKeys.readiness.all,
    queryFn: () => api.getIntegrationReadiness(),
    staleTime: 60 * 1000
  });

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.username?.slice(0, 2).toUpperCase() || 'BO';

  const approvedTemplatesCount = readinessData?.templates?.filter((t) => t.status === 'APPROVED').length ?? 0;
  const isConnectionActive = readinessData?.connection?.status === 'ACTIVE';

  return (
    <header className="h-16 border-b border-[#EAE4DC] bg-[#FAF8F5]/90 backdrop-blur-xs px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-[#6B5E59]">
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span
              className={
                idx === breadcrumbs.length - 1
                  ? 'font-semibold text-[#271E1B]'
                  : 'hover:text-[#5C1D24]'
              }
            >
              {crumb}
            </span>
            {idx < breadcrumbs.length - 1 && (
              <ChevronRight className="w-3.5 h-3.5 text-[#988B86]" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        {/* Dynamic Status Badges from API */}
        {readinessData && (
          <div className="hidden lg:flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FFFFFF] border border-[#EAE4DC] rounded-full text-[11px] font-medium text-[#271E1B] shadow-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnectionActive ? 'bg-[#1B7A43]' : 'bg-[#C99726]'
                }`}
              />
              <span>
                WhatsApp Channel:{' '}
                <strong className={isConnectionActive ? 'text-[#1B7A43]' : 'text-[#8F6910]'}>
                  {readinessData.connection.status}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FEF9EE] border border-[#F3E0B5] rounded-full text-[11px] font-medium text-[#8F6910] shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-[#C99726]" />
              <span>
                Approved templates: <strong>{approvedTemplatesCount} available</strong>
              </span>
            </div>
          </div>
        )}

        <div className="h-4 w-px bg-[#EAE4DC] hidden lg:block" />

        {/* Tenant context */}
        <div className="text-[10px] text-[#988B86] hidden xl:block text-right">
          Boutique Store
          <span className="block font-semibold text-[#5C1D24]">
            {user?.shopName || 'Heritage Boutique'}
          </span>
        </div>

        {/* User Profile & Role */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-[#EAE4DC]">
          <div className="w-8 h-8 rounded-full bg-[#5C1D24] text-[#F3E0B5] flex items-center justify-center font-medium text-xs shadow-xs border border-[#F3E0B5]">
            {initials}
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-xs font-semibold text-[#271E1B]">
              {user?.name || user?.username || 'Boutique Staff'}
            </div>
            <div className="text-[10px] text-[#C99726] font-medium uppercase tracking-wider">
              {getRoleBadgeLabel(user?.role)}
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              className="ml-1 p-1.5 text-[#988B86] hover:text-[#5C1D24] rounded-lg hover:bg-[#F3EFE8] transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
