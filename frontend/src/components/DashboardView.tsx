'use client';

import React, { useState } from 'react';
import {
  Plus,
  Play,
  Pause,
  Clock,
  Users,
  CheckCheck,
  MessageSquare,
  Gift,
  Heart,
  ChevronRight,
  Shield,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Scissors,
  RotateCcw,
  Tag,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface DashboardViewProps {
  onCreateCampaign: () => void;
  onEditCampaign: (campaignId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onCreateCampaign,
  onEditCampaign
}) => {
  const [masterRunning, setMasterRunning] = useState(true);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Top Banner / Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EAE4DC] pb-6">
        <div>
          <div className="text-[11px] font-bold tracking-widest text-[#988B86] uppercase flex items-center gap-2">
            <span>Client Touchpoints</span>
            <span className="w-1 h-1 rounded-full bg-[#988B86]" />
            <span>Meta Business Suite API</span>
          </div>
          <h1 className="font-serif text-3xl font-bold text-[#431217] mt-1">
            Auto Campaigns
          </h1>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Automated high-touch WhatsApp messaging for boutique customers
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Master Automation Toggle */}
          <div className="flex items-center gap-3 bg-[#FFFFFF] px-4 py-2 rounded-xl border border-[#EAE4DC] shadow-xs">
            <div className="text-right">
              <div className="text-xs font-semibold text-[#271E1B]">
                Master Automation
              </div>
              <div className="text-[10px] text-emerald-600 font-medium flex items-center justify-end gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {masterRunning ? 'Running normally' : 'Paused globally'}
              </div>
            </div>
            <button
              onClick={() => setMasterRunning(!masterRunning)}
              className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                masterRunning ? 'bg-[#5C1D24]' : 'bg-[#D6CBC1]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform shadow-xs ${
                  masterRunning ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Create Campaign CTA */}
          <button
            onClick={onCreateCampaign}
            className="flex items-center gap-2 bg-[#5C1D24] hover:bg-[#431217] text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Create campaign</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#EAE4DC] shadow-xs relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="flex items-center justify-between text-[#988B86] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Active Campaigns
            </span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F5] text-[#5C1D24]">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif text-2xl font-bold text-[#431217]">
            2 Running
          </div>
          <div className="text-[11px] text-[#6B5E59] mt-0.5">
            Birthday & Anniversary active
          </div>
          <div className="mt-4 pt-3 border-t border-[#F4EFE8] flex items-center justify-between text-[10px]">
            <span className="px-2 py-0.5 rounded-md bg-[#FEF9EE] text-[#8F6910] font-semibold border border-[#F3E0B5]">
              100% Health
            </span>
            <span className="text-[#988B86]">Scheduled sequences</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#EAE4DC] shadow-xs relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="flex items-center justify-between text-[#988B86] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Enrolled Customers
            </span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F5] text-[#C99726]">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif text-2xl font-bold text-[#271E1B]">
            1,428
          </div>
          <div className="text-[11px] text-[#6B5E59] mt-0.5">
            Patrons eligible this month
          </div>
          <div className="mt-4 pt-3 border-t border-[#F4EFE8] flex items-center justify-between text-[10px]">
            <span className="text-emerald-700 font-semibold">
              +12.4% vs last month
            </span>
            <span className="text-[#988B86]">Auto-synced</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#EAE4DC] shadow-xs relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="flex items-center justify-between text-[#988B86] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Delivered WhatsApps
            </span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F5] text-emerald-600">
              <CheckCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif text-2xl font-bold text-[#271E1B]">
            1,392
          </div>
          <div className="text-[11px] text-[#6B5E59] mt-0.5">
            97.4% delivery success rate
          </div>
          <div className="mt-4 pt-3 border-t border-[#F4EFE8]">
            <div className="w-full h-1.5 bg-[#FAF8F5] rounded-full overflow-hidden">
              <div className="h-full bg-[#5C1D24] rounded-full w-[97%]" />
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#EAE4DC] shadow-xs relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="flex items-center justify-between text-[#988B86] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Customer Replies
            </span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F5] text-[#5C1D24]">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif text-2xl font-bold text-[#271E1B]">
            486
          </div>
          <div className="text-[11px] text-[#6B5E59] mt-0.5">
            High intent boutique enquiries
          </div>
          <div className="mt-4 pt-3 border-t border-[#F4EFE8] flex items-center justify-between text-[10px]">
            <span className="px-2 py-0.5 rounded-md bg-[#FEF9EE] text-[#8F6910] font-semibold border border-[#F3E0B5]">
              34.9% CTR
            </span>
            <span className="text-[#988B86]">Warm conversions</span>
          </div>
        </div>
      </div>

      {/* Live Automations Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-lg font-bold text-[#431217]">
              Live Automations
            </h2>
            <span className="text-xs bg-[#EAE4DC] text-[#6B5E59] px-2 py-0.5 rounded-full font-semibold">
              2 active
            </span>
          </div>
          <div className="text-xs text-[#988B86]">
            Multi-stage drip sequences
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Card 1: Birthday shopping */}
          <div className="bg-[#FFFFFF] p-6 rounded-2xl border border-[#EAE4DC] shadow-xs hover:border-[#C99726] transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FDF5F6] border border-[#F0DADC] text-[#5C1D24] flex items-center justify-center">
                    <Gift className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-[#431217]">
                      Birthday shopping
                    </h3>
                    <p className="text-[11px] text-[#6B5E59]">
                      Annual patron celebration greeting & boutique privilege pass
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F8EE] text-[#1B7A43] text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>

              {/* Execution details */}
              <div className="grid grid-cols-2 gap-4 my-5 p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs">
                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold tracking-wider">
                    Next Execution
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>Tomorrow, 10:00 AM IST</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold tracking-wider">
                    Enrolled Patrons
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#5C1D24]" />
                    <span>842 customers</span>
                  </div>
                </div>
              </div>

              {/* Sequence Workflow Pills */}
              <div>
                <div className="text-[10px] font-bold text-[#988B86] uppercase tracking-wider mb-2">
                  Sequence Workflow (WhatsApp)
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                  <div className="px-3 py-1.5 bg-[#FFFFFF] border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] shadow-2xs flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-1.5 py-0.5 rounded font-bold border border-[#F3E0B5]">
                      D-14
                    </span>
                    <span>Invitation</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-[#988B86] shrink-0" />
                  <div className="px-3 py-1.5 bg-[#FFFFFF] border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] shadow-2xs flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-1.5 py-0.5 rounded font-bold border border-[#F3E0B5]">
                      D-7
                    </span>
                    <span>Follow-up</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-[#988B86] shrink-0" />
                  <div className="px-3 py-1.5 bg-[#FFFFFF] border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] shadow-2xs flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-1.5 py-0.5 rounded font-bold border border-[#F3E0B5]">
                      D0
                    </span>
                    <span>Birthday Greeting</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 pt-4 border-t border-[#F4EFE8] flex items-center justify-between">
              <button
                onClick={() => onEditCampaign('cmp_birthday')}
                className="px-4 py-2 bg-[#5C1D24] hover:bg-[#431217] text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs"
              >
                Edit Sequence
              </button>
              <button className="px-3 py-2 text-[#6B5E59] hover:text-[#5C1D24] text-xs font-semibold hover:bg-[#FAF8F5] rounded-lg transition-colors">
                View Activity Log
              </button>
            </div>
          </div>

          {/* Card 2: Anniversary shopping */}
          <div className="bg-[#FFFFFF] p-6 rounded-2xl border border-[#EAE4DC] shadow-xs hover:border-[#C99726] transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FEF9EE] border border-[#F3E0B5] text-[#C99726] flex items-center justify-center">
                    <Heart className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-[#431217]">
                      Anniversary shopping
                    </h3>
                    <p className="text-[11px] text-[#6B5E59]">
                      Couple milestone invite with heritage silk wardrobe curated lookbook
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F8EE] text-[#1B7A43] text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>

              {/* Execution details */}
              <div className="grid grid-cols-2 gap-4 my-5 p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs">
                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold tracking-wider">
                    Next Execution
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>Today, 10:00 AM IST</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold tracking-wider">
                    Enrolled Patrons
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#5C1D24]" />
                    <span>586 customers</span>
                  </div>
                </div>
              </div>

              {/* Sequence Workflow Pills */}
              <div>
                <div className="text-[10px] font-bold text-[#988B86] uppercase tracking-wider mb-2">
                  Sequence Workflow (WhatsApp)
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                  <div className="px-3 py-1.5 bg-[#FFFFFF] border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] shadow-2xs flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-1.5 py-0.5 rounded font-bold border border-[#F3E0B5]">
                      D-14
                    </span>
                    <span>Invitation</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-[#988B86] shrink-0" />
                  <div className="px-3 py-1.5 bg-[#FFFFFF] border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] shadow-2xs flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-1.5 py-0.5 rounded font-bold border border-[#F3E0B5]">
                      D-7
                    </span>
                    <span>Reminder & Lookbook</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 pt-4 border-t border-[#F4EFE8] flex items-center justify-between">
              <button
                onClick={() => onEditCampaign('cmp_anniversary')}
                className="px-4 py-2 bg-[#5C1D24] hover:bg-[#431217] text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs"
              >
                Edit Sequence
              </button>
              <button className="px-3 py-2 text-[#6B5E59] hover:text-[#5C1D24] text-xs font-semibold hover:bg-[#FAF8F5] rounded-lg transition-colors">
                View Activity Log
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Automation Blueprints */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#431217]">
              Upcoming Automation Blueprints
            </h2>
            <p className="text-xs text-[#6B5E59]">
              Ready-to-deploy handloom retail workflows in rollout pipeline
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#8F6910] bg-[#FEF9EE] px-3 py-1 rounded-full border border-[#F3E0B5] font-medium">
            <Shield className="w-3.5 h-3.5 text-[#C99726]" /> Meta Template Approval Pending
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Blueprint 1 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#C99726]" /> Festival collection
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Deepavali & Sankranti festive launches with VIP early access preview cards.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Seasonal trigger</span>
              <span className="font-semibold text-[#8F6910]">Q3 Rollout</span>
            </div>
          </div>

          {/* Blueprint 2 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#5C1D24]" /> Unresolved enquiry
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Handloom enquiry follow-up after boutique visit or Instagram direct chat.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Intent recovery</span>
              <span className="font-semibold text-[#8F6910]">Q3 Rollout</span>
            </div>
          </div>

          {/* Blueprint 3 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-600" /> Requested item available
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Restock alert specifically tailored for Gadwal & Pochampally zari sarees.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Inventory sync</span>
              <span className="font-semibold text-emerald-700">In QA</span>
            </div>
          </div>

          {/* Blueprint 4 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-[#5C1D24]" /> Win-back
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Re-engagement sequence for inactive past patrons inactive past &gt; 180 days.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Retention drip</span>
              <span className="font-semibold text-[#8F6910]">Template Pending</span>
            </div>
          </div>

          {/* Blueprint 5 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-[#C99726]" /> Fitting reminders
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Blouse stitching measurement checks &amp; saree fall-pico finishing alerts.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Tailoring unit</span>
              <span className="font-semibold text-[#5C1D24]">Next Sprint</span>
            </div>
          </div>

          {/* Blueprint 6 */}
          <div className="p-4 bg-[#FFFFFF] rounded-xl border border-[#EAE4DC] text-xs space-y-2 opacity-90 hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#271E1B] flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" /> Outfit ready
              </span>
              <span className="text-[10px] bg-[#FAF8F5] text-[#988B86] px-2 py-0.5 rounded-full font-medium border border-[#EAE4DC]">
                Coming soon
              </span>
            </div>
            <p className="text-[#6B5E59] text-[11px] leading-relaxed">
              Instant tailoring pickup alert with store location pin and collection receipt.
            </p>
            <div className="pt-2 border-t border-[#F4EFE8] flex items-center justify-between text-[10px] text-[#988B86]">
              <span>Counter dispatch</span>
              <span className="font-semibold text-[#5C1D24]">Next Sprint</span>
            </div>
          </div>
        </div>
      </div>

      {/* Boutique Etiquette Notice Footer */}
      <div className="p-5 bg-[#FFFFFF] rounded-2xl border border-[#EAE4DC] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC] text-[#C99726] shrink-0 mt-0.5">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-[#271E1B]">
                Meta Compliance &amp; Boutique Etiquette Protocol
              </h4>
              <span className="text-[9px] bg-[#E8F8EE] text-[#1B7A43] px-2 py-0.5 rounded font-extrabold uppercase tracking-wide">
                Guaranteed Safe
              </span>
            </div>
            <p className="text-[11px] text-[#6B5E59] mt-1 leading-relaxed max-w-3xl">
              All outbound WhatsApp automations are strictly bound to the <strong>10:00 AM – 7:00 PM IST</strong> respectful window. Your boutique is shielded by GroVastra&apos;s multi-gate throttle (max 1 marketing contact per 24 hours &amp; max 3 contacts per 7 days) preventing WhatsApp account flagging or consumer opt-outs.
            </p>
          </div>
        </div>

        <button className="px-4 py-2 border border-[#EAE4DC] hover:border-[#5C1D24] text-[#271E1B] hover:text-[#5C1D24] rounded-lg text-xs font-semibold whitespace-nowrap transition-colors bg-[#FAF8F5]">
          View Guidelines
        </button>
      </div>
    </div>
  );
};
