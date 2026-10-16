'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { resolveReasonCode } from '../../lib/reasonCodes';
import { ExecutionStatusBadge } from './ExecutionStatusBadge';
import { CustomerTimelineItem } from '../../lib/schemas';
import { DateTime } from 'luxon';
import {
  Clock,
  Calendar,
  AlertCircle,
  RefreshCw,
  X,
  FileText,
  User,
  ShieldCheck,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  Layers
} from 'lucide-react';

interface CustomerTimelineDialogProps {
  customerId: string;
  customerName?: string | null;
  maskedPhone?: string | null;
  onClose: () => void;
}

export function CustomerTimelineDialog({
  customerId,
  customerName,
  maskedPhone,
  onClose
}: CustomerTimelineDialogProps) {
  const {
    data: timelineData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.customers.timeline(customerId),
    queryFn: () => api.getCustomerTimeline(customerId),
    enabled: Boolean(customerId)
  });

  const timeline: CustomerTimelineItem[] = timelineData?.timeline || [];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white border border-[#EAE4DC] rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-[#EAE4DC] flex items-start justify-between bg-[#FAF8F5]">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#8F6910]">
              Lifecycle &amp; Campaign Timeline
            </span>
            <h3 className="font-serif text-xl font-bold text-[#431217]">
              {customerName || 'Boutique Patron'}
            </h3>
            <div className="flex items-center gap-2 text-xs text-[#6B5E59]">
              {maskedPhone && (
                <span className="font-mono text-[11px] text-[#5C1D24] bg-white px-2 py-0.5 rounded border border-[#EAE4DC]">
                  {maskedPhone}
                </span>
              )}
              <span className="text-[11px] font-mono text-[#988B86]">ID: {customerId}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#6B5E59] hover:text-[#2A1D1A] hover:bg-white transition-all cursor-pointer"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Timeline Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center bg-[#FDF2F2] border border-[#F8D7DA] rounded-2xl space-y-3">
              <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
              <h4 className="font-serif text-sm font-bold text-[#9E2A2B]">Unable to load customer timeline</h4>
              <p className="text-xs text-[#6B5E59]">{(error as Error)?.message || 'Service offline'}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-3.5 py-1.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : timeline.length === 0 ? (
            <div className="p-10 text-center bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl space-y-2">
              <Clock className="w-8 h-8 text-[#C99726] mx-auto" />
              <h4 className="font-serif text-sm font-bold text-[#2A1D1A]">No timeline events recorded</h4>
              <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
                No campaign enrollments, evaluations, or reply holds have been logged for this patron yet.
              </p>
            </div>
          ) : (
            <div className="relative border-l-2 border-[#EAE4DC] ml-4 space-y-6">
              {timeline.map((event, idx) => {
                const eventDt = DateTime.fromISO(event.timestamp);
                const localFormatted = eventDt.setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm');
                const utcInstant = eventDt.toUTC().toISO();
                const reasonDef = resolveReasonCode(event.reason);

                return (
                  <div key={event.id || idx} className="relative pl-6">
                    {/* Timeline Node Bullet */}
                    <div
                      className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center ${
                        event.type === 'GOAL_REACHED'
                          ? 'border-[#1B7A43]'
                          : event.type === 'REPLY_HOLD'
                          ? 'border-[#C99726]'
                          : event.type === 'ENROLLMENT'
                          ? 'border-[#5C1D24]'
                          : 'border-[#6B5E59]'
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          event.type === 'GOAL_REACHED'
                            ? 'bg-[#1B7A43]'
                            : event.type === 'REPLY_HOLD'
                            ? 'bg-[#C99726]'
                            : event.type === 'ENROLLMENT'
                            ? 'bg-[#5C1D24]'
                            : 'bg-[#6B5E59]'
                        }`}
                      />
                    </div>

                    {/* Timeline Card */}
                    <div className="bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs space-y-3">
                      {/* Top Meta Line */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white text-[#5C1D24] border border-[#EAE4DC]">
                            {event.type.replace(/_/g, ' ')}
                          </span>
                          <strong className="text-xs text-[#2A1D1A]">
                            {event.campaignName || event.campaignId}
                          </strong>
                          {event.stepId && (
                            <span className="text-[10px] text-[#6B5E59]">
                              Step: <code className="font-mono text-[#5C1D24]">{event.stepId}</code>
                            </span>
                          )}
                        </div>

                        {/* Status Badge */}
                        <ExecutionStatusBadge
                          status={event.status}
                          outcomeReason={event.reason}
                          isHeld={event.type === 'REPLY_HOLD'}
                        />
                      </div>

                      {/* Date & Time Row */}
                      <div
                        className="text-xs text-[#6B5E59] flex items-center gap-2 cursor-help"
                        title={utcInstant ? `UTC Instant: ${utcInstant}` : undefined}
                      >
                        <Clock className="w-3.5 h-3.5 text-[#C99726] shrink-0" />
                        <span>
                          {localFormatted} (Asia/Kolkata)
                        </span>
                        {utcInstant && (
                          <span className="text-[10px] text-[#988B86]">
                            • UTC: {DateTime.fromISO(utcInstant).toFormat('dd LLL, HH:mm UTC')}
                          </span>
                        )}
                      </div>

                      {/* Why Selected & Occurrence Details */}
                      {event.type === 'ENROLLMENT' && event.details && (
                        <div className="bg-white rounded-xl p-3 border border-[#EAE4DC] space-y-1.5 text-xs">
                          <div className="text-[10px] uppercase font-bold text-[#8F6910] flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-[#C99726]" />
                            <span>Why Selected &amp; Occasion Plan</span>
                          </div>
                          {event.details.occurrenceId && (
                            <div className="text-[11px] text-[#2A1D1A]">
                              Occurrence: <strong>{event.details.occurrenceId}</strong>
                            </div>
                          )}
                          {event.details.matchExplanation && (
                            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
                              {event.details.matchExplanation}
                            </p>
                          )}
                          {event.details.sourceRef && (
                            <div className="text-[10px] font-mono text-[#988B86]">
                              Source: {event.details.sourceRef.type} (v{event.details.sourceRef.version})
                            </div>
                          )}
                        </div>
                      )}

                      {/* Execution Details & Stop Reasons */}
                      {event.type === 'EXECUTION' && (
                        <div className="space-y-1.5 text-xs">
                          {event.details?.localDate && (
                            <div className="text-[11px] text-[#6B5E59]">
                              Planned local date: <strong>{event.details.localDate}</strong> at <strong>{event.details.localTime || '10:00'}</strong>
                            </div>
                          )}
                          {event.reason && (
                            <div className="bg-white rounded-xl p-3 border border-[#EAE4DC] space-y-1">
                              <span className="text-[10px] uppercase font-bold text-[#8F6910] block">
                                Stop Reason / Outcome
                              </span>
                              <p className="text-xs text-[#2A1D1A] font-medium">{reasonDef.sentence}</p>
                              <div className="text-[10px] font-mono text-[#988B86]">
                                Reason Code: {event.reason}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Reply Hold Details */}
                      {event.type === 'REPLY_HOLD' && (
                        <div className="bg-white rounded-xl p-3 border border-[#F3E0B5] text-xs text-[#8F6910] space-y-1">
                          <strong>Human Weaver Hold Active:</strong>
                          <p className="text-[11px] text-[#6B5E59]">
                            Customer sent an incoming message on WhatsApp. Automated sequence suspended for boutique staff handling.
                          </p>
                        </div>
                      )}

                      {/* Goal Reached Details */}
                      {event.type === 'GOAL_REACHED' && (
                        <div className="bg-white rounded-xl p-3 border border-[#C3E8CB] text-xs text-[#1B7A43] space-y-1">
                          <strong>Qualifying Purchase / Goal Completed:</strong>
                          {event.details?.goalOrderRef && (
                            <div className="text-[11px]">
                              Order Reference: <code className="font-mono">{event.details.goalOrderRef}</code>
                            </div>
                          )}
                          <p className="text-[11px] text-[#6B5E59]">
                            Further promotional follow-ups halted. Occasion attributed.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#FAF8F5] border-t border-[#EAE4DC] flex items-center justify-between text-xs text-[#988B86]">
          <span>Displaying customer lifecycle audit projection</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white font-semibold hover:bg-[#73232C] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
