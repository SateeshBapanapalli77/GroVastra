'use client';

import React from 'react';
import { Settings, Shield, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const SettingsView: React.FC = () => {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="border-b border-[#EAE4DC] pb-5">
        <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
          Store Safeguards
        </div>
        <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
          Campaign Global Policies &amp; Caps
        </h1>
        <p className="text-xs text-[#6B5E59] mt-0.5">
          Tenant-level restrictions enforced across all active campaigns to guarantee compliance with Meta policies
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-[#271E1B]">
        {/* Card 1: Quiet Hours */}
        <div className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#C99726]" />
            <span className="font-bold text-sm text-[#431217]">Respectful Sending Hours</span>
          </div>
          <p className="text-[#6B5E59] text-[11px] leading-relaxed">
            All marketing campaigns are restricted to daytime delivery. Nighttime and early morning sends are rejected by policy.
          </p>
          <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between">
            <span className="text-[#6B5E59]">Configured Window:</span>
            <span className="font-bold text-[#5C1D24]">10:00 AM – 7:00 PM (Asia/Kolkata)</span>
          </div>
        </div>

        {/* Card 2: Contact Caps */}
        <div className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#5C1D24]" />
            <span className="font-bold text-sm text-[#431217]">Anti-Spam Frequency Caps</span>
          </div>
          <p className="text-[#6B5E59] text-[11px] leading-relaxed">
            Prevents overwhelming patrons across multiple competing campaigns (Birthday + Anniversary + Restock).
          </p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC]">
              <div className="font-bold text-base text-[#5C1D24]">1 / 24h</div>
              <div className="text-[10px] text-[#6B5E59]">Max 1 msg per rolling 24h</div>
            </div>
            <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC]">
              <div className="font-bold text-base text-[#5C1D24]">3 / 7d</div>
              <div className="text-[10px] text-[#6B5E59]">Max 3 msgs per rolling 7d</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
