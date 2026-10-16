'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { api, generateIdempotencyKey } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../lib/useAuth';
import { resolveReasonCode, ReasonCategory } from '../../lib/reasonCodes';
import { canResolveHolds } from '../../lib/roles';
import { ExecutionStatusBadge } from '../../components/campaign-activity/ExecutionStatusBadge';
import { ResolveHoldDialog } from '../../components/campaign-activity/ResolveHoldDialog';
import { MarkGoalDialog } from '../../components/campaign-activity/MarkGoalDialog';
import { CustomerTimelineDialog } from '../../components/campaign-activity/CustomerTimelineDialog';
import {
  Activity,
  AlertCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MessageSquare,
  UserCheck,
  Search,
  Filter,
  Eye,
  ShoppingBag,
  ExternalLink
} from 'lucide-react';
import { DateTime } from 'luxon';

function ActivityStreamContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const canAct = canResolveHolds(user?.role);

  // URL-synced query filters
  const statusFilter = searchParams.get('status') || 'all';
  const reasonFilter = searchParams.get('reason') || 'all';
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');

  const updateFilter = (key: string, value: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (value === 'all' || !value) {
      current.delete(key);
    } else {
      current.set(key, value);
    }
    const qStr = current.toString();
    router.replace(`/activity${qStr ? `?${qStr}` : ''}`, { scroll: false });
  };

  // Dialog States
  const [selectedResolveHold, setSelectedResolveHold] = useState<{
    id: string;
    customerName?: string | null;
    maskedPhone?: string | null;
    heldAt?: any;
  } | null>(null);

  const [selectedMarkGoal, setSelectedMarkGoal] = useState<{
    id: string;
    customerName?: string | null;
    campaignName?: string | null;
    occurrenceId?: string | null;
  } | null>(null);

  const [selectedTimelineCustomer, setSelectedTimelineCustomer] = useState<{
    id: string;
    name?: string | null;
  } | null>(null);

  // Fetch Live Campaign Activity Stream
  const {
    data: activityData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.activity.all,
    queryFn: () => api.getCampaignActivity(),
    refetchInterval: 15000 // Poll every 15s for new dispatches
  });

  const rawActivities = activityData?.activity || [];

  // Filter activities client-side
  const filteredActivities = rawActivities.filter((item) => {
    const isHeld = Boolean(item.replyHoldAt || item.outcomeReason === 'SKIPPED_REPLY_HOLD');

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'HELD') {
        if (!isHeld) return false;
      } else if (item.state !== statusFilter) {
        return false;
      }
    }

    // Reason category filter
    if (reasonFilter !== 'all') {
      const def = resolveReasonCode(item.outcomeReason);
      if (def.category !== reasonFilter) return false;
    }

    // Search filter across campaign, patron ID, explanation
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const camp = (item.campaignName || '').toLowerCase();
      const patron = (item.customerId || '').toLowerCase();
      const exp = (item.explanation || '').toLowerCase();
      const step = (item.stepId || '').toLowerCase();
      if (!camp.includes(q) && !patron.includes(q) && !exp.includes(q) && !step.includes(q)) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Title & Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-[#431217]">
            Campaign Activity Stream
          </h1>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Live audit record of dispatch evaluations, delivery receipts, and staff conversation holds.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-xs font-semibold text-[#2A1D1A] hover:bg-[#FAF8F5] transition-all cursor-pointer shadow-2xs self-start"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#6B5E59]" />
          <span>Refresh Stream</span>
        </button>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full md:max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#988B86] absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              updateFilter('search', e.target.value);
            }}
            placeholder="Search campaign, patron or step..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden text-[#2A1D1A]"
          />
        </div>

        {/* Filter Selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#988B86]">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] text-[#2A1D1A] outline-hidden focus:border-[#5C1D24]"
            >
              <option value="all">All States</option>
              <option value="HELD">Held for Staff</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="DEFERRED">Deferred</option>
              <option value="SKIPPED">Skipped</option>
              <option value="PROVIDER_ACCEPTED">Accepted</option>
              <option value="DELIVERED">Delivered</option>
              <option value="READ">Read</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {/* Reason Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#988B86]">Reason:</span>
            <select
              value={reasonFilter}
              onChange={(e) => updateFilter('reason', e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] text-[#2A1D1A] outline-hidden focus:border-[#5C1D24]"
            >
              <option value="all">All Categories</option>
              <option value="skipped">Skipped</option>
              <option value="deferred">Deferred</option>
              <option value="blocked">Blocked</option>
              <option value="expired">Expired</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stream List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-8 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h3 className="text-xs font-bold text-[#9E2A2B]">Unable to load activity stream</h3>
          <p className="text-xs text-[#6B5E59]">{(error as Error)?.message || 'Service offline'}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="p-10 bg-white border border-[#EAE4DC] rounded-2xl text-center space-y-3">
          <Activity className="w-8 h-8 text-[#C99726] mx-auto" />
          <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
            No campaign activity matches criteria
          </h3>
          <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all' || reasonFilter !== 'all'
              ? 'Try clearing your search or filter criteria.'
              : 'Active campaigns will log every evaluated step, customer reply, and delivery receipt here automatically.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActivities.map((item) => {
            const reasonDef = resolveReasonCode(item.outcomeReason);
            const isHeld = Boolean(item.replyHoldAt || item.outcomeReason === 'SKIPPED_REPLY_HOLD');
            const isGoalReached = Boolean(item.goalReachedAt);

            // Timezone conversion with UTC instant hover (Non-negotiable 9)
            const dueInstant = item.dueAt ? DateTime.fromISO(item.dueAt) : null;
            const localDue = dueInstant
              ? dueInstant.setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm')
              : 'Immediate';
            const utcDue = dueInstant ? dueInstant.toUTC().toISO() : '';

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-2xl p-4 shadow-2xs transition-all ${
                  isHeld
                    ? 'border-[#F3E0B5] bg-[#FEF9EE]/50 ring-1 ring-[#F3E0B5]'
                    : 'border-[#EAE4DC] hover:border-[#5C1D24]'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-[#2A1D1A]">
                        {item.campaignName}
                      </span>
                      <span className="text-[10px] text-[#988B86]">
                        Step: {item.stepId || 'dispatch'}
                      </span>

                      {/* Clickable Patron ID linking to Customer Timeline */}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTimelineCustomer({
                            id: item.customerId,
                            name: `Patron ${item.customerId}`
                          })
                        }
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE4DC] text-[#5C1D24] hover:underline flex items-center gap-1 cursor-pointer"
                        title="Click to view patron lifecycle timeline"
                      >
                        <span>Patron: {item.customerId}</span>
                        <Eye className="w-3 h-3 text-[#C99726]" />
                      </button>

                      {/* Status Badges */}
                      <ExecutionStatusBadge
                        status={item.state}
                        outcomeReason={item.outcomeReason}
                        isHeld={isHeld}
                      />

                      {isGoalReached && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF7EE] text-[#1B7A43] border border-[#C3E8CB]">
                          <CheckCircle2 className="w-3 h-3 text-[#1B7A43]" />
                          Goal Completed
                        </span>
                      )}
                    </div>

                    {/* Plain-English explanation sentence (Non-negotiable 8) */}
                    <p className="text-xs text-[#6B5E59] leading-relaxed">
                      {reasonDef.sentence}
                    </p>
                  </div>

                  {/* Right column: Timezone display & Hold resolution */}
                  <div className="flex items-center gap-3 text-xs shrink-0 flex-wrap">
                    <div
                      className="text-right cursor-help"
                      title={utcDue ? `UTC Instant: ${utcDue}` : undefined}
                    >
                      <div className="flex items-center gap-1 text-[#2A1D1A] font-medium sm:justify-end">
                        <Clock className="w-3 h-3 text-[#6B5E59]" />
                        <span>{localDue}</span>
                      </div>
                      <span className="text-[10px] text-[#988B86]">Asia/Kolkata</span>
                    </div>

                    {/* Timeline Action */}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTimelineCustomer({
                          id: item.customerId,
                          name: `Patron ${item.customerId}`
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-[#EAE4DC] text-[#6B5E59] hover:bg-[#FAF8F5] text-[11px] font-medium cursor-pointer"
                    >
                      Timeline
                    </button>

                    {/* Staff Actions: Resolve Hold Dialog (Visible to STAFF too!) */}
                    {isHeld && item.enrollmentId && canAct && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedResolveHold({
                            id: item.enrollmentId!,
                            customerName: `Patron ${item.customerId}`,
                            heldAt: item.replyHoldAt
                          })
                        }
                        className="px-3 py-1 rounded-md bg-[#5C1D24] text-white hover:bg-[#73232C] text-[11px] font-semibold flex items-center gap-1 shadow-2xs cursor-pointer"
                      >
                        <UserCheck className="w-3 h-3 text-[#F3E0B5]" />
                        <span>Resolve Hold</span>
                      </button>
                    )}

                    {/* Staff Actions: Mark Goal Dialog (Visible to STAFF too!) */}
                    {!isGoalReached && item.enrollmentId && canAct && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMarkGoal({
                            id: item.enrollmentId!,
                            customerName: `Patron ${item.customerId}`,
                            campaignName: item.campaignName,
                            occurrenceId: item.occurrenceId
                          })
                        }
                        className="px-2.5 py-1 rounded-md border border-[#EAE4DC] text-[#1B7A43] hover:bg-[#EBF7EE] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        title="Mark occasion purchase/goal"
                      >
                        <CheckCircle2 className="w-3 h-3 text-[#1B7A43]" />
                        <span>Mark Goal</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolve Hold Dialog */}
      {selectedResolveHold && (
        <ResolveHoldDialog
          enrollmentId={selectedResolveHold.id}
          customerName={selectedResolveHold.customerName}
          maskedPhone={selectedResolveHold.maskedPhone}
          heldAt={selectedResolveHold.heldAt}
          onClose={() => setSelectedResolveHold(null)}
          onSuccess={() => refetch()}
        />
      )}

      {/* Mark Goal Dialog */}
      {selectedMarkGoal && (
        <MarkGoalDialog
          enrollmentId={selectedMarkGoal.id}
          customerName={selectedMarkGoal.customerName}
          campaignName={selectedMarkGoal.campaignName}
          occurrenceId={selectedMarkGoal.occurrenceId}
          onClose={() => setSelectedMarkGoal(null)}
          onSuccess={() => refetch()}
        />
      )}

      {/* Customer Timeline Dialog */}
      {selectedTimelineCustomer && (
        <CustomerTimelineDialog
          customerId={selectedTimelineCustomer.id}
          customerName={selectedTimelineCustomer.name}
          onClose={() => setSelectedTimelineCustomer(null)}
        />
      )}
    </div>
  );
}

export default function ActivityStreamPage() {
  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Activity Stream']}>
      <Suspense
        fallback={
          <div className="flex min-h-[300px] items-center justify-center text-xs text-[#6B5E59] gap-2">
            <div className="w-4 h-4 border-2 border-[#5C1D24] border-t-transparent rounded-full animate-spin" />
            <span>Loading activity stream...</span>
          </div>
        }
      >
        <ActivityStreamContent />
      </Suspense>
    </AppShell>
  );
}
