'use client';

import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  HelpCircle,
  RotateCcw,
  Tag,
  Check
} from 'lucide-react';

interface ActivityItem {
  id: string;
  campaignName: string;
  stepId: string;
  customerId: string;
  occurrenceId: string;
  state: 'SCHEDULED' | 'PROVIDER_ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'HELD';
  outcomeReason?: string;
  explanation: string;
  timestamp: string;
  enrollmentId: string;
  replyHoldAt?: string | null;
  goalReachedAt?: string | null;
}

import { api, ActivityItem as ApiActivityItem } from '../lib/api';

export const ActivityView: React.FC = () => {
  const [activities, setActivities] = useState<ApiActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadActivities = async () => {
    try {
      setLoading(true);
      const res = await api.getActivityStream();
      if (res && res.activity) {
        setActivities(res.activity);
      }
    } catch (err: any) {
      console.warn('Backend not reachable or empty; showing demo fallback', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActivities();
  }, []);

  const handleReleaseHold = async (enrollmentId: string) => {
    try {
      await api.resolveHold(enrollmentId);
      showToast('Hold released successfully on backend.');
      await loadActivities();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleMarkGoal = async (enrollmentId: string) => {
    try {
      await api.markGoal(enrollmentId, 'staff_manual_tag');
      showToast('Goal marked met on backend.');
      await loadActivities();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const acceptedCount = activities.filter((a) => a.state === 'PROVIDER_ACCEPTED').length;
  const deliveredCount = activities.filter((a) => (a as any).state === 'DELIVERED').length;
  const readCount = activities.filter((a) => (a as any).state === 'READ').length;
  const heldCount = activities.filter((a) => a.state === 'HELD' || Boolean(a.replyHoldAt)).length;
  const skippedCount = activities.filter((a) => a.state === 'SKIPPED').length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#431217] text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg border border-[#F3E0B5] flex items-center gap-2 animate-in slide-in-from-bottom duration-200">
          <Check className="w-4 h-4 text-[#C99726]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-[#EAE4DC] pb-5">
        <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
          Execution Transparency
        </div>
        <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
          Campaign Activity &amp; Explainability Stream
        </h1>
        <p className="text-xs text-[#6B5E59] mt-0.5">
          Plain-English audit log explaining why every customer was selected, held, deferred, or skipped (Handoff Page 28)
        </p>
      </div>

      {/* Metrics Row: Separate Accepted, Delivered, Read counts per Spec p.5 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
        <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] shadow-2xs">
          <div className="text-[10px] uppercase font-bold text-[#988B86]">Accepted</div>
          <div className="font-serif text-xl font-bold text-[#1B7A43]">{acceptedCount}</div>
          <div className="text-[10px] text-[#6B5E59]">Meta accepted</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] shadow-2xs">
          <div className="text-[10px] uppercase font-bold text-[#988B86]">Delivered</div>
          <div className="font-serif text-xl font-bold text-emerald-600">{deliveredCount}</div>
          <div className="text-[10px] text-[#6B5E59]">Device delivered</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] shadow-2xs">
          <div className="text-[10px] uppercase font-bold text-[#988B86]">Read</div>
          <div className="font-serif text-xl font-bold text-[#431217]">{readCount}</div>
          <div className="text-[10px] text-[#6B5E59]">Patron opened</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] shadow-2xs">
          <div className="text-[10px] uppercase font-bold text-[#988B86]">Staff Holds</div>
          <div className="font-serif text-xl font-bold text-[#8F6910]">{heldCount}</div>
          <div className="text-[10px] text-[#6B5E59]">Inbound replies</div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] shadow-2xs">
          <div className="text-[10px] uppercase font-bold text-[#988B86]">Skipped</div>
          <div className="font-serif text-xl font-bold text-[#6B5E59]">{skippedCount}</div>
          <div className="text-[10px] text-[#6B5E59]">Policy / Caps</div>
        </div>
      </div>

      {/* Activity Table */}
      <div className="bg-white rounded-2xl border border-[#EAE4DC] shadow-xs overflow-hidden">
        <div className="divide-y divide-[#FAF8F5]">
          {activities.map((act) => (
            <div key={act.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#FAF8F5]/50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                      act.state === 'PROVIDER_ACCEPTED'
                        ? 'bg-[#E8F8EE] text-[#1B7A43]'
                        : act.state === 'HELD'
                        ? 'bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]'
                        : act.state === 'SKIPPED'
                        ? 'bg-[#FAF8F5] text-[#5C1D24] border border-[#F0DADC]'
                        : 'bg-[#FAF8F5] text-[#6B5E59]'
                    }`}
                  >
                    {act.state === 'PROVIDER_ACCEPTED'
                      ? 'SENT & ACCEPTED'
                      : act.state === 'HELD'
                      ? 'STAFF HOLD'
                      : act.state}
                  </span>

                  <span className="font-bold text-xs text-[#271E1B]">{act.customerId}</span>
                  <span className="text-xs text-[#988B86]">•</span>
                  <span className="text-xs text-[#6B5E59]">{act.campaignName}</span>
                  <span className="text-xs text-[#988B86]">({act.stepId})</span>
                </div>

                <p className="text-xs text-[#431217] font-medium leading-relaxed">
                  {act.explanation}
                </p>

                <div className="text-[10px] text-[#988B86] flex items-center gap-2">
                  <span>{act.timestamp || (act.dueAt ? new Date(act.dueAt).toLocaleString() : 'Recent')}</span>
                  <span>•</span>
                  <span>Occurrence: {act.occurrenceId}</span>
                </div>
              </div>

              {/* Staff Interventions */}
              <div className="flex items-center gap-2 shrink-0">
                {act.state === 'HELD' && (
                  <button
                    onClick={() => handleReleaseHold(act.enrollmentId)}
                    className="px-3 py-1.5 bg-[#5C1D24] hover:bg-[#431217] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                  >
                    Release Hold
                  </button>
                )}

                {act.state === 'SCHEDULED' && (
                  <button
                    onClick={() => handleMarkGoal(act.enrollmentId)}
                    className="px-3 py-1.5 border border-[#EAE4DC] hover:border-[#5C1D24] text-[#6B5E59] hover:text-[#5C1D24] rounded-lg text-xs font-semibold bg-white transition-colors"
                  >
                    Mark Goal Met
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
