'use client';

import React, { useState } from 'react';
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

export const ActivityView: React.FC = () => {
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: 'exe_act_01',
      campaignName: 'Birthday Boutique Shopping',
      stepId: 'invitation (D-14)',
      customerId: 'Lakshmi Devi',
      occurrenceId: 'birthday:2026',
      state: 'PROVIDER_ACCEPTED',
      explanation: 'Accepted by WhatsApp provider and delivered to patron.',
      timestamp: 'Today at 10:02 AM IST',
      enrollmentId: 'enr_01'
    },
    {
      id: 'exe_act_02',
      campaignName: 'Birthday Boutique Shopping',
      stepId: 'followup (D-7)',
      customerId: 'Lakshmi Devi',
      occurrenceId: 'birthday:2026',
      state: 'HELD',
      outcomeReason: 'SKIPPED_REPLY_HOLD',
      explanation: 'Customer replied to invitation; sales follow-up held for human weaver desk.',
      timestamp: 'Today at 10:15 AM IST',
      enrollmentId: 'enr_01',
      replyHoldAt: '2026-10-14T10:15:00.000Z'
    },
    {
      id: 'exe_act_03',
      campaignName: 'Anniversary Celebration',
      stepId: 'invitation (D-21)',
      customerId: 'Ananya Rao',
      occurrenceId: 'anniversary:2026',
      state: 'SCHEDULED',
      explanation: 'Scheduled for future due time (D-21 window).',
      timestamp: 'Scheduled for 15 Oct 10:00 AM IST',
      enrollmentId: 'enr_02'
    },
    {
      id: 'exe_act_04',
      campaignName: 'Requested Saree Restock',
      stepId: 'restock_notification',
      customerId: 'Meera Sundaram',
      occurrenceId: 'restock:BN-BLU-002:2026-10-14',
      state: 'SKIPPED',
      outcomeReason: 'SKIPPED_CONTACT_CAP',
      explanation: 'Skipped because patron already received marketing contact within rolling 24h.',
      timestamp: 'Today at 11:00 AM IST',
      enrollmentId: 'enr_03'
    },
    {
      id: 'exe_act_05',
      campaignName: 'Birthday Boutique Shopping',
      stepId: 'followup (D-7)',
      customerId: 'Ananya Rao',
      occurrenceId: 'birthday:2026',
      state: 'SKIPPED',
      outcomeReason: 'SKIPPED_GOAL_REACHED',
      explanation: 'Follow-up stopped because patron completed a qualifying saree purchase.',
      timestamp: 'Yesterday at 04:30 PM IST',
      enrollmentId: 'enr_04',
      goalReachedAt: '2026-10-13T16:30:00.000Z'
    }
  ]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleReleaseHold = (enrollmentId: string) => {
    setActivities((prev) =>
      prev.map((act) => {
        if (act.enrollmentId === enrollmentId && act.state === 'HELD') {
          return {
            ...act,
            state: 'SCHEDULED',
            explanation: 'Hold released by boutique staff; next step re-queued for evaluation.',
            replyHoldAt: null
          };
        }
        return act;
      })
    );
    showToast('Hold released successfully. Future steps will be evaluated normally.');
  };

  const handleMarkGoal = (enrollmentId: string) => {
    setActivities((prev) =>
      prev.map((act) => {
        if (act.enrollmentId === enrollmentId && act.state === 'SCHEDULED') {
          return {
            ...act,
            state: 'SKIPPED',
            outcomeReason: 'SKIPPED_GOAL_REACHED',
            explanation: 'Staff manually recorded purchase goal; pending promotional messages cancelled.'
          };
        }
        return act;
      })
    );
    showToast('Goal marked. Pending promotional follow-ups skipped.');
  };

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
                  <span>{act.timestamp}</span>
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
