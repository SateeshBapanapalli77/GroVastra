'use client';

import React, { useState, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../../components/layout/AppShell';
import { api, generateIdempotencyKey, ConflictError } from '../../../lib/api';
import { queryKeys } from '../../../lib/queryKeys';
import { useAuth } from '../../../lib/useAuth';
import { canManageCampaigns } from '../../../lib/roles';
import { Can } from '../../../components/auth/Can';
import { CampaignEnrollmentsTab } from '../../../components/campaign-activity/CampaignEnrollmentsTab';
import { CampaignHistoryTab } from '../../../components/campaign-activity/CampaignHistoryTab';
import {
  Sparkles,
  Play,
  Pause,
  Archive,
  Edit,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  FileText,
  ShieldCheck,
  Calendar,
  Lock,
  Layers,
  Activity,
  Eye,
  Check,
  Loader2,
  ExternalLink,
  History
} from 'lucide-react';
import { DateTime } from 'luxon';
import { toast } from 'sonner';

function CampaignDetailContent() {
  const params = useParams();
  const campaignId = (Array.isArray(params?.id) ? params.id[0] : params?.id) || '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = canManageCampaigns(user?.role);

  // URL-synced query params for tabs and pagination
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const enrollmentStatus = searchParams.get('enrollmentStatus') || 'all';
  const enrollmentPage = parseInt(searchParams.get('enrollmentPage') || '1', 10);
  const historyStatus = searchParams.get('historyStatus') || 'all';
  const historyReason = searchParams.get('historyReason') || 'all';
  const historyPage = parseInt(searchParams.get('historyPage') || '1', 10);

  const updateQueryParam = (key: string, value: string | number) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (value === 'all' || (value === 1 && (key.endsWith('Page') || key.endsWith('Status') || key.endsWith('Reason')))) {
      current.delete(key);
    } else {
      current.set(key, String(value));
    }
    if (key === 'tab') {
      current.set('tab', String(value));
    }
    const qStr = current.toString();
    router.replace(`/campaigns/${campaignId}${qStr ? `?${qStr}` : ''}`, { scroll: false });
  };

  // Concurrency & Error State
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Modal Dialog States
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [simulatorStepIndex, setSimulatorStepIndex] = useState(0);

  // Resume Explicit Acknowledgement Checkbox (Spec requirement)
  const [resumeAcknowledged, setResumeAcknowledged] = useState(false);

  // Publish Revision State
  const [isPublishingDryRun, setIsPublishingDryRun] = useState(false);
  const [publishFingerprint, setPublishFingerprint] = useState<string | null>(null);

  // 1. Fetch Campaign Detail
  const {
    data: detailData,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
    refetch: refetchCampaign
  } = useQuery({
    queryKey: queryKeys.campaigns.detail(campaignId),
    queryFn: () => api.getCampaignDetail(campaignId),
    enabled: Boolean(campaignId)
  });

  // 2. Fetch System Monitoring Health
  const { data: alertsData } = useQuery({
    queryKey: queryKeys.reports.alerts,
    queryFn: () => api.getMonitoringAlerts(),
    staleTime: 30000
  });

  const campaign = detailData?.campaign;
  const activeVersion = detailData?.activeVersion;
  const latestDraft = detailData?.latestDraft;
  const monitoring = alertsData?.monitoring;

  // Single-flight mutation guards
  const isPausingRef = useRef(false);
  const isResumingRef = useRef(false);
  const isPublishingRef = useRef(false);
  const isArchivingRef = useRef(false);

  // Pause Mutation (Honest copy: "Unsent work stops. Messages already being sent may still go out.")
  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (isPausingRef.current) return;
      isPausingRef.current = true;
      setConflictError(null);
      return api.pauseCampaign(campaignId, generateIdempotencyKey('pause'));
    },
    onSuccess: () => {
      isPausingRef.current = false;
      setShowPauseModal(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      toast.success('Campaign paused successfully');
    },
    onError: (err: any) => {
      isPausingRef.current = false;
      if (err instanceof ConflictError || err.status === 409) {
        setConflictError('Conflict detected (409): Campaign status was modified concurrently. Please reload.');
      } else {
        toast.error(err.message || 'Failed to pause campaign');
      }
    }
  });

  // Resume Mutation (Requires FUTURE_ONLY acknowledgement)
  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (isResumingRef.current) return;
      isResumingRef.current = true;
      setConflictError(null);
      return api.resumeCampaign(campaignId, generateIdempotencyKey('resume'));
    },
    onSuccess: () => {
      isResumingRef.current = false;
      setShowResumeModal(false);
      setResumeAcknowledged(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      toast.success('Campaign resumed (evaluating future dates only)');
    },
    onError: (err: any) => {
      isResumingRef.current = false;
      if (err instanceof ConflictError || err.status === 409) {
        setConflictError('Conflict detected (409): Campaign status was modified concurrently. Please reload.');
      } else {
        toast.error(err.message || 'Failed to resume campaign');
      }
    }
  });

  // Archive Mutation
  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (isArchivingRef.current) return;
      isArchivingRef.current = true;
      setConflictError(null);
      return api.archiveCampaign(campaignId, generateIdempotencyKey('archive'));
    },
    onSuccess: (data: any) => {
      isArchivingRef.current = false;
      setShowArchiveModal(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      toast.success(`Campaign archived. ${data?.cancelledExecutionsCount ?? 0} pending executions cancelled.`);
    },
    onError: (err: any) => {
      isArchivingRef.current = false;
      toast.error(err.message || 'Failed to archive campaign');
    }
  });

  // Prepare & Publish Revision Mutation
  const handleOpenPublishModal = async () => {
    setShowPublishModal(true);
    setPublishFingerprint(null);
    setIsPublishingDryRun(true);
    try {
      const res = await api.runDryRun(campaignId, generateIdempotencyKey('pub_dryrun'));
      if (res?.dryRun?.draftFingerprint) {
        setPublishFingerprint(res.dryRun.draftFingerprint);
      }
    } catch (err: any) {
      toast.error('Pre-publish dry-run failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsPublishingDryRun(false);
    }
  };

  const publishRevisionMutation = useMutation({
    mutationFn: async () => {
      if (isPublishingRef.current) return;
      isPublishingRef.current = true;
      setConflictError(null);

      if (!publishFingerprint) {
        throw new Error('Pre-flight dry run evaluation is required before publishing revision.');
      }

      const expectedVersion = campaign?.draftVersion || 1;
      return api.publishRevision(
        campaignId,
        expectedVersion,
        publishFingerprint,
        undefined,
        generateIdempotencyKey('publish_rev')
      );
    },
    onSuccess: (data: any) => {
      isPublishingRef.current = false;
      setShowPublishModal(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      toast.success(data?.message || 'Revision published successfully');
    },
    onError: (err: any) => {
      isPublishingRef.current = false;
      if (err instanceof ConflictError || err.status === 409) {
        setConflictError('Version conflict (409): Draft version changed concurrently. Please reload latest.');
      } else {
        toast.error(err.message || 'Failed to publish revision');
      }
    }
  });

  if (isDetailLoading) {
    return (
      <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Loading Campaign...']}>
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="h-28 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-32 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse" />
            <div className="h-32 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse" />
            <div className="h-32 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse" />
          </div>
          <div className="h-64 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse" />
        </div>
      </AppShell>
    );
  }

  if (isDetailError || !campaign) {
    return (
      <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Error']}>
        <div className="max-w-2xl mx-auto p-8 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h2 className="font-serif text-base font-bold text-[#9E2A2B]">Unable to load campaign</h2>
          <p className="text-xs text-[#6B5E59]">{(detailError as Error)?.message || 'Campaign record not found'}</p>
          <div className="flex items-center justify-center gap-2.5 pt-2">
            <button
              onClick={() => refetchCampaign()}
              className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
            >
              Retry
            </button>
            <Link
              href="/campaigns"
              className="px-4 py-2 rounded-lg border border-[#EAE4DC] text-xs text-[#6B5E59] hover:bg-[#FAF8F5]"
            >
              Back to Overview
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const timezone = activeVersion?.timezone || latestDraft?.timezone || 'Asia/Kolkata';
  const hasUnpublishedDraft =
    latestDraft &&
    (campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') &&
    latestDraft.id !== campaign.activeVersionId;

  // Format next autonomous evaluation instant
  const nextEvaluationInstant = (() => {
    if (campaign.status !== 'ACTIVE') return null;
    const nowDt = DateTime.now().setZone(timezone);
    const localTime = activeVersion?.steps?.[0]?.localTime || '10:00';
    const [h, m] = localTime.split(':');
    let nextDt = nowDt.set({ hour: parseInt(h, 10), minute: parseInt(m, 10), second: 0 });
    if (nextDt <= nowDt) {
      nextDt = nextDt.plus({ days: 1 });
    }
    return {
      local: nextDt.toFormat('dd LLL yyyy, HH:mm') + ` (${timezone})`,
      utc: nextDt.toUTC().toISO() || ''
    };
  })();

  const stepsToDisplay = activeVersion?.steps || latestDraft?.steps || [];

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', campaign.name]}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Conflict Banner (409) */}
        {conflictError && (
          <div className="p-4 rounded-2xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
              <span>{conflictError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setConflictError(null);
                refetchCampaign();
              }}
              className="px-3 py-1 rounded bg-[#B26A00] text-white font-semibold hover:bg-[#8F6910] cursor-pointer"
            >
              Reload latest
            </button>
          </div>
        )}

        {/* Top Header Card */}
        <div className="bg-white border border-[#EAE4DC] p-6 rounded-2xl shadow-2xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/campaigns"
                className="text-[#6B5E59] hover:text-[#5C1D24] p-1 rounded hover:bg-[#FAF8F5]"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                  campaign.status === 'ACTIVE'
                    ? 'bg-[#EBF7EE] text-[#1B7A43] border-[#C3E8CB]'
                    : campaign.status === 'PAUSED'
                    ? 'bg-[#FEF9EE] text-[#8F6910] border-[#F3E0B5]'
                    : campaign.status === 'ARCHIVED'
                    ? 'bg-[#F3EFE8] text-[#6B5E59] border-[#EAE4DC]'
                    : 'bg-[#FAF8F5] text-[#5C1D24] border-[#EAE4DC]'
                }`}
              >
                {campaign.status}
              </span>
              <span className="text-xs text-[#988B86]">
                Version {activeVersion?.version || campaign.draftVersion || 1}
              </span>
              {campaign.purpose && (
                <span className="text-[10px] uppercase font-bold text-[#6B5E59] px-2 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE4DC]">
                  {campaign.purpose}
                </span>
              )}
            </div>

            <h1 className="font-serif text-2xl font-bold text-[#431217]">{campaign.name}</h1>
            <p className="text-xs text-[#6B5E59]">
              Industry: <strong className="text-[#2A1D1A]">Handloom Boutique</strong> • Trigger:{' '}
              <strong className="text-[#2A1D1A]">
                {(activeVersion?.trigger?.type || latestDraft?.trigger?.type || 'ANNUAL_DATE').replace(/_/g, ' ')}
              </strong>
            </p>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* WhatsApp Simulator Preview (No Send Test) */}
            <button
              type="button"
              onClick={() => {
                setSimulatorStepIndex(0);
                setShowSimulatorModal(true);
              }}
              className="px-3.5 py-2 rounded-lg border border-[#EAE4DC] bg-white text-xs font-semibold text-[#5C1D24] hover:bg-[#FAF8F5] flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            >
              <Eye className="w-3.5 h-3.5 text-[#C99726]" />
              <span>Simulator Preview</span>
            </button>

            {/* Role-gated Owner & Manager Actions */}
            {canEdit ? (
              <>
                {/* PAUSE ACTION */}
                {campaign.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => setShowPauseModal(true)}
                    className="px-3.5 py-2 rounded-lg bg-[#FEF9EE] border border-[#F3E0B5] text-[#8F6910] hover:bg-[#F3E0B5]/40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Pause className="w-3.5 h-3.5 text-[#8F6910]" />
                    <span>Pause campaign</span>
                  </button>
                )}

                {/* RESUME ACTION */}
                {campaign.status === 'PAUSED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setResumeAcknowledged(false);
                      setShowResumeModal(true);
                    }}
                    className="px-3.5 py-2 rounded-lg bg-[#1B7A43] text-white hover:bg-[#145C32] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-white text-white" />
                    <span>Resume campaign</span>
                  </button>
                )}

                {/* EDIT DRAFT / REVISION */}
                <Link
                  href={`/campaigns/${campaign.id}/edit`}
                  className="px-3.5 py-2 rounded-lg border border-[#EAE4DC] bg-white text-[#2A1D1A] hover:bg-[#FAF8F5] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs"
                >
                  <Edit className="w-3.5 h-3.5 text-[#6B5E59]" />
                  <span>{hasUnpublishedDraft ? 'Edit Draft Revision' : 'Edit Campaign'}</span>
                </Link>

                {/* PUBLISH REVISION (When newer draft exists) */}
                {hasUnpublishedDraft && (
                  <button
                    type="button"
                    onClick={handleOpenPublishModal}
                    className="px-3.5 py-2 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#F3E0B5]" />
                    <span>Publish revision v{campaign.draftVersion}</span>
                  </button>
                )}

                {/* ARCHIVE ACTION */}
                {campaign.status !== 'ARCHIVED' && (
                  <button
                    type="button"
                    onClick={() => setShowArchiveModal(true)}
                    className="p-2 rounded-lg border border-[#EAE4DC] text-[#6B5E59] hover:text-[#9E2A2B] hover:bg-[#FDF2F2] transition-all cursor-pointer"
                    title="Archive campaign"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-lg text-xs text-[#6B5E59]">
                <Lock className="w-3.5 h-3.5 text-[#C99726]" />
                <span>Staff view (Read-only)</span>
              </div>
            )}
          </div>
        </div>

        {/* Next Autonomous Evaluation Banner (Non-negotiable 4) */}
        {campaign.status === 'ACTIVE' && nextEvaluationInstant && (
          <div className="bg-[#EBF7EE] border border-[#C3E8CB] p-4 rounded-xl text-xs text-[#1B7A43] flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-[#1B7A43] shrink-0" />
              <span>
                Campaign is active and evaluating patron occasions autonomously.{' '}
                <strong
                  className="cursor-help underline decoration-dotted"
                  title={`UTC Instant: ${nextEvaluationInstant.utc}`}
                >
                  Next evaluation at {nextEvaluationInstant.local}
                </strong>
                .
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#145C32] px-2 py-0.5 rounded bg-white border border-[#C3E8CB] shrink-0">
              Autonomous Evaluator
            </span>
          </div>
        )}

        {/* Paused Honest Notice Banner */}
        {campaign.status === 'PAUSED' && (
          <div className="bg-[#FEF9EE] border border-[#F3E0B5] p-4 rounded-xl text-xs text-[#8F6910] flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2.5">
              <Pause className="w-4 h-4 text-[#8F6910] shrink-0" />
              <span>
                Campaign is currently paused.{' '}
                <strong>Unsent work stops. Messages already being sent may still go out.</strong>
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8F6910] px-2 py-0.5 rounded bg-white border border-[#F3E0B5]">
              Evaluation Paused
            </span>
          </div>
        )}

        {/* METRICS & STATUS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Active Version Info */}
          <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-bold text-[#8F6910]">Active Version</div>
            <div className="text-xl font-bold font-serif text-[#431217]">
              {activeVersion ? `v${activeVersion.version}` : 'None'}
            </div>
            <div className="text-[11px] text-[#6B5E59]">
              {activeVersion?.publishedAt ? (
                <span
                  title={`UTC: ${DateTime.fromISO(String(activeVersion.publishedAt)).toUTC().toISO()}`}
                  className="cursor-help"
                >
                  Published {DateTime.fromISO(String(activeVersion.publishedAt)).setZone(timezone).toFormat('dd LLL yyyy')}
                </span>
              ) : (
                'Draft pending activation'
              )}
            </div>
          </div>

          {/* Draft Revision Info */}
          <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-bold text-[#6B5E59]">Draft Revision</div>
            <div className="text-xl font-bold font-serif text-[#2A1D1A]">
              v{campaign.draftVersion}
            </div>
            <div className="text-[11px] text-[#6B5E59]">
              {hasUnpublishedDraft ? (
                <span className="text-[#C99726] font-semibold">Newer draft in progress</span>
              ) : (
                'Draft matches active version'
              )}
            </div>
          </div>

          {/* Old-Version Enrollment Counts (HONEST NOT AVAILABLE STATE) */}
          <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-bold text-[#6B5E59]">Old-Version Enrollments</div>
            <div className="text-xl font-bold font-serif text-[#6B5E59]">
              Not available yet
            </div>
            <div className="text-[11px] text-[#988B86]">
              Backend API counts {campaign.enrolledCount ?? 0} active total without per-version breakdown
            </div>
          </div>

          {/* Health Monitor */}
          <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-bold text-[#6B5E59]">Campaign Health</div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  monitoring?.status === 'HEALTHY'
                    ? 'bg-[#1B7A43]'
                    : monitoring?.status === 'DEGRADED'
                    ? 'bg-[#C99726]'
                    : 'bg-[#9E2A2B]'
                }`}
              />
              <span className="text-xl font-bold font-serif text-[#2A1D1A]">
                {monitoring?.status || 'HEALTHY'}
              </span>
            </div>
            <div className="text-[11px] text-[#6B5E59]">
              Planner lag: {monitoring?.metrics?.plannerLagMinutes ?? 0}m • Due age:{' '}
              {monitoring?.metrics?.dueStepAgeMinutes ?? 0}m
            </div>
          </div>
        </div>

        {/* Phase 4 Tabs Navigation (URL-Synced) */}
        <div className="flex items-center gap-2 border-b border-[#EAE4DC] pb-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => updateQueryParam('tab', 'overview')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'overview'
                ? 'bg-white border-t border-x border-[#EAE4DC] text-[#5C1D24] shadow-2xs font-bold'
                : 'text-[#6B5E59] hover:text-[#2A1D1A] hover:bg-[#FAF8F5]'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#C99726]" />
            <span>Overview &amp; Sequence</span>
          </button>

          <button
            type="button"
            onClick={() => updateQueryParam('tab', 'enrollments')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'enrollments'
                ? 'bg-white border-t border-x border-[#EAE4DC] text-[#5C1D24] shadow-2xs font-bold'
                : 'text-[#6B5E59] hover:text-[#2A1D1A] hover:bg-[#FAF8F5]'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-[#C99726]" />
            <span>Enrollments ({campaign.enrolledCount ?? 0})</span>
          </button>

          <button
            type="button"
            onClick={() => updateQueryParam('tab', 'history')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'history'
                ? 'bg-white border-t border-x border-[#EAE4DC] text-[#5C1D24] shadow-2xs font-bold'
                : 'text-[#6B5E59] hover:text-[#2A1D1A] hover:bg-[#FAF8F5]'
            }`}
          >
            <History className="w-3.5 h-3.5 text-[#C99726]" />
            <span>Step Execution History</span>
          </button>
        </div>

        {/* TAB 1: OVERVIEW & APPROVED SEQUENCE */}
        {activeTab === 'overview' && (
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif text-base font-bold text-[#431217]">
                  Approved Message Flow &amp; Sequence Steps
                </h2>
                <p className="text-xs text-[#6B5E59] mt-0.5">
                  Every step references an approved Meta template with zero dynamic template creation.
                </p>
              </div>
              <span className="text-xs text-[#988B86]">
                {stepsToDisplay.length} Touchpoint{stepsToDisplay.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="space-y-3">
              {stepsToDisplay.map((step: any, idx: number) => {
                const templateId = step.templateRef?.id || step.templateId || 'Not assigned';
                const offset = step.offsetDays ?? step.delayDays ?? 0;
                const offsetLabel =
                  offset === 0 ? 'On Occasion Day' : offset > 0 ? `+${offset} days after` : `${offset} days before`;

                return (
                  <div
                    key={step.stepId || idx}
                    className="border border-[#EAE4DC] rounded-xl p-4 bg-[#FAF8F5] flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white text-[#5C1D24] border border-[#EAE4DC]">
                          Step {idx + 1}
                        </span>
                        <strong className="text-xs text-[#2A1D1A]">{step.stepId || `Step ${idx + 1}`}</strong>
                      </div>

                      <div className="text-xs text-[#6B5E59] flex items-center gap-3 flex-wrap">
                        <span>
                          Schedule: <strong>{offsetLabel}</strong> at <strong>{step.localTime || '10:00'}</strong> ({timezone})
                        </span>
                        <span>
                          Template: <code className="bg-white px-1.5 py-0.5 rounded border border-[#EAE4DC] font-mono text-[10px] text-[#5C1D24]">{templateId}</code>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right text-[11px] text-[#6B5E59]">
                        <div>Stop on Reply: <strong>{step.stopOnReply !== false ? 'Enabled' : 'Disabled'}</strong></div>
                        <div>Stop on Goal: <strong>{step.stopOnGoal !== false ? 'Enabled' : 'Disabled'}</strong></div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSimulatorStepIndex(idx);
                          setShowSimulatorModal(true);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[11px] font-semibold text-[#5C1D24] hover:bg-[#FAF8F5] cursor-pointer"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: ENROLLMENTS */}
        {activeTab === 'enrollments' && (
          <CampaignEnrollmentsTab
            campaignId={campaignId}
            campaignName={campaign.name}
            timezone={timezone}
            statusFilter={enrollmentStatus}
            onStatusFilterChange={(s) => updateQueryParam('enrollmentStatus', s)}
            page={enrollmentPage}
            onPageChange={(p) => updateQueryParam('enrollmentPage', p)}
          />
        )}

        {/* TAB 3: STEP EXECUTION HISTORY */}
        {activeTab === 'history' && (
          <CampaignHistoryTab
            campaignId={campaignId}
            timezone={timezone}
            statusFilter={historyStatus}
            onStatusFilterChange={(s) => updateQueryParam('historyStatus', s)}
            reasonFilter={historyReason}
            onReasonFilterChange={(r) => updateQueryParam('historyReason', r)}
            page={historyPage}
            onPageChange={(p) => updateQueryParam('historyPage', p)}
          />
        )}
      </div>

      {/* 1. HONEST PAUSE CONFIRMATION DIALOG (Non-negotiable 5) */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF9EE] border border-[#F3E0B5] flex items-center justify-center shrink-0">
                <Pause className="w-5 h-5 text-[#8F6910]" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-base font-bold text-[#431217]">Pause Auto Campaign</h3>
                <p className="text-xs text-[#6B5E59] leading-relaxed">
                  <strong>Unsent work stops. Messages already being sent may still go out.</strong>
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] leading-relaxed space-y-1.5">
              <p>
                Pausing immediately stops the evaluation scanner from queuing new occasion dispatches.
              </p>
              <p className="text-[11px] text-[#8F6910]">
                When resumed later, the campaign evaluates upcoming future dates only. Dispatches scheduled during the pause window will not bulk-fire.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowPauseModal(false)}
                className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => pauseMutation.mutate()}
                disabled={pauseMutation.isPending}
                className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all cursor-pointer disabled:opacity-50"
              >
                {pauseMutation.isPending ? 'Pausing...' : 'Confirm Pause'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. RESUME CONFIRMATION DIALOG (With Backend Gap & Explicit FUTURE_ONLY Acknowledgement) */}
      {showResumeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] border border-[#C3E8CB] flex items-center justify-center shrink-0">
                <Play className="w-5 h-5 text-[#1B7A43] fill-[#1B7A43]" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-base font-bold text-[#431217]">Resume Auto Campaign</h3>
                <p className="text-xs text-[#6B5E59]">
                  Re-enable automated occasion evaluations for this campaign.
                </p>
              </div>
            </div>

            {/* Backend Gap Notice */}
            <div className="p-3.5 bg-[#FFF7E6] border border-[#FFE2B3] rounded-xl text-xs text-[#B26A00] space-y-1.5 leading-relaxed">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Backend Gap: Affected enrollment counts not pre-calculated</span>
              </div>
              <p className="text-[11px]">
                The server resume route does not return pre-computed counts of past missed steps. Any occasion steps whose due times passed while paused will be marked skipped under the <strong>FUTURE_ONLY</strong> policy.
              </p>
            </div>

            {/* Explicit Acknowledgement Checkbox (Strict Non-negotiable requirement) */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] text-xs text-[#2A1D1A] cursor-pointer hover:bg-white transition-all">
              <input
                type="checkbox"
                checked={resumeAcknowledged}
                onChange={(e) => setResumeAcknowledged(e.target.checked)}
                className="mt-0.5 rounded border-[#EAE4DC] text-[#5C1D24] focus:ring-[#5C1D24]"
              />
              <span className="leading-relaxed">
                I acknowledge that resuming follows the <strong>FUTURE_ONLY</strong> behaviour: missed past dates will not be sent.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowResumeModal(false);
                  setResumeAcknowledged(false);
                }}
                className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resumeMutation.mutate()}
                disabled={!resumeAcknowledged || resumeMutation.isPending}
                className="px-4 py-2 rounded-lg bg-[#1B7A43] text-white text-xs font-semibold hover:bg-[#145C32] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resumeMutation.isPending ? 'Resuming...' : 'Confirm Resume'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. PUBLISH REVISION CONFIRMATION DIALOG (Dual Version Copy) */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC] flex items-center justify-center shrink-0">
                <Layers className="w-5 h-5 text-[#5C1D24]" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-base font-bold text-[#431217]">
                  Publish Revision v{campaign.draftVersion}
                </h3>
                {/* Non-negotiable exact copy */}
                <p className="text-xs text-[#5C1D24] font-semibold">
                  New enrollments use the new version; existing enrollments keep the old one.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] space-y-2 leading-relaxed">
              <p>
                Publishing makes Revision <strong>v{campaign.draftVersion}</strong> the active version for all future patron occasion evaluations.
              </p>
              {isPublishingDryRun ? (
                <div className="flex items-center gap-2 text-[11px] text-[#8F6910] pt-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Computing pre-publish review fingerprint...</span>
                </div>
              ) : publishFingerprint ? (
                <div className="text-[11px] font-mono text-[#8F6910] pt-1">
                  Verified Fingerprint: <code>{publishFingerprint}</code>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => publishRevisionMutation.mutate()}
                disabled={isPublishingDryRun || !publishFingerprint || publishRevisionMutation.isPending}
                className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all cursor-pointer disabled:opacity-40"
              >
                {publishRevisionMutation.isPending ? 'Publishing...' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. ARCHIVE CONFIRMATION DIALOG */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FDF2F2] border border-[#F8D7DA] flex items-center justify-center shrink-0">
                <Archive className="w-5 h-5 text-[#9E2A2B]" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-base font-bold text-[#9E2A2B]">Archive Campaign</h3>
                <p className="text-xs text-[#6B5E59]">
                  Permanent deactivation of this campaign track.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] leading-relaxed space-y-1.5">
              <p>
                Archiving permanently cancels all future occasion evaluations, cancels all active patron enrollments, and skips all pending scheduled dispatches.
              </p>
              <p className="text-[11px] text-[#9E2A2B] font-semibold">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                className="px-4 py-2 rounded-lg bg-[#9E2A2B] text-white text-xs font-semibold hover:bg-[#802223] transition-all cursor-pointer disabled:opacity-50"
              >
                {archiveMutation.isPending ? 'Archiving...' : 'Archive Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. WHATSAPP SIMULATOR PREVIEW MODAL (Clearly Labelled Simulator Preview Only) */}
      {showSimulatorModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#EAE4DC]">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#8F6910]">Simulator Preview Only</span>
                <h4 className="font-serif text-sm font-bold text-[#431217]">
                  {stepsToDisplay[simulatorStepIndex]?.stepId || `Step ${simulatorStepIndex + 1}`}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulatorModal(false)}
                className="text-xs text-[#6B5E59] hover:text-[#2A1D1A] p-1 cursor-pointer font-bold"
              >
                ✕ Close
              </button>
            </div>

            {/* Step Selector Tabs */}
            {stepsToDisplay.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {stepsToDisplay.map((st: any, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSimulatorStepIndex(idx)}
                    className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold transition-all cursor-pointer ${
                      simulatorStepIndex === idx
                        ? 'bg-[#5C1D24] text-white'
                        : 'bg-[#FAF8F5] text-[#6B5E59] hover:bg-[#EAE4DC]'
                    }`}
                  >
                    Step {idx + 1}
                  </button>
                ))}
              </div>
            )}

            {/* WhatsApp Device Mock */}
            <div className="bg-[#EFEAE2] p-4 rounded-2xl border border-[#D5CEC4] space-y-2">
              <div className="text-[10px] text-center text-[#6B5E59]">
                {stepsToDisplay[simulatorStepIndex]?.localTime || '10:00'} • Scheduled Delivery
              </div>
              <div className="bg-white rounded-xl p-3.5 shadow-2xs text-xs text-[#2A1D1A] space-y-2 leading-relaxed">
                <p>
                  Namaste Smt. Ananya Rao Ji! Wishing you a very Happy Birthday from all of us at Padmavati Silks! We would be delighted to welcome you to our boutique to explore our new Kanchipuram bridal arrivals.
                </p>
                <div className="text-[10px] text-[#988B86] text-right">
                  {stepsToDisplay[simulatorStepIndex]?.localTime || '10:00'} • ✓✓
                </div>
              </div>
            </div>

            <div className="text-[11px] text-center text-[#988B86]">
              Simulated patron preview. Template ID: <code className="font-mono text-[10px] text-[#5C1D24]">{stepsToDisplay[simulatorStepIndex]?.templateRef?.id || stepsToDisplay[simulatorStepIndex]?.templateId}</code>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function CampaignDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-[#FAF8F5] items-center justify-center text-xs text-[#6B5E59] gap-2">
          <div className="w-5 h-5 border-2 border-[#5C1D24] border-t-transparent rounded-full animate-spin" />
          <span>Loading campaign details...</span>
        </div>
      }
    >
      <CampaignDetailContent />
    </Suspense>
  );
}
