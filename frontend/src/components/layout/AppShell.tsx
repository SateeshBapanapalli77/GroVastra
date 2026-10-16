'use client';

import React from 'react';
import { useAuth } from '../../lib/useAuth';
import { Sidebar } from '../Sidebar';
import { Header } from '../Header';
import { IntegrationReadinessBanner } from './IntegrationReadinessBanner';

interface AppShellProps {
  breadcrumbs: string[];
  children: React.ReactNode;
}

export function AppShell({ breadcrumbs, children }: AppShellProps) {
  const { user, isLoading, logout } = useAuth({ requireAuth: true, redirectTo: '/login' });

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen bg-[#FAF8F5] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5C1D24] text-[#F3E0B5] flex items-center justify-center font-serif text-xl font-bold animate-pulse shadow-sm">
            G
          </div>
          <p className="text-xs font-serif text-[#6B5E59] tracking-wider">
            Loading GroVastra Boutique...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#FAF8F5]">
      {/* Sidebar */}
      <Sidebar user={user} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <IntegrationReadinessBanner />
        <Header breadcrumbs={breadcrumbs} user={user} onLogout={logout} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
