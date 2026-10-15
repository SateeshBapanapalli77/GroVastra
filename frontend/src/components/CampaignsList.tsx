'use client';

import React, { useState } from 'react';
import {
  Plus,
  Play,
  Pause,
  Clock,
  Users,
  Sparkles,
  Gift,
  Heart,
  ArrowRight,
  Shield,
  CheckCircle2,
  AlertCircle,
  Settings
} from 'lucide-react';

import { api } from '../lib/api';

interface CampaignCard {
  id: string;
  name: string;
  type: 'birthday' | 'anniversary';
  status: 'ACTIVE' | 'DRAFT' | 'PAUSED';
  nextExecution: string;
  enrolledCount: number;
  priority: number;
  steps: Array<{ label: string; offset: string }>;
}

export const CampaignsList: React.FC<{
  onOpenStudio: (type: 'birthday' | 'anniversary') => void;
}> = ({ onOpenStudio }) => {
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'DRAFT'>('ALL');
  const [campaigns, setCampaigns] = useState<CampaignCard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const res = await api.getCampaigns();
      if (res && res.campaigns) {
        const mapped: CampaignCard[] = res.campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.name.toLowerCase().includes('anniversary') ? 'anniversary' : 'birthday',
          status: c.status as any,
          nextExecution: c.status === 'ACTIVE' ? 'Scheduled (Polling Active)' : 'Pending Activation',
          enrolledCount: c.enrolledCount || 0,
          priority: c.activeVersion?.priority || 80,
          steps: (c.activeVersion?.steps || []).map((s: any) => ({
            label: s.stepId,
            offset: `D${s.offsetDays >= 0 ? '+' : ''}${s.offsetDays}`
          }))
        }));
        setCampaigns(mapped);
      }
    } catch (err: any) {
      console.warn('Backend offline or empty; fallback to initial view', err.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadCampaigns();
  }, []);

  const togglePause = async (id: string, currentStatus: string) => {
    try {
      if (currentStatus === 'ACTIVE') {
        await api.pauseCampaign(id);
      } else {
        await api.resumeCampaign(id);
      }
      await loadCampaigns();
    } catch (err: any) {
      alert(`Error toggling campaign status: ${err.message}`);
    }
  };

  const filteredCampaigns = campaigns.filter((c) => {
    if (filterTab === 'ALL') return true;
    return c.status === filterTab;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Page Title & Preset Launchers */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EAE4DC] pb-5">
        <div>
          <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
            GroVastra Messaging Engine
          </div>
          <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
            Auto Campaigns
          </h1>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Automated event-driven and calendar-driven WhatsApp engagement for handlooms &amp; boutiques
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenStudio('anniversary')}
            className="flex items-center gap-1.5 px-4 py-2 border border-[#EAE4DC] hover:border-[#5C1D24] text-[#271E1B] bg-white rounded-xl text-xs font-semibold shadow-xs hover:bg-[#FAF8F5] transition-all"
          >
            <Heart className="w-3.5 h-3.5 text-[#5C1D24]" />
            <span>+ Anniversary Campaign</span>
          </button>

          <button
            onClick={() => onOpenStudio('birthday')}
            className="flex items-center gap-2 bg-[#5C1D24] hover:bg-[#431217] text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>+ Birthday Campaign</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-[#EAE4DC] pb-3 text-xs">
        {(['ALL', 'ACTIVE', 'DRAFT'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              filterTab === tab
                ? 'bg-[#5C1D24] text-white shadow-2xs'
                : 'text-[#6B5E59] hover:bg-white'
            }`}
          >
            {tab === 'ALL' ? 'All Campaigns' : tab.charAt(0) + tab.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Campaign Cards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredCampaigns.map((camp) => (
          <div
            key={camp.id}
            className="bg-white p-6 rounded-2xl border border-[#EAE4DC] shadow-xs hover:border-[#D4AF37] transition-all flex flex-col justify-between"
          >
            <div>
              {/* Card Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      camp.type === 'birthday'
                        ? 'bg-[#FDF5F6] border border-[#F0DADC] text-[#5C1D24]'
                        : 'bg-[#FEF9EE] border border-[#F3E0B5] text-[#C99726]'
                    }`}
                  >
                    {camp.type === 'birthday' ? (
                      <Gift className="w-5 h-5" />
                    ) : (
                      <Heart className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-[#431217]">
                      {camp.name}
                    </h3>
                    <div className="text-[10px] text-[#6B5E59] flex items-center gap-2 mt-0.5">
                      <span>Priority: <strong>{camp.priority}</strong></span>
                      <span>•</span>
                      <span>Timezone: <strong>Asia/Kolkata</strong></span>
                    </div>
                  </div>
                </div>

                <span
                  className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${
                    camp.status === 'ACTIVE'
                      ? 'bg-[#E8F8EE] text-[#1B7A43]'
                      : camp.status === 'PAUSED'
                      ? 'bg-[#FEF9EE] text-[#8F6910]'
                      : 'bg-[#FAF8F5] text-[#6B5E59] border border-[#EAE4DC]'
                  }`}
                >
                  {camp.status}
                </span>
              </div>

              {/* Execution details */}
              <div className="grid grid-cols-2 gap-3 my-4 p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs">
                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold">
                    Next Run
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span className="truncate">{camp.nextExecution}</span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-[#988B86] uppercase font-bold">
                    Enrolled Patrons
                  </div>
                  <div className="font-semibold text-[#271E1B] mt-0.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#5C1D24]" />
                    <span>{camp.enrolledCount} Patrons Active</span>
                  </div>
                </div>
              </div>

              {/* Sequence Flow */}
              <div>
                <div className="text-[10px] font-bold text-[#988B86] uppercase tracking-wider mb-2">
                  Durable Sequence Steps
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                  {camp.steps.map((st, i) => (
                    <React.Fragment key={st.label}>
                      <div className="px-3 py-1 bg-white border border-[#EAE4DC] rounded-lg font-medium text-[#271E1B] flex items-center gap-1.5 shrink-0 shadow-2xs">
                        <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] font-bold px-1.5 py-0.2 rounded border border-[#F3E0B5]">
                          {st.offset}
                        </span>
                        <span>{st.label}</span>
                      </div>
                      {i < camp.steps.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-[#988B86] shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 pt-3 border-t border-[#F4EFE8] flex items-center justify-between">
              <button
                onClick={() => onOpenStudio(camp.type)}
                className="px-4 py-2 bg-[#5C1D24] hover:bg-[#431217] text-white rounded-xl text-xs font-semibold transition-colors shadow-2xs"
              >
                Configure / Edit
              </button>

              <div className="flex items-center gap-2">
                {camp.status !== 'DRAFT' && (
                  <button
                    onClick={() => togglePause(camp.id, camp.status)}
                    className="p-2 border border-[#EAE4DC] hover:border-[#5C1D24] text-[#6B5E59] rounded-xl hover:bg-[#FAF8F5] transition-colors"
                    title={camp.status === 'ACTIVE' ? 'Pause Campaign' : 'Resume Campaign'}
                  >
                    {camp.status === 'ACTIVE' ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Safety Notice matching Page 7 */}
      <div className="p-4 bg-white rounded-2xl border border-[#EAE4DC] flex items-center gap-3 text-xs text-[#6B5E59] shadow-xs">
        <Shield className="w-5 h-5 text-[#C99726] shrink-0" />
        <p className="leading-relaxed">
          <strong>Notice:</strong> This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.
        </p>
      </div>
    </div>
  );
};
