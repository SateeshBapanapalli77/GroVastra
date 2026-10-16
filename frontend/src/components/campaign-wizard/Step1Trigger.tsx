'use client';

import React from 'react';
import { Calendar, Clock, Globe, Sparkles } from 'lucide-react';

interface Step1TriggerProps {
  triggerData: any;
  onChange: (updatedTrigger: any) => void;
  disabled?: boolean;
}

const COMMON_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST — India Standard Time)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST — Gulf Standard Time)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT — Singapore Time)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST — UK Time)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT — US Eastern)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' }
];

export function Step1Trigger({ triggerData, onChange, disabled = false }: Step1TriggerProps) {
  const triggerType = triggerData?.type || 'ANNUAL_DATE';

  const updateField = (field: string, value: any) => {
    onChange({
      ...triggerData,
      [field]: value
    });
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
          <Calendar className="w-5 h-5 text-[#C99726]" />
          <span>Step 1: Campaign Trigger Engine</span>
        </h2>
        <p className="text-xs text-[#6B5E59] mt-1">
          Define the patron occasion, domain lifecycle event, or inactivity scan that initiates this campaign sequence.
        </p>
      </div>

      {/* Trigger Family Type Selector */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <label className="block text-xs font-bold text-[#2A1D1A]">
          Trigger Family Architecture
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Annual Calendar Date */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('type', 'ANNUAL_DATE')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              triggerType === 'ANNUAL_DATE'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="font-serif font-bold text-xs text-[#431217] mb-1">
              Annual Calendar Date
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Patron birthdays and wedding anniversaries scanned yearly with leap-day protection.
            </p>
          </button>

          {/* Domain Event Driven */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('type', 'EVENT_DRIVEN')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              triggerType === 'EVENT_DRIVEN'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="font-serif font-bold text-xs text-[#431217] mb-1">
              Domain Event Driven
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Real-time events: stock drops, alterations ready, or completed boutique orders.
            </p>
          </button>

          {/* Inactivity Scan */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('type', 'INACTIVITY_SCAN')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              triggerType === 'INACTIVITY_SCAN'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="font-serif font-bold text-xs text-[#431217] mb-1">
              Inactivity Winback Scan
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Automated worker sweep for patrons who haven&apos;t ordered in 60, 90, or 180 days.
            </p>
          </button>
        </div>
      </div>

      {/* Trigger Family Dynamic Fields */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
          {triggerType === 'ANNUAL_DATE' && 'Annual Occasion Parameters'}
          {triggerType === 'EVENT_DRIVEN' && 'Domain Event Configuration'}
          {triggerType === 'INACTIVITY_SCAN' && 'Inactivity Window Settings'}
        </h3>

        {/* 1. ANNUAL_DATE FIELDS */}
        {triggerType === 'ANNUAL_DATE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                Occasion Date Field
              </label>
              <select
                disabled={disabled}
                value={triggerData?.field || 'customer.birthday'}
                onChange={(e) => updateField('field', e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
              >
                <option value="customer.birthday">Customer Birthday (customer.birthday)</option>
                <option value="customer.anniversary">Wedding Anniversary (customer.anniversary)</option>
              </select>
              <p className="text-[10px] text-[#988B86] mt-1">
                Resolved directly from CRM patron records without UTC date shifts.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                Leap-Day Handling Policy (Feb 29)
              </label>
              <select
                disabled={disabled}
                value={triggerData?.leapDayPolicy || 'FEB_28'}
                onChange={(e) => updateField('leapDayPolicy', e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
              >
                <option value="FEB_28">FEB_28 (Send on Feb 28 in common years — Recommended)</option>
                <option value="MAR_01">MAR_01 (Send on March 1 in common years)</option>
                <option value="LEAP_ONLY">LEAP_ONLY (Only dispatch in actual leap years)</option>
              </select>
              <p className="text-[10px] text-[#988B86] mt-1">
                Guarantees patrons born on Feb 29 receive their celebration in non-leap years.
              </p>
            </div>
          </div>
        )}

        {/* 2. EVENT_DRIVEN FIELDS */}
        {triggerType === 'EVENT_DRIVEN' && (
          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Event Subscribed
            </label>
            <select
              disabled={disabled}
              value={triggerData?.eventType || 'stock.published'}
              onChange={(e) => updateField('eventType', e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
            >
              <option value="stock.published">New Stock Published (stock.published)</option>
              <option value="order.completed">Order Fulfilled (order.completed)</option>
              <option value="boutique.alteration_completed">Boutique Alteration Ready (boutique.alteration_completed)</option>
            </select>
            <p className="text-[10px] text-[#988B86] mt-1">
              Listens to domain events on the GroVastra event bus with transactional deduplication.
            </p>
          </div>
        )}

        {/* 3. INACTIVITY_SCAN FIELDS */}
        {triggerType === 'INACTIVITY_SCAN' && (
          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Inactivity Duration (Days Since Last Order)
            </label>
            <input
              type="number"
              min="14"
              max="365"
              disabled={disabled}
              value={triggerData?.inactivityDays ?? 90}
              onChange={(e) => updateField('inactivityDays', parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
            />
            <p className="text-[10px] text-[#988B86] mt-1">
              Patrons whose last order date exceeds this threshold will be enrolled during daily sweep.
            </p>
          </div>
        )}
      </div>

      {/* Common Timing & Timezone Settings */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <h3 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#5C1D24]" />
          <span>Local Dispatch Schedule &amp; Timezone</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Campaign IANA Timezone
            </label>
            <select
              disabled={disabled}
              value={triggerData?.timezone || 'Asia/Kolkata'}
              onChange={(e) => updateField('timezone', e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[#988B86] mt-1">
              Timezone used for evaluating quiet hours and scheduling local send times.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
              Local Evaluation Time (HH:mm)
            </label>
            <input
              type="text"
              disabled={disabled}
              placeholder="10:00"
              value={triggerData?.localTime || '10:00'}
              onChange={(e) => updateField('localTime', e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60 font-mono"
            />
            <p className="text-[10px] text-[#988B86] mt-1">
              Daily evaluation runs at this local time within allowed delivery hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
