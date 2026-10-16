'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { queryKeys } from '../../lib/queryKeys';
import { api, generateIdempotencyKey } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { canManageCampaigns } from '../../lib/roles';
import { CampaignItem, CampaignPresetItem } from '../../lib/schemas';
import {
  Sparkles,
  Plus,
  Play,
  Pause,
  AlertCircle,
  Clock,
  Users,
  ChevronRight,
  RefreshCw,
  Archive,
  Lock,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2
} from 'lucide-react';
import { DateTime } from 'luxon';
import { toast } from 'sonner';

export default function CampaignsOverviewPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ARCHIVED'>('ALL');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [newCampaignName, setNewCampaignName] = useState('');

  const canCreate = canManageCampaigns(user?.role);

  // 1. Query Campaigns List
  const {
    data: campaignsData,
    isLoading: campaignsLoading,
    isError: campaignsError,
    error: campaignsErr,
    refetch: refetchCampaigns
  } = useQuery({
    queryKey: queryKeys.campaigns.list(),
    queryFn: () => api.getCampaigns()
  });

  // 2. Query Campaign Presets
  const {
    data: presetsData,
    isLoading: presetsLoading,
    isError: presetsError,
    refetch: refetchPresets
  } = useQuery({
    queryKey: queryKeys.presets.all,
    queryFn: () => api.getPresets()
  });

  // 3. Query Integration Readiness for Data Blockers
  const { data: readinessData } = useQuery({
    queryKey: queryKeys.readiness.all,
    queryFn: () => api.getIntegrationReadiness()
  });

  // 4. Query Settings for Store Display Name Check
  const { data: settingsData } = useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => api.getCampaignSettings()
  });

  const campaigns: CampaignItem[] = campaignsData?.campaigns || [];
  const presets: CampaignPresetItem[] = presetsData?.presets || [];
  const connectionReady = readinessData?.connection?.status === 'ACTIVE';
  const storeNameConfigured = Boolean(settingsData?.settings?.storeName?.trim());

  // Mutation: Create Campaign Draft (Non-negotiables: sends Idempotency-Key, no sends)
  const createMutation = useMutation({
    mutationFn: async ({ presetId, name }: { presetId?: string; name: string }) => {
      const idemp = generateIdempotencyKey('create_campaign');
      return api.createCampaign(presetId || undefined, name.trim(), idemp);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      toast.success('Campaign draft created successfully');
      setIsCreateModalOpen(false);
      setNewCampaignName('');
      setSelectedPresetId('');
      if (data?.campaign?.id) {
        router.push(`/campaigns/${data.campaign.id}/edit`);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create campaign draft');
    }
  });

  const handleLaunchPreset = (preset: CampaignPresetItem) => {
    if (!canCreate) return;
    if (!preset.implemented) return;
    setSelectedPresetId(preset.id);
    setNewCampaignName(preset.name);
    setIsCreateModalOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    const name = newCampaignName.trim() || 'New Boutique Campaign';
    createMutation.mutate({ presetId: selectedPresetId || undefined, name });
  };

  const filteredCampaigns = campaigns.filter((c) => {
    if (statusFilter === 'ALL') return true;
    return c.status === statusFilter;
  });

  // Helper: Format Next Activity in tenant IANA timezone with UTC instant on hover (Non-negotiable 9)
  const getNextActivityInfo = (camp: CampaignItem) => {
    if (camp.status === 'PAUSED') {
      return {
        label: 'Paused — evaluation suspended',
        utc: 'Evaluation paused store-wide or at campaign level'
      };
    }
    if (camp.status === 'DRAFT' || camp.status === 'VALIDATED') {
      return {
        label: 'Draft — awaits review & activation',
        utc: 'Not scheduled until activated with dry-run fingerprint'
      };
    }
    if (camp.status === 'ARCHIVED') {
      return {
        label: 'Archived — campaign concluded',
        utc: 'Campaign archived; no further evaluations scheduled'
      };
    }

    // Active campaign: evaluate step local time in campaign timezone
    const tz = camp.activeVersion?.timezone || settingsData?.settings?.timezone || 'Asia/Kolkata';
    const stepTime = camp.activeVersion?.steps?.[0]?.localTime || '10:00';
    const [h, m] = stepTime.split(':').map(Number);

    const now = DateTime.now().setZone(tz);
    let nextDate = now.set({ hour: h || 10, minute: m || 0, second: 0, millisecond: 0 });
    if (nextDate <= now) {
      nextDate = nextDate.plus({ days: 1 });
    }

    const localLabel = `Daily at ${stepTime} (${tz.replace(/_/g, ' ')})`;
    const utcTooltip = `Next evaluation: ${nextDate.toFormat('dd LLL yyyy, HH:mm')} ${tz} [Instant: ${nextDate.toUTC().toISO()} UTC]`;

    return { label: localLabel, utc: utcTooltip };
  };

  // Helper: Detect Readiness & Data Blockers
  const getBlockerInfo = (camp: CampaignItem) => {
    const blockers: string[] = [];

    if (!connectionReady) {
      blockers.push('WhatsApp channel connection offline');
    }

    if (!storeNameConfigured) {
      blockers.push('Store display name unconfigured in Settings');
    }

    const steps = camp.activeVersion?.steps || [];
    if (camp.status !== 'DRAFT' && steps.length === 0) {
      blockers.push('No execution steps defined');
    }

    return blockers;
  };

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Overview']}>
      <div className="space-y-8 max-w-6xl mx-auto">
        {/* Top Header & Primary Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#EAE4DC] pb-5">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[#431217]">
              Auto Campaigns Overview
            </h1>
            <p className="text-xs text-[#6B5E59] mt-1">
              Automated high-touch occasion &amp; merchandise sequences for handloom patrons.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {canCreate ? (
              <button
                type="button"
                id="btn-new-campaign"
                onClick={() => {
                  setSelectedPresetId('');
                  setNewCampaignName('');
                  setIsCreateModalOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] active:bg-[#431217] text-xs font-semibold tracking-wide transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#F3E0B5]" />
                <span>New Campaign</span>
              </button>
            ) : (
              <div
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#F4EFE8] text-[#8C827A] border border-[#EAE4DC] text-xs font-medium cursor-not-allowed"
                title="Only Boutique Owners and Store Managers can create new campaigns."
              >
                <Lock className="w-3.5 h-3.5 text-[#8C827A]" />
                <span>New Campaign (Staff View)</span>
              </div>
            )}
          </div>
        </div>

        {/* Staff Role Notice */}
        {!canCreate && (
          <div className="p-3 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#C99726]" />
            <span>
              Signed in as <strong>Store Staff</strong>. You have read-only access to campaign overviews and can resolve customer holds in Activity. Campaign creation and settings are reserved for Boutique Owners.
            </span>
          </div>
        )}

        {/* SECTION 1: PRESET BLUEPRINTS */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-base font-bold text-[#2A1D1A] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C99726]" />
                <span>Preset Campaign Blueprints</span>
              </h2>
              <p className="text-[11px] text-[#6B5E59]">
                Pre-approved boutique workflows with verified WhatsApp message templates.
              </p>
            </div>
            <span className="text-[11px] font-medium text-[#8F6910]">
              GET /campaign-presets
            </span>
          </div>

          {presetsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-xl bg-white border border-[#EAE4DC] animate-pulse p-4 space-y-3">
                  <div className="h-4 bg-[#F4EFE8] rounded w-1/3" />
                  <div className="h-4 bg-[#F4EFE8] rounded w-3/4" />
                  <div className="h-8 bg-[#FAF8F5] rounded w-full" />
                </div>
              ))}
            </div>
          ) : presetsError ? (
            <div className="p-4 rounded-xl bg-white border border-[#F8D7DA] text-xs text-[#9E2A2B] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#9E2A2B]" />
                <span>Failed to load campaign presets catalogue.</span>
              </div>
              <button
                type="button"
                onClick={() => refetchPresets()}
                className="px-3 py-1 rounded bg-[#9E2A2B] text-white text-[11px] font-semibold hover:bg-[#73232C]"
              >
                Retry
              </button>
            </div>
          ) : presets.length === 0 ? (
            <div className="p-4 rounded-xl bg-white border border-[#EAE4DC] text-xs text-[#6B5E59]">
              No campaign presets available in catalogue.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {presets.map((preset) => {
                const isImplemented = Boolean(preset.implemented);

                return (
                  <div
                    key={preset.id}
                    className={`rounded-xl p-4 flex flex-col justify-between transition-all border ${
                      isImplemented
                        ? 'bg-white border-[#EAE4DC] hover:border-[#C99726] shadow-2xs group'
                        : 'bg-[#FAF8F5] border-[#E2DDD5] border-dashed opacity-65 cursor-not-allowed select-none'
                    }`}
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]">
                          {preset.category || 'OCCASION'}
                        </span>

                        {isImplemented ? (
                          <span className="text-[10px] text-[#6B5E59]">
                            {preset.defaultSteps?.length || 1} Step Workflow
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F4EFE8] text-[#8C827A] border border-[#DCD3C7]">
                            Coming soon
                          </span>
                        )}
                      </div>

                      {/* Title & Description */}
                      <h3
                        className={`font-serif text-sm font-bold ${
                          isImplemented ? 'text-[#2A1D1A] group-hover:text-[#5C1D24]' : 'text-[#8C827A]'
                        } transition-colors`}
                      >
                        {preset.name}
                      </h3>
                      <p className="text-xs text-[#6B5E59] mt-1.5 line-clamp-2 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>

                    {/* Footer Action */}
                    <div className="mt-4 pt-3 border-t border-[#F3EFE8] flex items-center justify-between">
                      <span className="text-[10px] text-[#988B86]">
                        {preset.purpose === 'ORDER_SERVICE' ? 'Service update' : 'Promotional'}
                      </span>

                      {isImplemented ? (
                        canCreate ? (
                          <button
                            type="button"
                            onClick={() => handleLaunchPreset(preset)}
                            className="text-xs font-semibold text-[#5C1D24] hover:text-[#73232C] hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>Use Preset</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#988B86]">Staff view</span>
                        )
                      ) : (
                        <span
                          className="text-xs font-medium text-[#8C827A] cursor-not-allowed"
                          title="Evaluator scanner worker not yet implemented."
                        >
                          Coming soon
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: STORE CAMPAIGNS LIST */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-serif text-base font-bold text-[#2A1D1A]">
                Store Campaigns ({campaigns.length})
              </h2>
              <p className="text-[11px] text-[#6B5E59]">
                Active and scheduled marketing sequences evaluated by the GroVastra engine.
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {(['ALL', 'ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[#5C1D24] text-white shadow-2xs font-semibold'
                      : 'bg-white text-[#6B5E59] border border-[#EAE4DC] hover:bg-[#F3EFE8]'
                  }`}
                >
                  {st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {campaignsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-white border border-[#EAE4DC] rounded-xl animate-pulse p-4 space-y-2">
                  <div className="h-4 bg-[#F4EFE8] rounded w-1/4" />
                  <div className="h-4 bg-[#F4EFE8] rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : campaignsError ? (
            <div className="p-8 bg-white border border-[#F8D7DA] rounded-xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
              <p className="text-xs text-[#9E2A2B]">
                Failed to load campaigns: {(campaignsErr as Error)?.message || 'Service offline'}
              </p>
              <button
                type="button"
                onClick={() => refetchCampaigns()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-10 bg-white border border-[#EAE4DC] rounded-2xl text-center space-y-3">
              <Sparkles className="w-8 h-8 text-[#C99726] mx-auto" />
              <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
                No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} campaigns found
              </h3>
              <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
                {statusFilter === 'ALL'
                  ? 'Start by creating your first automated campaign draft from a boutique blueprint above.'
                  : `There are currently no campaigns in ${statusFilter.toLowerCase()} status.`}
              </p>
              {statusFilter === 'ALL' && canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPresetId('');
                    setNewCampaignName('');
                    setIsCreateModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create First Campaign</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCampaigns.map((camp) => {
                const statusColor =
                  camp.status === 'ACTIVE'
                    ? 'bg-[#EBF7EE] text-[#1B7A43] border-[#C3E8CB]'
                    : camp.status === 'PAUSED'
                    ? 'bg-[#FEF9EE] text-[#8F6910] border-[#F3E0B5]'
                    : camp.status === 'ARCHIVED'
                    ? 'bg-[#F4EFE8] text-[#6B5E59] border-[#EAE4DC]'
                    : 'bg-[#FDF5F6] text-[#5C1D24] border-[#F0DADC]';

                const nextActivity = getNextActivityInfo(camp);
                const blockers = getBlockerInfo(camp);

                return (
                  <Link
                    key={camp.id}
                    href={`/campaigns/${camp.id}`}
                    className="block bg-white border border-[#EAE4DC] rounded-xl p-4 hover:border-[#5C1D24] transition-all shadow-2xs group"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      {/* Left: Status, Name, Blocker Alerts */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusColor}`}
                          >
                            {camp.status}
                          </span>
                          <span className="text-[10px] text-[#988B86]">
                            v{camp.draftVersion || 1}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-[#988B86] px-1.5 py-0.5 rounded bg-[#FAF8F5]">
                            {camp.purpose}
                          </span>
                        </div>

                        <h3 className="font-serif text-sm font-bold text-[#2A1D1A] group-hover:text-[#5C1D24] transition-colors">
                          {camp.name}
                        </h3>

                        {/* Blocker Tags */}
                        {blockers.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {blockers.map((blk, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 text-[11px] text-[#9E2A2B] bg-[#FDF2F2] px-2 py-0.5 rounded-md border border-[#F8D7DA]"
                              >
                                <AlertTriangle className="w-3 h-3 text-[#9E2A2B]" />
                                <span>{blk}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[11px] text-[#1B7A43]">
                            <CheckCircle2 className="w-3 h-3 text-[#1B7A43]" />
                            <span>Readiness validated</span>
                          </div>
                        )}
                      </div>

                      {/* Right: Enrolled Patrons, Next Activity, Arrow */}
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-6 text-xs text-[#6B5E59]">
                        {/* Enrolled Patrons */}
                        <div className="flex items-center gap-1.5" title="Active customer enrollments in sequence">
                          <Users className="w-3.5 h-3.5 text-[#C99726]" />
                          <span>
                            <strong>{camp.enrolledCount}</strong> active patrons
                          </span>
                        </div>

                        {/* Next Activity with UTC hover tooltip */}
                        <div
                          className="flex items-center gap-1.5"
                          title={nextActivity.utc}
                        >
                          <Clock
                            className={`w-3.5 h-3.5 ${
                              camp.status === 'ACTIVE'
                                ? 'text-[#1B7A43]'
                                : camp.status === 'PAUSED'
                                ? 'text-[#8F6910]'
                                : 'text-[#988B86]'
                            }`}
                          />
                          <span className="font-medium text-[#2A1D1A]">
                            {nextActivity.label}
                          </span>
                        </div>

                        <ChevronRight className="w-4 h-4 text-[#988B86] group-hover:text-[#5C1D24] transition-colors" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* MODAL: CREATE CAMPAIGN DRAFT */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl border border-[#EAE4DC] shadow-xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAE4DC] pb-3">
                <h3 className="font-serif text-base font-bold text-[#431217]">
                  Create Campaign Draft
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1 rounded-lg text-[#988B86] hover:bg-[#FAF8F5] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Campaign Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="e.g. Padmavati Silks Birthday Celebration"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden"
                  />
                  <p className="text-[10px] text-[#988B86] mt-1">
                    Friendly label for internal identification and reporting.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Preset Blueprint (Optional)
                  </label>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => {
                      setSelectedPresetId(e.target.value);
                      const match = presets.find((p) => p.id === e.target.value);
                      if (match && !newCampaignName) {
                        setNewCampaignName(match.name);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden"
                  >
                    <option value="">Blank Campaign Draft</option>
                    {presets
                      .filter((p) => p.implemented)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.category})
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-[#988B86] mt-1">
                    Initializes step schedules, approved templates, and audience defaults.
                  </p>
                </div>

                <div className="p-3 bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl text-[11px] text-[#8F6910]">
                  Creates a draft with version 1. No messages are sent until you review and activate.
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-[#EAE4DC] text-xs font-semibold text-[#6B5E59] hover:bg-[#FAF8F5] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || !newCampaignName.trim()}
                    className="px-5 py-2 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] text-xs font-semibold tracking-wide transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Draft</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
