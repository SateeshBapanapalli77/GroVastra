'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, AlertTriangle, Loader2, Save } from 'lucide-react';

interface WizardHeaderProps {
  campaignId: string;
  campaignName: string;
  currentStep: number;
  onStepClick: (stepIndex: number) => void;
  autosaveStatus: 'IDLE' | 'SAVING' | 'SAVED' | 'CONFLICT' | 'DIRTY';
  conflictError?: string | null;
  onReloadLatest?: () => void;
  onManualSave?: () => void;
  isSaving?: boolean;
  canEdit?: boolean;
  draftVersion?: number;
}

const WIZARD_STEPS = [
  { index: 1, label: 'Trigger', short: 'Trigger' },
  { index: 2, label: 'Audience', short: 'Audience' },
  { index: 3, label: 'Messages', short: 'Messages' },
  { index: 4, label: 'Sending rules', short: 'Rules' },
  { index: 5, label: 'Review', short: 'Review' }
];

export function WizardHeader({
  campaignId,
  campaignName,
  currentStep,
  onStepClick,
  autosaveStatus,
  conflictError,
  onReloadLatest,
  onManualSave,
  isSaving = false,
  canEdit = true,
  draftVersion = 1
}: WizardHeaderProps) {
  return (
    <div className="space-y-4 border-b border-[#EAE4DC] pb-5">
      {/* Top Bar: Back Link, Title, Autosave Indicator & Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/campaigns/${campaignId}`}
            className="p-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[#6B5E59] hover:text-[#5C1D24] hover:bg-[#FAF8F5] transition-all cursor-pointer"
            title="Back to Campaign Overview"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-xl font-bold text-[#431217]">
                {campaignName || 'Edit Campaign Draft'}
              </h1>
              <span className="font-mono text-[10px] text-[#5C1D24] bg-[#FDF5F6] px-2 py-0.5 rounded border border-[#F0DADC]">
                draft v{draftVersion}
              </span>
            </div>
            <p className="text-[11px] text-[#6B5E59]">
              5-Step Campaign Studio • Step {currentStep} of 5
            </p>
          </div>
        </div>

        {/* Right Status Indicator & Action */}
        <div className="flex items-center gap-3">
          {/* Autosave Status Badge */}
          <div className="text-xs flex items-center gap-1.5">
            {autosaveStatus === 'SAVING' && (
              <span className="text-[#8F6910] bg-[#FEF9EE] px-2.5 py-1 rounded-full border border-[#F3E0B5] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-[#C99726]" />
                <span>Autosaving draft...</span>
              </span>
            )}
            {autosaveStatus === 'SAVED' && (
              <span className="text-[#1B7A43] bg-[#EBF7EE] px-2.5 py-1 rounded-full border border-[#C3E8CB] flex items-center gap-1">
                <Check className="w-3 h-3 text-[#1B7A43]" />
                <span>Draft saved</span>
              </span>
            )}
            {autosaveStatus === 'DIRTY' && (
              <span className="text-[#8C827A] bg-[#FAF8F5] px-2.5 py-1 rounded-full border border-[#EAE4DC]">
                Unsaved edits
              </span>
            )}
            {autosaveStatus === 'CONFLICT' && (
              <span className="text-[#B26A00] bg-[#FFF7E6] px-2.5 py-1 rounded-full border border-[#FFE2B3] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-[#C99726]" />
                <span>Conflict (409)</span>
              </span>
            )}
          </div>

          {/* Manual Save Trigger */}
          {canEdit && onManualSave && (
            <button
              type="button"
              disabled={isSaving}
              onClick={onManualSave}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-[#F3E0B5]" />
              <span>Save Draft</span>
            </button>
          )}
        </div>
      </div>

      {/* 409 Conflict Banner with Reload Latest Action */}
      {conflictError && (
        <div className="p-3.5 rounded-xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
            <span>{conflictError}</span>
          </div>
          {onReloadLatest && (
            <button
              type="button"
              onClick={onReloadLatest}
              className="px-3 py-1 rounded-lg bg-[#B26A00] text-white font-semibold hover:bg-[#8F6910] transition-colors cursor-pointer text-xs shrink-0"
            >
              Reload latest
            </button>
          )}
        </div>
      )}

      {/* 5-Step Progress Stepper */}
      <div className="grid grid-cols-5 gap-2 pt-2">
        {WIZARD_STEPS.map((st) => {
          const isActive = currentStep === st.index;
          const isCompleted = currentStep > st.index;

          return (
            <button
              key={st.index}
              type="button"
              onClick={() => onStepClick(st.index)}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                isActive
                  ? 'bg-white border-[#5C1D24] shadow-xs ring-1 ring-[#5C1D24]'
                  : isCompleted
                  ? 'bg-[#FAF8F5] border-[#C3E8CB] hover:bg-white'
                  : 'bg-[#FAF8F5] border-[#EAE4DC] hover:bg-white opacity-70'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                  isActive
                    ? 'bg-[#5C1D24] text-[#F3E0B5]'
                    : isCompleted
                    ? 'bg-[#1B7A43] text-white'
                    : 'bg-[#EAE4DC] text-[#6B5E59]'
                }`}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5" /> : st.index}
              </div>

              <div className="min-w-0 hidden sm:block">
                <span className="text-[10px] text-[#988B86] block leading-none">Step {st.index}</span>
                <span className={`text-xs font-bold truncate block ${isActive ? 'text-[#5C1D24]' : 'text-[#2A1D1A]'}`}>
                  {st.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
