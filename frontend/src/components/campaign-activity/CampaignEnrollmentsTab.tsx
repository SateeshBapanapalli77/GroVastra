'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { ExecutionStatusBadge } from './ExecutionStatusBadge';
import { ResolveHoldDialog } from './ResolveHoldDialog';
import { MarkGoalDialog } from './MarkGoalDialog';
import { CustomerTimelineDialog } from './CustomerTimelineDialog';
import { CampaignEnrollmentItem } from '../../lib/schemas';
import { canResolveHolds } from '../../lib/roles';
import { useAuth } from '../../lib/useAuth';
import { DateTime } from 'luxon';
import {
  Users,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  UserCheck,
  ShoppingBag
} from 'lucide-react';

interface CampaignEnrollmentsTabProps {
  campaignId: string;
  campaignName: string;
  timezone: string;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  page: number;
  onPageChange: (page: number) => void;
}

export function CampaignEnrollmentsTab({
  campaignId,
  campaignName,
  timezone = 'Asia/Kolkata',
  statusFilter,
  onStatusFilterChange,
  page,
  onPageChange
}: CampaignEnrollmentsTabProps) {
  const { user } = useAuth();
  const canAct = canResolveHolds(user?.role);

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');

  // Dialog states
  const [selectedResolveHold, setSelectedResolveHold] = useState<{
    id: string;
    customerName?: string | null;
    maskedPhone?: string | null;
    heldAt?: any;
  } | null>(null);

  const [selectedMarkGoal, setSelectedMarkGoal] = useState<{
    id: string;
    customerName?: string | null;
    maskedPhone?: string | null;
    occurrenceId?: string | null;
  } | null>(null);

  const [selectedTimelineCustomer, setSelectedTimelineCustomer] = useState<{
    id: string;
    name?: string | null;
    phone?: string | null;
  } | null>(null);

  // Fetch paginated enrollments
  const {
    data: enrollmentsData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.campaigns.enrollments(campaignId, page, 20),
    queryFn: () => api.getEnrollments(campaignId, page, 20)
  });

  const rawEnrollments: CampaignEnrollmentItem[] = enrollmentsData?.enrollments || [];
  const pagination = enrollmentsData?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

  // Client-side filtering across status and search
  const filteredEnrollments = rawEnrollments.filter((enr) => {
    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'HELD') {
        if (!enr.replyHoldAt) return false;
      } else if (enr.status !== statusFilter) {
        return false;
      }
    }

    // Search filter (customer name, masked phone, occurrenceId)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const name = `${enr.customer?.firstName || ''} ${enr.customer?.lastName || ''}`.toLowerCase();
      const phone = (enr.customer?.maskedPhone || '').toLowerCase();
      const occ = (enr.occurrenceId || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !occ.includes(q)) {
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
            placeholder="Search patron or occurrence..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden text-[#2A1D1A]"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-[#988B86] mr-1">Status:</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'ACTIVE', label: 'Active' },
            { id: 'HELD', label: 'Held for Staff' },
            { id: 'COMPLETED', label: 'Completed' },
            { id: 'CANCELLED', label: 'Cancelled' }
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onStatusFilterChange(f.id);
                onPageChange(1);
              }}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === f.id
                  ? 'bg-[#5C1D24] text-white shadow-2xs'
                  : 'bg-[#FAF8F5] text-[#6B5E59] hover:bg-[#EAE4DC]'
              }`}
            >
              {f.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[#6B5E59] hover:text-[#2A1D1A] ml-1 cursor-pointer"
            title="Refresh enrollments"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Table or Card List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-white border border-[#F8D7DA] rounded-2xl space-y-3">
          <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h4 className="font-serif text-sm font-bold text-[#9E2A2B]">Unable to load campaign enrollments</h4>
          <p className="text-xs text-[#6B5E59]">{(error as Error)?.message || 'Service offline'}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : filteredEnrollments.length === 0 ? (
        <div className="p-10 text-center bg-white border border-[#EAE4DC] rounded-2xl space-y-2">
          <Users className="w-8 h-8 text-[#C99726] mx-auto" />
          <h4 className="font-serif text-sm font-bold text-[#2A1D1A]">No enrollments match criteria</h4>
          <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all'
              ? 'Try adjusting your search terms or status filters.'
              : 'Patrons will appear here as their birthday or anniversary approaches and is scheduled by the autonomous planner.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEnrollments.map((enr) => {
            const customerName = enr.customer
              ? `${enr.customer.firstName || ''} ${enr.customer.lastName || ''}`.trim()
              : null;
            const isHeld = Boolean(enr.replyHoldAt);
            const isGoalReached = Boolean(enr.goalReachedAt);

            const createdDt = enr.createdAt ? DateTime.fromISO(String(enr.createdAt)) : null;
            const localCreated = createdDt
              ? createdDt.setZone(timezone).toFormat('dd LLL yyyy, HH:mm')
              : null;
            const utcCreated = createdDt ? createdDt.toUTC().toISO() : null;

            return (
              <div
                key={enr.id}
                className={`bg-white border rounded-2xl p-4 shadow-2xs transition-all ${
                  isHeld
                    ? 'border-[#F3E0B5] bg-[#FEF9EE]/40 ring-1 ring-[#F3E0B5]'
                    : 'border-[#EAE4DC] hover:border-[#C99726]'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Left Column: Patron Info */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTimelineCustomer({
                            id: enr.customerId,
                            name: customerName,
                            phone: enr.customer?.maskedPhone
                          })
                        }
                        className="font-serif text-sm font-bold text-[#431217] hover:underline flex items-center gap-1 cursor-pointer"
                        title="Click to view full customer timeline"
                      >
                        <span>{customerName || 'Boutique Patron'}</span>
                        <Eye className="w-3 h-3 text-[#C99726]" />
                      </button>

                      {enr.customer?.maskedPhone && (
                        <code className="text-[11px] font-mono text-[#5C1D24] bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#EAE4DC]">
                          {enr.customer.maskedPhone}
                        </code>
                      )}

                      {/* Status Badges */}
                      <ExecutionStatusBadge
                        status={enr.status}
                        isHeld={isHeld}
                      />

                      {isGoalReached && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF7EE] text-[#1B7A43] border border-[#C3E8CB]">
                          <CheckCircle2 className="w-3 h-3 text-[#1B7A43]" />
                          Goal Completed
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-[#6B5E59] flex items-center gap-3 flex-wrap">
                      <span>
                        Occasion: <strong className="text-[#2A1D1A]">{enr.occasionLocalDate || enr.occurrenceId}</strong> (Date-only)
                      </span>
                      <span>
                        Plan Rev: <strong>v{enr.planRevision}</strong>
                      </span>
                      {localCreated && (
                        <span
                          className="cursor-help flex items-center gap-1"
                          title={`UTC Instant: ${utcCreated || ''}`}
                        >
                          <Clock className="w-3 h-3 text-[#C99726]" />
                          <span>Enrolled: {localCreated}</span>
                        </span>
                      )}
                    </div>

                    {enr.matchExplanation && (
                      <p className="text-[11px] text-[#6B5E59] italic">
                        {enr.matchExplanation}
                      </p>
                    )}
                  </div>

                  {/* Right Column: Actions (Available to STAFF, STORE_MANAGER, BOUTIQUE_OWNER) */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {/* View Customer Timeline */}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTimelineCustomer({
                          id: enr.customerId,
                          name: customerName,
                          phone: enr.customer?.maskedPhone
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[11px] font-semibold text-[#6B5E59] hover:bg-[#FAF8F5] cursor-pointer"
                    >
                      Timeline
                    </button>

                    {/* Resolve Hold Action */}
                    {isHeld && canAct && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedResolveHold({
                            id: enr.id,
                            customerName,
                            maskedPhone: enr.customer?.maskedPhone,
                            heldAt: enr.replyHoldAt
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-[#5C1D24] text-white text-[11px] font-semibold hover:bg-[#73232C] flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <UserCheck className="w-3 h-3 text-[#F3E0B5]" />
                        <span>Resolve Hold</span>
                      </button>
                    )}

                    {/* Mark Goal Action */}
                    {!isGoalReached && enr.status === 'ACTIVE' && canAct && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMarkGoal({
                            id: enr.id,
                            customerName,
                            maskedPhone: enr.customer?.maskedPhone,
                            occurrenceId: enr.occurrenceId
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#EAE4DC] text-[#1B7A43] hover:bg-[#EBF7EE] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        title="Mark occasion conversion/purchase"
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
          maskedPhone={selectedMarkGoal.maskedPhone}
          campaignName={campaignName}
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
          maskedPhone={selectedTimelineCustomer.phone}
          onClose={() => setSelectedTimelineCustomer(null)}
        />
      )}
    </div>
  );
}
