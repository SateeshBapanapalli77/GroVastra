'use client';

import React from 'react';
import { Sliders, Shield, Target, Clock, AlertCircle } from 'lucide-react';

interface Step4SendingRulesProps {
  rulesData: any;
  onChange: (updatedRules: any) => void;
  disabled?: boolean;
}

export function Step4SendingRules({ rulesData, onChange, disabled = false }: Step4SendingRulesProps) {
  const priority = rulesData?.priority ?? 80;
  const resumePolicy = rulesData?.resumePolicy || 'FUTURE_ONLY';
  const goal = rulesData?.goal || { type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED', windowDays: 14 };

  const updateField = (field: string, value: any) => {
    onChange({
      ...rulesData,
      [field]: value
    });
  };

  const updateGoal = (field: string, value: any) => {
    onChange({
      ...rulesData,
      goal: {
        ...goal,
        [field]: value
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[#C99726]" />
          <span>Step 4: Sending Rules &amp; Conflict Priority</span>
        </h2>
        <p className="text-xs text-[#6B5E59] mt-1">
          Configure deterministic priority resolution, goal conversion attribution, and resume behavior.
        </p>
      </div>

      {/* 1. Dispatch Priority Slider */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
              Campaign Contact Priority ({priority}/100)
            </h3>
            <p className="text-xs text-[#6B5E59] mt-0.5">
              Determines which message dispatches when multiple campaigns compete for the same patron&apos;s daily contact cap slot.
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-[#5C1D24] bg-[#FDF5F6] px-3 py-1 rounded-lg border border-[#F0DADC]">
            Priority {priority}
          </span>
        </div>

        <div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            disabled={disabled}
            value={priority}
            onChange={(e) => updateField('priority', parseInt(e.target.value, 10))}
            className="w-full accent-[#5C1D24] cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-[#988B86] mt-1">
            <span>Low (e.g. Winback=30)</span>
            <span>Standard (e.g. Festival=50)</span>
            <span>High (e.g. Wedding=70)</span>
            <span>Critical (e.g. Birthday=80)</span>
          </div>
        </div>
      </div>

      {/* 2. Goal Attribution Rules */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <h3 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
          <Target className="w-4 h-4 text-[#1B7A43]" />
          <span>Goal Conversion &amp; Attribution Window</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Primary Goal Objective
            </label>
            <select
              disabled={disabled}
              value={goal.type}
              onChange={(e) => updateGoal('type', e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
            >
              <option value="OCCASION_TAGGED_OR_STAFF_COMPLETED">
                Occasion Purchase Tagged or Staff Completed
              </option>
              <option value="ORDER_COMPLETED">Boutique Order Completed</option>
              <option value="APPOINTMENT_ATTENDED">Styling Consultation Attended</option>
            </select>
            <p className="text-[10px] text-[#988B86] mt-1">
              When matched, automatically terminates remaining follow-up steps for the enrolled patron.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Attribution Window (Days)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              disabled={disabled}
              value={goal.windowDays ?? 14}
              onChange={(e) => updateGoal('windowDays', parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
            />
            <p className="text-[10px] text-[#988B86] mt-1">
              Orders placed within this window post-delivery are attributed to this campaign.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Resume Policy */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <h3 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#8F6910]" />
          <span>Resume &amp; Backfill Policy</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('resumePolicy', 'FUTURE_ONLY')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              resumePolicy === 'FUTURE_ONLY'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="font-serif font-bold text-xs text-[#431217] mb-1">
              FUTURE_ONLY (Recommended)
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Only schedules future dates from the moment of activation forward. Never sends backdated celebration messages.
            </p>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('resumePolicy', 'REPLAY_RECENT')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              resumePolicy === 'REPLAY_RECENT'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="font-serif font-bold text-xs text-[#431217] mb-1">
              REPLAY_RECENT (48h Window)
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Backfills recent missed occasions within 48 hours if an outage occurred during maintenance.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
