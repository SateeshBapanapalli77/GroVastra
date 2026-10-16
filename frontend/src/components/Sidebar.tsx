'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sparkles,
  Activity,
  Users,
  Settings,
  BarChart3,
  ChevronDown,
  ShieldAlert
} from 'lucide-react';
import { UserProfile } from '../lib/auth';
import { getRoleBadgeLabel, canManageSettings, canManageCampaigns } from '../lib/roles';

interface SidebarProps {
  user?: UserProfile | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ user }) => {
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Overview',
      href: '/campaigns',
      icon: Sparkles,
      active: pathname.startsWith('/campaigns')
    },
    {
      name: 'Activity',
      href: '/activity',
      icon: Activity,
      active: pathname.startsWith('/activity')
    },
    {
      name: 'Customers',
      href: '/customers',
      icon: Users,
      active: pathname.startsWith('/customers')
    },
    {
      name: 'Reports',
      href: '/reports',
      icon: BarChart3,
      active: pathname.startsWith('/reports')
    },
    {
      name: 'Settings',
      href: '/settings',
      icon: Settings,
      active: pathname.startsWith('/settings'),
      restricted: !canManageSettings(user?.role)
    }
  ];

  return (
    <aside className="w-64 border-r border-[#EAE4DC] bg-[#FAF8F5] flex flex-col justify-between shrink-0 select-none min-h-screen">
      <div>
        {/* Brand Header */}
        <div className="p-4 border-b border-[#EAE4DC] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#5C1D24] text-[#F3E0B5] flex items-center justify-center font-serif text-lg font-bold shadow-xs">
            G
          </div>
          <div>
            <div className="font-serif font-bold text-base tracking-wide text-[#431217]">
              GroVastra
            </div>
            <div className="text-[10px] tracking-widest text-[#C99726] font-semibold uppercase">
              Handloom Auto Campaigns
            </div>
          </div>
        </div>

        {/* Store Context Box */}
        <div className="p-3 mx-3 my-3 bg-[#FFFFFF] border border-[#EAE4DC] rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-2 h-2 rounded-full bg-[#1B7A43] shrink-0" />
            <div className="truncate">
              <div className="text-xs font-semibold text-[#271E1B] truncate">
                {user?.shopName || 'Boutique Store'}
              </div>
              <div className="text-[10px] text-[#8F6910] font-medium truncate">
                {getRoleBadgeLabel(user?.role)}
              </div>
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-[#988B86] shrink-0" />
        </div>

        {/* Navigation Section */}
        <div className="px-3 py-2 space-y-1">
          <div className="px-3 text-[10px] font-bold tracking-wider text-[#988B86] uppercase mb-2">
            Auto Campaigns
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  item.active
                    ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                    : 'text-[#271E1B] hover:bg-[#F3EFE8]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </div>
                {item.restricted && (
                  <span
                    title="Owner/Manager configuration only"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]"
                  >
                    View
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Staff Role Notice if Staff */}
      {user?.role === 'STAFF' && (
        <div className="p-3 m-3 border border-[#F3E0B5] bg-[#FEF9EE] rounded-xl text-[11px] text-[#8F6910] shadow-xs">
          <div className="flex items-center gap-1.5 font-semibold text-[#5C1D24] mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-[#C99726]" />
            <span>Staff Access</span>
          </div>
          <p className="text-[10px] leading-relaxed">
            Authorized for monitoring activity and resolving customer conversation holds.
          </p>
        </div>
      )}
    </aside>
  );
};
