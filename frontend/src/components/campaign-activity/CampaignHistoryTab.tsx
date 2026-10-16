'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { ExecutionStatusBadge } from './ExecutionStatusBadge';
import { CustomerTimelineDialog } from './CustomerTimelineDialog';
import { resolveReasonCode } from '../../lib/reasonCodes';
import { CampaignHistoryItem } from '../../lib/schemas';
import { DateTime } from 'luxon';
import {
  History,
  Search,
  Filter,
  Clock,
  AlertCircle,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface CampaignHistoryTabProps {
  campaignId: string;
  timezone: string;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  reasonFilter: string;
  onReasonFilterChange: (reason: string) => void;
  page: number;
  onPageChange: (page: number) => void;
}

export function CampaignHistoryTab({
  campaignId,
  timezone = 'Asia/Kolkata',
  statusFilter,
  onStatusFilterChange,
  reasonFilter,
  onReasonFilterChange,
  page,
  onPageChange
}: CampaignHistoryTabProps) {
  // Search input
  const [searchTerm, setSearchTerm] = useState('');

  // Selected customer for timeline preview
  const [selectedTimelineCustomer, setSelectedTimelineCustomer] = useState<{
    id: string;
    name?: string | null;
    phone?: string | null;
  } | null>(null);

  // Fetch paginated execution history
  const {
    data: historyData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.campaigns.history(campaignId, page, 20),
    queryFn: () => api.getHistory(campaignId, page, 20)
  });

  const rawHistory: CampaignHistoryItem[] = historyData?.history || [];
  const pagination = historyData?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

  // Filter history records
  const filteredHistory = rawHistory.filter((item) => {
    // Status filter
    if (statusFilter !== 'all') {
      if (item.state !== statusFilter) return false;
    }

    // Reason category filter
    if (reasonFilter !== 'all') {
      const def = resolveReasonCode(item.outcomeReason);
      if (def.category !== reasonFilter) return false;
    }

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const name = (item.customerName || '').toLowerCase();
      const phone = (item.maskedPhone || '').toLowerCase();
      const step = (item.stepId || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !step.includes(q)) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-[#EAE4DC] p-4 rounded-2xl shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#988B86] absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search patron or step..."
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
              onChange={(e) => {
                onStatusFilterChange(e.target.value);
                onPageChange(1);
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] text-[#2A1D1A] outline-hidden focus:border-[#5C1D24]"
            >
              <option value="all">All States</option>
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
              onChange={(e) => {
                onReasonFilterChange(e.target.value);
                onPageChange(1);
              }}
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

          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
            title="Refresh history"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Execution History List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-white border border-[#F8D7DA] rounded-2xl space-y-3">
          <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h4 className="font-serif text-sm font-bold text-[#9E2A2B]">Unable to load step execution history</h4>
          <p className="text-xs text-[#6B5E59]">{(error as Error)?.message || 'Service offline'}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="p-10 text-center bg-white border border-[#EAE4DC] rounded-2xl space-y-2">
          <History className="w-8 h-8 text-[#C99726] mx-auto" />
          <h4 className="font-serif text-sm font-bold text-[#2A1D1A]">No executions recorded</h4>
          <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all' || reasonFilter !== 'all'
              ? 'No records match the active search or category filters.'
              : 'Executions and delivery status updates will appear here automatically as scheduled dispatches run.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredHistory.map((item) => {
            const reasonDef = resolveReasonCode(item.outcomeReason);
            const dueDt = item.dueAt ? DateTime.fromISO(String(item.dueAt)) : null;
            const localDue = dueDt
              ? dueDt.setZone(timezone).toFormat('dd LLL yyyy, HH:mm')
              : 'Immediate';
            const utcDue = dueDt ? dueDt.toUTC().toISO() : null;

            return (
              <div
                key={item.id}
                className="bg-white border border-[#EAE4DC] rounded-xl p-3.5 shadow-2xs hover:border-[#C99726] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTimelineCustomer({
                          id: item.id,
                          name: item.customerName,
                          phone: item.maskedPhone
                        })
                      }
                      className="font-serif font-bold text-[#431217] hover:underline flex items-center gap-1 cursor-pointer"
                      title="View timeline"
                    >
                      <span>{item.customerName || 'Boutique Patron'}</span>
                      <Eye className="w-3 h-3 text-[#C99726]" />
                    </button>

                    {item.maskedPhone && (
                      <code className="text-[11px] font-mono text-[#5C1D24] bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#EAE4DC]">
                        {item.maskedPhone}
                      </code>
                    )}

                    <span className="text-[10px] text-[#6B5E59] font-medium">
                      Step: <code className="font-mono text-[#2A1D1A]">{item.stepId}</code>
                    </span>

                    <ExecutionStatusBadge
                      status={item.state}
                      outcomeReason={item.outcomeReason}
                    />
                  </div>

                  {item.outcomeReason && (
                    <p className="text-[11px] text-[#6B5E59]">
                      {reasonDef.sentence}
                    </p>
                  )}
                </div>

                {/* Right: Scheduled / Updated Time */}
                <div className="text-right shrink-0">
                  <div
                    className="cursor-help flex sm:justify-end items-center gap-1 text-[#2A1D1A] font-semibold"
                    title={utcDue ? `UTC Instant: ${utcDue}` : undefined}
                  >
                    <Clock className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>{localDue}</span>
                  </div>
                  <span className="text-[10px] text-[#988B86]">({timezone})</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-[#EAE4DC] text-xs text-[#6B5E59]">
          <div>
            Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.total} total)
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
              className="px-2.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-xs disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-3 font-semibold text-[#2A1D1A]">{pagination.page}</span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
              className="px-2.5 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-xs disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Customer Timeline Dialog */}
      {selectedTimelineCustomer && (
        <CustomerTimelineDialog
          customerId={selectedTimelineCustomer.id}
          customerName={selectedTimelineCustomer.name}
          maskedPhone={selectedTimelineCustomer.phone}
          onClose={() => setSelectedTimelineCustomer(null)}
        />
      )}
    </div>
  );
}
