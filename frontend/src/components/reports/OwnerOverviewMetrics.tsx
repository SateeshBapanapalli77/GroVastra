'use client';

import React from 'react';
import {
  Users,
  Send,
  CheckCircle2,
  Eye,
  HandMetal,
  Target
} from 'lucide-react';
import { z } from 'zod';
import { OwnerOverviewReportSchema } from '../../lib/schemas';

type ReportData = z.infer<typeof OwnerOverviewReportSchema>;

interface OwnerOverviewMetricsProps {
  report: ReportData;
}

export const OwnerOverviewMetrics: React.FC<OwnerOverviewMetricsProps> = ({ report }) => {
  return (
    <div className="space-y-6">
      {/* Verified Delivery Evidence Section (Non-Negotiable 4: Accepted, Delivered, Read as separate counts) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xs font-bold text-[#2A1D1A] uppercase tracking-wider flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#1B7A43]" />
            <span>Verified Message Delivery Counts (Non-Imputed)</span>
          </h2>
          <span className="text-[11px] text-[#8F6910] bg-[#FEF9EE] px-2.5 py-0.5 rounded border border-[#F3E0B5]">
            Provider Webhook Receipts
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Accepted */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6B5E59]">1. Accepted by API</span>
              <Send className="w-4 h-4 text-[#5C1D24]" />
            </div>
            <div className="text-3xl font-bold font-serif text-[#2A1D1A] mt-2">
              {report.evidenceCounts.accepted.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-[#988B86] mt-1">
              Confirmed handoff to Meta WhatsApp Cloud API gateway
            </p>
          </div>

          {/* Delivered */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#145C32]">2. Delivered to Device</span>
              <CheckCircle2 className="w-4 h-4 text-[#1B7A43]" />
            </div>
            <div className="text-3xl font-bold font-serif text-[#145C32] mt-2">
              {report.evidenceCounts.delivered.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-[#1B7A43] mt-1">
              Confirmed double-check delivery receipt from patron handset
            </p>
          </div>

          {/* Read */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8F6910]">3. Read Receipts</span>
              <Eye className="w-4 h-4 text-[#C99726]" />
            </div>
            <div className="text-3xl font-bold font-serif text-[#8F6910] mt-2">
              {report.evidenceCounts.read.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-[#988B86] mt-1">
              Blue-tick read receipts acknowledged where patron enabled
            </p>
          </div>
        </div>
      </div>

      {/* Audience, Enrollments & Campaign Journey Stats */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xs font-bold text-[#2A1D1A] uppercase tracking-wider flex items-center gap-2">
            <Users className="w-4 h-4 text-[#5C1D24]" />
            <span>Audience Scope &amp; Journey Enrollment</span>
          </h2>
          <span className="text-[11px] text-[#988B86]">Tenant Lifecycle Scope</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Eligible Audience */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
            <span className="text-[10px] font-bold text-[#6B5E59] uppercase tracking-wider">
              Eligible Audience
            </span>
            <div className="text-2xl font-bold font-serif text-[#2A1D1A] mt-1">
              {report.eligibleCustomers.toLocaleString('en-IN')}
            </div>
            <p className="text-[10px] text-[#988B86] mt-0.5">
              Active patrons opted-in to WhatsApp marketing
            </p>
          </div>

          {/* Total Enrollments */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
            <span className="text-[10px] font-bold text-[#5C1D24] uppercase tracking-wider">
              Total Enrollments
            </span>
            <div className="text-2xl font-bold font-serif text-[#5C1D24] mt-1">
              {report.enrollments.total.toLocaleString('en-IN')}
            </div>
            <p className="text-[10px] text-[#988B86] mt-0.5">
              Patron occasion journeys scheduled across all campaigns
            </p>
          </div>

          {/* Active Journeys */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
            <span className="text-[10px] font-bold text-[#145C32] uppercase tracking-wider">
              Active Journeys
            </span>
            <div className="text-2xl font-bold font-serif text-[#145C32] mt-1">
              {report.enrollments.active.toLocaleString('en-IN')}
            </div>
            <p className="text-[10px] text-[#988B86] mt-0.5">
              Journeys currently waiting on upcoming steps
            </p>
          </div>

          {/* Completed Journeys */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs">
            <span className="text-[10px] font-bold text-[#8F6910] uppercase tracking-wider">
              Completed Journeys
            </span>
            <div className="text-2xl font-bold font-serif text-[#8F6910] mt-1">
              {report.enrollments.completed.toLocaleString('en-IN')}
            </div>
            <p className="text-[10px] text-[#988B86] mt-0.5">
              Patrons who finished all sequence steps or reached goal
            </p>
          </div>
        </div>
      </div>

      {/* Human Weaver Replies, Holds & Goal Conversions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Reply Holds Card */}
        <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HandMetal className="w-4 h-4 text-[#C99726]" />
              <h3 className="font-serif text-sm font-bold text-[#431217]">
                Customer Replies &amp; Human Weaver Holds
              </h3>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]">
              Staff Attention
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]">
              <span className="text-[10px] text-[#6B5E59] font-medium uppercase">
                Held Enrollments
              </span>
              <div className="text-xl font-bold font-serif text-[#8F6910] mt-0.5">
                {report.repliesAndHolds.totalHeldEnrollments}
              </div>
              <p className="text-[10px] text-[#988B86] mt-0.5">
                Paused after customer WhatsApp reply
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]">
              <span className="text-[10px] text-[#6B5E59] font-medium uppercase">
                Suppressed Steps
              </span>
              <div className="text-xl font-bold font-serif text-[#5C1D24] mt-0.5">
                {report.repliesAndHolds.skippedReplyHoldExecutions}
              </div>
              <p className="text-[10px] text-[#988B86] mt-0.5">
                Subsequent steps withheld while held
              </p>
            </div>
          </div>

          <p className="text-[11px] text-[#6B5E59] leading-relaxed">
            When a patron replies, automation stops immediately so boutique stylists can chat 1-on-1 without robotic interference.
          </p>
        </div>

        {/* Goal Completions Card */}
        <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-[#1B7A43]" />
              <h3 className="font-serif text-sm font-bold text-[#145C32]">
                Campaign Occasion Goal Conversions
              </h3>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#EBF7EE] text-[#145C32] border border-[#C3E8CB]">
              Goals Met
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]">
              <span className="text-[10px] text-[#6B5E59] font-medium uppercase">
                Patrons Converted
              </span>
              <div className="text-xl font-bold font-serif text-[#145C32] mt-0.5">
                {report.goalCompletions.totalGoalEnrollments}
              </div>
              <p className="text-[10px] text-[#988B86] mt-0.5">
                Enrolled patrons who made purchase
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]">
              <span className="text-[10px] text-[#6B5E59] font-medium uppercase">
                Steps Suppressed
              </span>
              <div className="text-xl font-bold font-serif text-[#1B7A43] mt-0.5">
                {report.goalCompletions.skippedGoalExecutions}
              </div>
              <p className="text-[10px] text-[#988B86] mt-0.5">
                Follow-ups saved after purchase
              </p>
            </div>
          </div>

          <p className="text-[11px] text-[#6B5E59] leading-relaxed">
            Patrons who purchase before step completion are safely marked as goal converted, preventing spam follow-ups.
          </p>
        </div>
      </div>
    </div>
  );
};
