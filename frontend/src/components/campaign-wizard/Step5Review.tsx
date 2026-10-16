'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  generateIdempotencyKey,
  ConflictError,
  ValidationError,
  ApiError
} from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { resolveReasonCode } from '../../lib/reasonCodes';
import { DryRunData, DryRunSamplePlan } from '../../lib/schemas';
import { WhatsAppSimulator } from './WhatsAppSimulator';
import { DateTime } from 'luxon';
import {
  ShieldCheck,
  Play,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Users,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Eye,
  MessageSquare,
  Lock,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

interface Step5ReviewProps {
  campaignId: string;
  campaignName: string;
  draftVersion: number;
  triggerData: any;
  audienceData: any;
  steps: any[];
  rulesData: any;
  autosaveStatus: 'IDLE' | 'SAVING' | 'SAVED' | 'CONFLICT' | 'DIRTY';
  canEdit: boolean;
  onReloadLatest?: () => void;
}

export function Step5Review({
  campaignId,
  campaignName,
  draftVersion,
  triggerData,
  audienceData,
  steps,
  rulesData,
  autosaveStatus,
  canEdit,
  onReloadLatest
}: Step5ReviewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Dry run state
  const [dryRunData, setDryRunData] = useState<DryRunData | null>(null);
  const [dryRunVersion, setDryRunVersion] = useState<number | null>(null);
  const [isDryRunLoading, setIsDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  // Selected sample patron for preview
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);
  const [simulatorStepIndex, setSimulatorStepIndex] = useState<number | null>(null);

  // Fingerprint copy feedback
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);

  // Activation state
  const [activationConflict, setActivationConflict] = useState<string | null>(null);
  const [activationSuccess, setActivationSuccess] = useState<{
    activatedAt: string;
    nextEvaluationAt: string;
    planningResult?: any;
  } | null>(null);

  // Double-click guard
  const isActivatingRef = useRef(false);

  // Auto-run dry run on first entry if not loaded
  const hasAutoRunRef = useRef(false);

  const executeDryRun = async () => {
    try {
      setIsDryRunLoading(true);
      setDryRunError(null);
      const idemp = generateIdempotencyKey('dryrun');
      const response = await api.runDryRun(campaignId, idemp);
      if (response && response.dryRun) {
        setDryRunData(response.dryRun);
        setDryRunVersion(draftVersion);
        setSelectedSampleIndex(0);
      }
    } catch (err: any) {
      setDryRunError(err.message || 'Pre-flight dry-run evaluation failed');
      toast.error('Dry-run projection failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDryRunLoading(false);
    }
  };

  useEffect(() => {
    if (!hasAutoRunRef.current && campaignId) {
      hasAutoRunRef.current = true;
      executeDryRun();
    }
  }, [campaignId]);

  // Stale detection: if draftVersion changed after dry run or autosave is dirty
  const isReviewStale =
    dryRunVersion !== null && (dryRunVersion !== draftVersion || autosaveStatus === 'DIRTY');

  // Copy fingerprint to clipboard
  const handleCopyFingerprint = () => {
    if (dryRunData?.draftFingerprint) {
      navigator.clipboard.writeText(dryRunData.draftFingerprint);
      setCopiedFingerprint(true);
      toast.success('Draft fingerprint copied to clipboard');
      setTimeout(() => setCopiedFingerprint(false), 2000);
    }
  };

  // Activation Mutation
  const activateMutation = useMutation({
    mutationFn: async () => {
      if (isActivatingRef.current) return;
      isActivatingRef.current = true;
      setActivationConflict(null);

      if (!dryRunData?.draftFingerprint) {
        throw new Error('Dry run must be completed before campaign activation.');
      }

      const idemp = generateIdempotencyKey('activate');
      return api.activateCampaign(campaignId, dryRunData.draftFingerprint, draftVersion, idemp);
    },
    onSuccess: (data: any) => {
      isActivatingRef.current = false;
      const timezone = triggerData?.timezone || 'Asia/Kolkata';
      const nowDt = DateTime.now().setZone(timezone);
      // Next scheduled evaluation instant: usually configured localTime today or tomorrow
      const [hourStr, minStr] = (triggerData?.localTime || '10:00').split(':');
      let nextEval = nowDt.set({ hour: parseInt(hourStr, 10), minute: parseInt(minStr, 10), second: 0 });
      if (nextEval <= nowDt) {
        nextEval = nextEval.plus({ days: 1 });
      }

      const formattedNextEval = nextEval.toFormat('dd LLL yyyy, HH:mm') + ` (${timezone})`;
      const formattedActivated = nowDt.toFormat('dd LLL yyyy, HH:mm') + ` (${timezone})`;

      setActivationSuccess({
        activatedAt: formattedActivated,
        nextEvaluationAt: formattedNextEval,
        planningResult: data?.planningResult
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      toast.success('Campaign activated successfully');
    },
    onError: (err: any) => {
      isActivatingRef.current = false;
      if (err instanceof ConflictError || err.status === 409) {
        setActivationConflict(
          'Version conflict (409): The campaign was modified in another session. Please reload the latest revision before activating.'
        );
      } else {
        toast.error(err.message || 'Activation failed');
      }
    }
  });

  const handleActivateClick = () => {
    if (!canEdit || isReviewStale || !dryRunData || activateMutation.isPending) return;
    activateMutation.mutate();
  };

  // Compute first due date across samples
  let firstDueDateLocal: string | null = null;
  let firstDueDateUtc: string | null = null;

  if (dryRunData?.samplePlans && dryRunData.samplePlans.length > 0) {
    const allSteps = dryRunData.samplePlans.flatMap((p) => p.steps || []);
    if (allSteps.length > 0) {
      const sorted = [...allSteps].sort((a, b) => {
        const tA = new Date(a.dueAtUtc).getTime();
        const tB = new Date(b.dueAtUtc).getTime();
        return tA - tB;
      });
      const earliest = sorted[0];
      const tz = triggerData?.timezone || 'Asia/Kolkata';
      const dtUtc = DateTime.fromISO(
        earliest.dueAtUtc instanceof Date ? earliest.dueAtUtc.toISOString() : String(earliest.dueAtUtc),
        { zone: 'utc' }
      );
      firstDueDateUtc = dtUtc.toISO() || null;
      firstDueDateLocal = dtUtc.setZone(tz).toFormat('dd LLL yyyy, HH:mm') + ` (${tz})`;
    }
  }

  const selectedSample: DryRunSamplePlan | undefined = dryRunData?.samplePlans?.[selectedSampleIndex];

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#C99726]" />
            <span>Step 5: Pre-Flight Projection &amp; Campaign Activation</span>
          </h2>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Evaluate live store customer data, inspect rendered message copies, and verify channel audit tokens before launch.
          </p>
        </div>

        {/* Re-run Projection Button */}
        <button
          type="button"
          onClick={executeDryRun}
          disabled={isDryRunLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-xs font-semibold text-[#5C1D24] hover:bg-[#FAF8F5] transition-all cursor-pointer disabled:opacity-50 shadow-2xs shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#C99726] ${isDryRunLoading ? 'animate-spin' : ''}`} />
          <span>{isDryRunLoading ? 'Evaluating...' : 'Re-run Projection'}</span>
        </button>
      </div>

      {/* NON-NEGOTIABLE 1 & 4: Zero Live Sends Honest Boutique Notice */}
      <div className="p-4 rounded-2xl bg-[#FEF9EE] border border-[#F3E0B5] text-xs text-[#8F6910] flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-[#C99726] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-[#431217] block font-serif text-sm">
            Zero live sends — Pre-flight dry-run projection only
          </strong>
          <p className="leading-relaxed text-[#6B5E59]">
            This simulation checks real patron profiles in your boutique database against timing rules, WhatsApp channel permissions, and contact frequency caps. <strong>No WhatsApp messages will be delivered</strong> until you explicitly click &ldquo;Activate campaign&rdquo;.
          </p>
        </div>
      </div>

      {/* Conflict Banner (409) */}
      {activationConflict && (
        <div className="p-4 rounded-2xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
            <span>{activationConflict}</span>
          </div>
          {onReloadLatest && (
            <button
              type="button"
              onClick={() => {
                setActivationConflict(null);
                onReloadLatest();
              }}
              className="px-3 py-1 rounded bg-[#B26A00] text-white font-semibold hover:bg-[#8F6910] cursor-pointer"
            >
              Reload latest
            </button>
          )}
        </div>
      )}

      {/* Review Stale Banner */}
      {isReviewStale && (
        <div className="p-4 rounded-2xl bg-[#FFF4E5] border border-[#FFD8A8] text-xs text-[#D9480F] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#D9480F] shrink-0" />
            <div>
              <strong>Review Out of Date:</strong> Draft was modified after the last projection (Draft Revision v{draftVersion}).
              Re-run the dry run to re-compute the required activation fingerprint.
            </div>
          </div>
          <button
            type="button"
            onClick={executeDryRun}
            disabled={isDryRunLoading}
            className="px-3.5 py-1.5 rounded-lg bg-[#D9480F] text-white font-semibold hover:bg-[#C22500] shrink-0 cursor-pointer text-xs"
          >
            Re-run Now
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isDryRunLoading && !dryRunData && (
        <div className="space-y-4">
          <div className="h-28 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6" />
          <div className="h-64 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6" />
        </div>
      )}

      {/* Dry Run Error */}
      {dryRunError && !dryRunData && (
        <div className="p-6 rounded-2xl bg-[#FDF2F2] border border-[#F8D7DA] text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h3 className="font-serif text-sm font-bold text-[#9E2A2B]">Dry-run evaluation failed</h3>
          <p className="text-xs text-[#6B5E59]">{dryRunError}</p>
          <button
            type="button"
            onClick={executeDryRun}
            className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
          >
            Retry Projection
          </button>
        </div>
      )}

      {/* Main Review Results */}
      {dryRunData && (
        <div className="space-y-6">
          {/* Fingerprint & Timing Card */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#8F6910]">
                Cryptographic Review Fingerprint (Required for Activation)
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs font-mono font-bold text-[#431217] bg-[#FAF8F5] px-2.5 py-1 rounded-lg border border-[#EAE4DC]">
                  {dryRunData.draftFingerprint}
                </code>
                <button
                  type="button"
                  onClick={handleCopyFingerprint}
                  className="inline-flex items-center gap-1 text-[11px] text-[#6B5E59] hover:text-[#5C1D24] px-2 py-0.5 rounded hover:bg-[#FAF8F5] border border-transparent hover:border-[#EAE4DC] cursor-pointer"
                  title="Copy review fingerprint"
                >
                  {copiedFingerprint ? <Check className="w-3.5 h-3.5 text-[#1B7A43]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedFingerprint ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="text-[11px] text-[#988B86]">
                Evaluated at {DateTime.fromISO(String(dryRunData.evaluatedAt)).setZone(triggerData?.timezone || 'Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm:ss')} • Draft v{dryRunVersion}
              </div>
            </div>

            {/* First Scheduled Dispatch */}
            <div className="md:text-right space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#8F6910]">
                First Scheduled Dispatch
              </span>
              {firstDueDateLocal ? (
                <div>
                  <div
                    className="text-xs font-bold text-[#2A1D1A] cursor-help flex md:justify-end items-center gap-1"
                    title={`UTC Instant: ${firstDueDateUtc || ''}`}
                  >
                    <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>{firstDueDateLocal}</span>
                  </div>
                  <div className="text-[10px] font-mono text-[#988B86]">
                    UTC: {firstDueDateUtc ? DateTime.fromISO(firstDueDateUtc).toFormat('dd LLL, HH:mm UTC') : '—'}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[#6B5E59]">
                  Evaluates at <strong>{triggerData?.localTime || '10:00'} ({triggerData?.timezone || 'Asia/Kolkata'})</strong> upon first patron occasion match.
                </div>
              )}
            </div>
          </div>

          {/* Counts Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-[#988B86]">Total Store Patrons</div>
              <div className="text-2xl font-bold font-serif text-[#2A1D1A] mt-1 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#6B5E59]" />
                <span>{dryRunData.summary.totalEvaluated}</span>
              </div>
              <div className="text-[11px] text-[#6B5E59] mt-1">Patrons in store CRM</div>
            </div>

            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-[#1B7A43]">Eligible for Occasion Track</div>
              <div className="text-2xl font-bold font-serif text-[#1B7A43] mt-1 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#1B7A43]" />
                <span>{dryRunData.summary.eligibleCount}</span>
              </div>
              <div className="text-[11px] text-[#6B5E59] mt-1">
                Occasion within 30 days &amp; passed gates
              </div>
            </div>

            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-[#9E2A2B]">Excluded from Current Track</div>
              <div className="text-2xl font-bold font-serif text-[#9E2A2B] mt-1 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[#9E2A2B]" />
                <span>{dryRunData.summary.excludedCount}</span>
              </div>
              <div className="text-[11px] text-[#6B5E59] mt-1">Due to dates or safety rules</div>
            </div>
          </div>

          {/* ZERO MATCHES IS A WARNING, NOT A BLOCK */}
          {dryRunData.summary.eligibleCount === 0 && (
            <div className="p-4 rounded-2xl bg-[#FEF9EE] border border-[#F3E0B5] text-xs text-[#8F6910] flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#C99726] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#431217] block font-serif text-sm mb-0.5">
                  Occasion Horizon Notice: 0 matching patrons currently in 30-day window
                </strong>
                <p className="leading-relaxed text-[#6B5E59]">
                  No patrons currently have a birthday or anniversary within the next 30 calendar days that match your criteria. <strong>You can still safely activate this campaign.</strong> As new patrons are registered or upcoming occasion dates enter the 30-day window, the autonomous planner will schedule them automatically.
                </p>
              </div>
            </div>
          )}

          {/* Reason Breakdown Accordion / Grid */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="font-serif text-sm font-bold text-[#431217] flex items-center gap-2">
                <span>Patron Eligibility &amp; Exclusion Reason Breakdown</span>
              </h3>
              <p className="text-xs text-[#6B5E59] mt-0.5">
                Every customer evaluation outcome is mapped through the central boutique reason dictionary.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(dryRunData.reasonBreakdown)
                .filter(([_, count]) => count > 0)
                .map(([code, count]) => {
                  const resolved = resolveReasonCode(code);
                  const isEligible = code === 'ELIGIBLE';

                  return (
                    <div
                      key={code}
                      className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 ${
                        isEligible
                          ? 'bg-[#EBF7EE] border-[#C3E8CB]'
                          : 'bg-[#FAF8F5] border-[#EAE4DC]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                                isEligible
                                  ? 'bg-[#1B7A43] text-white'
                                  : resolved.category === 'blocked'
                                  ? 'bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]'
                                  : resolved.category === 'expired'
                                  ? 'bg-[#F3EFE8] text-[#5C1D24]'
                                  : 'bg-[#EAE4DC] text-[#6B5E59]'
                              }`}
                            >
                              {resolved.category}
                            </span>
                            <span className="font-mono text-[10px] text-[#988B86]">{code}</span>
                          </div>
                          <p className="text-xs font-semibold text-[#2A1D1A] mt-1">{resolved.sentence}</p>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`text-sm font-serif font-bold ${
                              isEligible ? 'text-[#1B7A43]' : 'text-[#431217]'
                            }`}
                          >
                            {count}
                          </span>
                          <span className="text-[10px] text-[#988B86] block">
                            {dryRunData.summary.totalEvaluated > 0
                              ? `${Math.round((count / dryRunData.summary.totalEvaluated) * 100)}%`
                              : '0%'}
                          </span>
                        </div>
                      </div>

                      {/* Fix Owner badge if actionable */}
                      {resolved.fixOwner !== 'none' && (
                        <div className="text-[10px] text-[#8F6910] flex items-center gap-1 border-t border-[#EAE4DC]/60 pt-1.5 mt-1">
                          <span>Actionable fix owner:</span>
                          <strong className="capitalize">{resolved.fixOwner.replace(/_/g, ' ')}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Sample Messages Rendered from Real Data */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="font-serif text-sm font-bold text-[#431217]">
                  Sample Messages Rendered from Real Patron Data
                </h3>
                <p className="text-xs text-[#6B5E59] mt-0.5">
                  Projections evaluated against real patrons in your CRM with approved Meta templates.
                </p>
              </div>

              {dryRunData.samplePlans.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#6B5E59]">Sample:</span>
                  <div className="flex items-center gap-1">
                    {dryRunData.samplePlans.map((sample, idx) => (
                      <button
                        key={sample.customerId || idx}
                        type="button"
                        onClick={() => setSelectedSampleIndex(idx)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                          selectedSampleIndex === idx
                            ? 'bg-[#5C1D24] text-white shadow-2xs'
                            : 'bg-[#FAF8F5] text-[#6B5E59] hover:bg-[#EAE4DC]'
                        }`}
                      >
                        {sample.customerName.split(' ')[0] || `Patron ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedSample ? (
              <div className="space-y-4 pt-2">
                {/* Patron Details Card */}
                <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#8F6910] block">Target Patron</span>
                    <strong className="text-sm font-serif text-[#431217]">{selectedSample.customerName}</strong>
                    <span className="text-[#6B5E59] ml-2 text-[11px]">
                      Occasion: <strong>{selectedSample.occasionDate}</strong> (Date-only; zero UTC distortion)
                    </span>
                  </div>
                  <div className="text-[11px] text-[#988B86]">
                    Plan steps: {selectedSample.steps?.length || 0}
                  </div>
                </div>

                {/* Steps Message Previews */}
                <div className="space-y-3">
                  {selectedSample.steps.map((st, sIdx) => {
                    const tz = triggerData?.timezone || 'Asia/Kolkata';
                    const localDt = DateTime.fromISO(
                      st.dueAtUtc instanceof Date ? st.dueAtUtc.toISOString() : String(st.dueAtUtc),
                      { zone: 'utc' }
                    ).setZone(tz);
                    const localFormatted = localDt.toFormat('dd LLL yyyy, HH:mm');

                    return (
                      <div
                        key={st.stepId || sIdx}
                        className="border border-[#EAE4DC] rounded-xl p-4 bg-white space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#FAF8F5] text-[#5C1D24] border border-[#EAE4DC]">
                              Step {sIdx + 1}: {st.stepId}
                            </span>
                            <span
                              className="text-xs text-[#6B5E59] cursor-help flex items-center gap-1"
                              title={`UTC Instant: ${String(st.dueAtUtc)}`}
                            >
                              <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                              <span>{localFormatted} ({tz})</span>
                            </span>
                          </div>

                          {/* Simulator Preview Button */}
                          <button
                            type="button"
                            onClick={() => setSimulatorStepIndex(sIdx)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C1D24] hover:underline cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#C99726]" />
                            <span>Simulator Preview</span>
                          </button>
                        </div>

                        {/* WhatsApp Bubble Preview */}
                        <div className="bg-[#EFEAE2] p-4 rounded-xl border border-[#D5CEC4] max-w-lg">
                          <div className="bg-white rounded-lg p-3 shadow-2xs text-xs text-[#2A1D1A] space-y-2 leading-relaxed">
                            <p className="whitespace-pre-wrap">{st.renderedPreview}</p>
                            <div className="text-[10px] text-[#988B86] text-right">
                              {st.localTime} • ✓✓
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs text-[#6B5E59]">
                No sample previews available for current selection.
              </div>
            )}
          </div>

          {/* ACTIVATION SECTION */}
          <div className="bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-serif text-base font-bold text-[#431217]">
                  Ready to Launch Campaign
                </h3>
                <p className="text-xs text-[#6B5E59] mt-0.5">
                  Activation registers the campaign with the autonomous evaluation scheduler.
                </p>
              </div>

              {/* Primary Action: Activate Campaign */}
              <div className="flex items-center gap-2">
                {!canEdit ? (
                  <div className="flex items-center gap-1.5 text-xs text-[#6B5E59] bg-white px-3.5 py-2 rounded-lg border border-[#EAE4DC]">
                    <Lock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>Owner or Manager role required to activate</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleActivateClick}
                    disabled={isReviewStale || activateMutation.isPending || !dryRunData}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#5C1D24] text-white text-xs font-bold hover:bg-[#73232C] transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {activateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#F3E0B5]" />
                        <span>Activating Campaign...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 text-[#F3E0B5] fill-[#F3E0B5]" />
                        <span>Activate campaign</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Non-negotiable 4 Wording Check */}
            <div className="text-[11px] text-[#988B86] flex items-center gap-2 pt-1 border-t border-[#EAE4DC]/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1B7A43]" />
              <span>
                Primary action is <strong>&ldquo;Activate campaign&rdquo;</strong> (initiates autonomous scheduling; zero immediate bulk sends).
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Activation Success Modal */}
      {activationSuccess && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] border border-[#C3E8CB] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-[#1B7A43]" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-lg font-bold text-[#431217]">
                  Campaign Activated Successfully
                </h3>
                <p className="text-xs text-[#1B7A43] font-semibold">
                  Active - next evaluation at {activationSuccess.nextEvaluationAt}
                </p>
              </div>
            </div>

            <div className="p-4 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] space-y-2 leading-relaxed">
              <p>
                The campaign is now live in your boutique workspace. The scheduler evaluates upcoming patron birthdays and anniversaries automatically at configured dispatch hours.
              </p>
              {activationSuccess.planningResult && (
                <div className="text-[11px] text-[#2A1D1A] pt-1 border-t border-[#EAE4DC]">
                  Initial planning run: <strong>{activationSuccess.planningResult.plannedEnrollments ?? 0} enrollments planned</strong>.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => router.push(`/campaigns/${campaignId}`)}
                className="px-5 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-bold hover:bg-[#73232C] transition-all cursor-pointer shadow-xs"
              >
                View Campaign Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Simulator Modal for Step Preview */}
      {simulatorStepIndex !== null && selectedSample && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#EAE4DC] rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#EAE4DC]">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#8F6910]">WhatsApp Preview</span>
                <h4 className="font-serif text-sm font-bold text-[#431217]">
                  Step {simulatorStepIndex + 1}: {selectedSample.steps[simulatorStepIndex]?.stepId}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSimulatorStepIndex(null)}
                className="text-xs text-[#6B5E59] hover:text-[#2A1D1A] p-1 cursor-pointer font-bold"
              >
                ✕ Close
              </button>
            </div>

            <div className="flex justify-center">
              <div className="w-full bg-[#EFEAE2] p-4 rounded-2xl border border-[#D5CEC4] space-y-2">
                <div className="text-[10px] text-center text-[#6B5E59] font-medium">
                  {selectedSample.steps[simulatorStepIndex]?.localTime} • Scheduled
                </div>
                <div className="bg-white rounded-xl p-3.5 shadow-2xs text-xs text-[#2A1D1A] space-y-2 leading-relaxed">
                  <p className="whitespace-pre-wrap">
                    {selectedSample.steps[simulatorStepIndex]?.renderedPreview}
                  </p>
                  <div className="text-[10px] text-[#988B86] text-right">
                    {selectedSample.steps[simulatorStepIndex]?.localTime} • ✓✓
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-center text-[#988B86]">
              Previewing rendered template for patron <strong>{selectedSample.customerName}</strong>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
