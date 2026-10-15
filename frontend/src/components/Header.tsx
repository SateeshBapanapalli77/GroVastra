'use client';

import React from 'react';
import { HelpCircle, ChevronRight, CheckCircle2, ShieldCheck, User } from 'lucide-react';

interface HeaderProps {
  breadcrumbs: string[];
}

export const Header: React.FC<HeaderProps> = ({ breadcrumbs }) => {
  return (
    <header className="h-16 border-b border-[#EAE4DC] bg-[#FAF8F5]/80 backdrop-blur-xs px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-[#6B5E59]">
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span
              className={
                idx === breadcrumbs.length - 1
                  ? 'font-semibold text-[#271E1B]'
                  : 'hover:text-[#5C1D24] cursor-pointer'
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
        {/* Status Pills */}
        <div className="hidden lg:flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FFFFFF] border border-[#EAE4DC] rounded-full text-[11px] font-medium text-[#271E1B] shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>WhatsApp connected: <strong className="text-emerald-700">Ready</strong></span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FEF9EE] border border-[#F3E0B5] rounded-full text-[11px] font-medium text-[#8F6910] shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-[#C99726]" />
            <span>Approved templates: <strong>4 available</strong></span>
          </div>
        </div>

        <div className="h-4 w-px bg-[#EAE4DC] hidden lg:block" />

        {/* Support note */}
        <div className="text-[10px] text-[#988B86] hidden xl:block text-right">
          Managed by GroVastra Integration Support for
          <span className="block font-semibold text-[#6B5E59]">Active Boutique Store</span>
        </div>

        {/* Help icon */}
        <button className="text-[#988B86] hover:text-[#5C1D24] p-1.5 rounded-lg hover:bg-[#F3EFE8] transition-colors">
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-[#EAE4DC]">
          <div className="w-8 h-8 rounded-full bg-[#5C1D24] text-white flex items-center justify-center font-medium text-xs shadow-xs border border-[#F3E0B5]">
            LD
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-xs font-semibold text-[#271E1B]">Lakshmi Devi</div>
            <div className="text-[10px] text-[#988B86]">Owner</div>
          </div>
        </div>
      </div>
    </header>
  );
};
