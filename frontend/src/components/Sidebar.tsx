'use client';

import React from 'react';
import {
  Calendar,
  Sparkles,
  FileText,
  Users,
  Settings,
  ChevronDown,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Activity
} from 'lucide-react';

interface SidebarProps {
  currentTab: 'campaigns' | 'activity' | 'templates' | 'customers' | 'settings';
  onSelectTab: (tab: 'campaigns' | 'activity' | 'templates' | 'customers' | 'settings') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
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
              Handloom Boutique OS
            </div>
          </div>
        </div>

        {/* Store Selector */}
        <div className="p-3 mx-3 my-3 bg-[#FFFFFF] border border-[#EAE4DC] rounded-xl shadow-xs flex items-center justify-between cursor-pointer hover:border-[#D4AF37] transition-colors">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <div className="truncate">
              <div className="text-xs font-semibold text-[#271E1B] truncate">
                GroVastra Boutique
              </div>
              <div className="text-[10px] text-[#6B5E59] truncate">
                Flagship Store • Hyderabad
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

          <button
            onClick={() => onSelectTab('campaigns')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'campaigns'
                ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                : 'text-[#271E1B] hover:bg-[#F3EFE8]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4" />
              <span>Campaigns</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                currentTab === 'campaigns'
                  ? 'bg-[#431217] text-[#F3E0B5]'
                  : 'bg-[#EAE4DC] text-[#6B5E59]'
              }`}
            >
              WA
            </span>
          </button>

          <button
            onClick={() => onSelectTab('activity')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'activity'
                ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                : 'text-[#271E1B] hover:bg-[#F3EFE8]'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Activity Stream</span>
          </button>

          <button
            onClick={() => onSelectTab('templates')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'templates'
                ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                : 'text-[#271E1B] hover:bg-[#F3EFE8]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Approved Templates</span>
          </button>

          <button
            onClick={() => onSelectTab('customers')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'customers'
                ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                : 'text-[#271E1B] hover:bg-[#F3EFE8]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Patrons &amp; CRM</span>
          </button>

          <button
            onClick={() => onSelectTab('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'settings'
                ? 'bg-[#5C1D24] text-white shadow-xs font-semibold'
                : 'text-[#271E1B] hover:bg-[#F3EFE8]'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Campaign Settings</span>
          </button>
        </div>
      </div>

      {/* WhatsApp Adapter Status Card */}
      <div className="p-3 m-3 border border-[#EAE4DC] bg-[#FFFFFF] rounded-xl text-[11px] shadow-xs">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[#6B5E59] font-medium">Channel Delivery</span>
          <span className="inline-flex items-center gap-1 bg-[#E8F8EE] text-[#1B7A43] font-semibold px-2 py-0.5 rounded-full text-[10px]">
            <CheckCircle2 className="w-3 h-3 text-[#25D366]" /> Connected
          </span>
        </div>
        <div className="text-[10px] text-[#988B86] pt-1.5 border-t border-[#F3EFE8] flex items-center justify-between">
          <span>Mode</span>
          <span className="text-[#C99726] font-semibold">Mock Adapter (Dev)</span>
        </div>
      </div>
    </aside>
  );
};
