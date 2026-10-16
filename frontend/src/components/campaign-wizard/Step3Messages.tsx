'use client';

import React, { useState } from 'react';
import { MessageSquare, Plus, Trash2, AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { ApprovedTemplateItem } from '../../lib/schemas';
import { ALLOWLISTED_BINDING_SOURCES } from './wizardSchema';
import { WhatsAppSimulator } from './WhatsAppSimulator';

interface Step3MessagesProps {
  steps: any[];
  onChange: (updatedSteps: any[]) => void;
  approvedTemplates: ApprovedTemplateItem[];
  storeDisplayName?: string;
  disabled?: boolean;
}

export function Step3Messages({
  steps,
  onChange,
  approvedTemplates = [],
  storeDisplayName = 'Padmavati Silks',
  disabled = false
}: Step3MessagesProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  // Guarantee at least 1 step
  const currentStep = steps[activeStepIndex] || steps[0] || {
    stepId: 'invitation',
    offsetDays: 0,
    localTime: '10:00',
    prerequisite: 'NONE',
    templateRef: { id: '', revision: 1, language: 'en' },
    bindings: {},
    stopOnReply: true,
    stopOnGoal: true,
    maxLatenessMinutes: 120
  };

  const selectedTemplate = approvedTemplates.find(
    (t) => t.id === currentStep.templateRef?.id
  );

  const updateStep = (index: number, updatedFields: Record<string, any>) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updatedFields };
    onChange(newSteps);
  };

  const handleAddStep = () => {
    if (steps.length >= 3) return;
    const lastStep = steps[steps.length - 1];
    const nextOffset = (lastStep?.offsetDays ?? 0) + 7;
    const newStepId = `step_followup_${Date.now().toString(36).slice(-4)}`;

    const newStep = {
      stepId: newStepId,
      offsetDays: nextOffset,
      localTime: '10:00',
      prerequisite: 'PREVIOUS_ACCEPTED',
      templateRef: {
        id: approvedTemplates[0]?.id || '',
        revision: approvedTemplates[0]?.revision || 1,
        language: 'en'
      },
      bindings: {},
      stopOnReply: true,
      stopOnGoal: true,
      maxLatenessMinutes: 120
    };

    const newSteps = [...steps, newStep];
    onChange(newSteps);
    setActiveStepIndex(newSteps.length - 1);
  };

  const handleRemoveStep = (indexToRemove: number) => {
    if (steps.length <= 1) return;
    const newSteps = steps.filter((_, i) => i !== indexToRemove);
    onChange(newSteps);
    if (activeStepIndex >= newSteps.length) {
      setActiveStepIndex(newSteps.length - 1);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    const tmpl = approvedTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;

    // Initialize default bindings for known variables
    const initialBindings: Record<string, string> = { ...currentStep.bindings };
    for (const key of tmpl.variableKeys || []) {
      if (!initialBindings[key]) {
        if (key === 'name') initialBindings[key] = 'customer.firstName';
        else if (key === 'shop' || key === 'store') initialBindings[key] = 'shop.displayName';
        else if (key === 'item' || key === 'outfit') initialBindings[key] = 'order.itemTitle';
        else if (key === 'date') initialBindings[key] = 'event.date';
        else if (key === 'offer') initialBindings[key] = 'offer.code';
      }
    }

    updateStep(activeStepIndex, {
      templateRef: {
        id: tmpl.id,
        revision: tmpl.revision,
        language: tmpl.language || 'en'
      },
      bindings: initialBindings
    });
  };

  const updateBinding = (variableKey: string, sourceExpression: string) => {
    const newBindings = { ...(currentStep.bindings || {}), [variableKey]: sourceExpression };
    updateStep(activeStepIndex, { bindings: newBindings });
  };

  // Check offset ordering validity across steps
  let offsetsIncreasing = true;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].offsetDays <= steps[i - 1].offsetDays) {
      offsetsIncreasing = false;
      break;
    }
  }

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#C99726]" />
          <span>Step 3: Message Sequence &amp; WhatsApp Templates</span>
        </h2>
        <p className="text-xs text-[#6B5E59] mt-1">
          Configure 1 to 3 sequential touchpoints, map variables to allowlisted CRM data, and inspect the live preview.
        </p>
      </div>

      {/* Sequence Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#EAE4DC] p-3 rounded-2xl shadow-2xs">
        <div className="flex items-center gap-2">
          {steps.map((st, idx) => (
            <button
              key={st.stepId || idx}
              type="button"
              onClick={() => setActiveStepIndex(idx)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                activeStepIndex === idx
                  ? 'bg-[#5C1D24] text-white shadow-xs'
                  : 'bg-[#FAF8F5] text-[#6B5E59] border border-[#EAE4DC] hover:bg-[#F3EFE8]'
              }`}
            >
              <span>Step {idx + 1}: {st.stepId}</span>
              <span className="text-[10px] font-mono opacity-80">
                ({st.offsetDays >= 0 ? `+${st.offsetDays}d` : `${st.offsetDays}d`})
              </span>
            </button>
          ))}

          {steps.length < 3 && !disabled && (
            <button
              type="button"
              onClick={handleAddStep}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-dashed border-[#C99726] bg-[#FEF9EE] text-xs font-semibold text-[#8F6910] hover:bg-[#FDF5E6] transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Step ({steps.length}/3)</span>
            </button>
          )}
        </div>

        {steps.length > 1 && !disabled && (
          <button
            type="button"
            onClick={() => handleRemoveStep(activeStepIndex)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#9E2A2B] hover:bg-[#FDF2F2] transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove Step</span>
          </button>
        )}
      </div>

      {/* Offsets Warning */}
      {!offsetsIncreasing && (
        <div className="p-3.5 rounded-xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
          <span>
            <strong>Chronological Invariant Violation:</strong> Step day offsets must strictly increase from step to step (e.g. Step 1 at -14d, Step 2 at -7d, Step 3 at 0d).
          </span>
        </div>
      )}

      {/* Main Grid: Left Config Panel, Right WhatsApp Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Step Configuration (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Step Identity & Schedule */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
            <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
              Step Schedule &amp; Prerequisites
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                  Stable Step ID
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={currentStep.stepId}
                  onChange={(e) => updateStep(activeStepIndex, { stepId: e.target.value.trim() })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden font-mono"
                />
                <p className="text-[10px] text-[#988B86] mt-1">
                  Immutable identifier (never array index).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                  Signed Day Offset
                </label>
                <input
                  type="number"
                  disabled={disabled}
                  value={currentStep.offsetDays}
                  onChange={(e) => updateStep(activeStepIndex, { offsetDays: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden font-mono"
                />
                <p className="text-[10px] text-[#988B86] mt-1">
                  Relative to trigger date (e.g. -14 or 0).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                  Sequential Prerequisite
                </label>
                <select
                  disabled={disabled || activeStepIndex === 0}
                  value={activeStepIndex === 0 ? 'NONE' : currentStep.prerequisite}
                  onChange={(e) => updateStep(activeStepIndex, { prerequisite: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
                >
                  <option value="NONE">NONE (Unconditional)</option>
                  <option value="PREVIOUS_ACCEPTED">PREVIOUS_ACCEPTED (Step 1 Must Deliver)</option>
                </select>
                <p className="text-[10px] text-[#988B86] mt-1">
                  Guarantees follow-ups only reach engaged patrons.
                </p>
              </div>
            </div>
          </div>

          {/* 2. Approved WhatsApp Template Picker */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
                Approved Template Catalogue Selection
              </h3>
              <span className="text-[10px] text-[#1B7A43] bg-[#EBF7EE] px-2 py-0.5 rounded border border-[#C3E8CB]">
                Meta Approved
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                Select Approved Message Template
              </label>
              <select
                disabled={disabled}
                value={currentStep.templateRef?.id || ''}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden"
              >
                <option value="">-- Choose Approved Template --</option>
                {approvedTemplates.map((tmpl) => (
                  <option
                    key={tmpl.id}
                    value={tmpl.id}
                    disabled={tmpl.status === 'PAUSED'}
                  >
                    {tmpl.name} ({tmpl.category} • rev {tmpl.revision} • {tmpl.language})
                    {tmpl.status === 'PAUSED' ? ' [PAUSED BY META]' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-[#988B86] mt-1">
                WhatsApp templates are pre-approved by Meta. New templates must be submitted by the integration developer.
              </p>
            </div>
          </div>

          {/* 3. Parameter Binding Mapper */}
          {selectedTemplate && (
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
              <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
                Template Variable Mapping ({selectedTemplate.name})
              </h3>
              <p className="text-xs text-[#6B5E59]">
                Map each variable defined in the WhatsApp template body to an allowlisted customer or boutique attribute.
              </p>

              <div className="space-y-3">
                {(selectedTemplate.variableKeys || []).map((varKey) => {
                  const currentBinding = currentStep.bindings?.[varKey] || '';

                  return (
                    <div
                      key={varKey}
                      className="flex flex-col sm:flex-row items-center gap-3 p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]"
                    >
                      <div className="w-32 shrink-0 font-mono text-xs font-bold text-[#5C1D24] flex items-center gap-1">
                        <span>{`{{${varKey}}}`}</span>
                      </div>

                      <select
                        disabled={disabled}
                        value={currentBinding}
                        onChange={(e) => updateBinding(varKey, e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                      >
                        <option value="">-- Select Allowlisted Source --</option>
                        {ALLOWLISTED_BINDING_SOURCES.map((source) => (
                          <option key={source.value} value={source.value}>
                            {source.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Step Level Safeguard Rules */}
          <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-3">
            <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
              Step Safeguard Controls
            </h3>

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC] cursor-pointer">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(currentStep.stopOnReply)}
                  onChange={(e) => updateStep(activeStepIndex, { stopOnReply: e.target.checked })}
                  className="w-4 h-4 text-[#5C1D24] rounded border-[#EAE4DC] mt-0.5"
                />
                <div className="text-xs text-[#2A1D1A]">
                  <span className="font-bold block">Stop on Inbound Customer Reply (Staff Hold)</span>
                  <span className="text-[#6B5E59] text-[11px] block mt-0.5">
                    If the patron replies on WhatsApp, holds further automated messages and alerts store staff in Activity.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC] cursor-pointer">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(currentStep.stopOnGoal)}
                  onChange={(e) => updateStep(activeStepIndex, { stopOnGoal: e.target.checked })}
                  className="w-4 h-4 text-[#5C1D24] rounded border-[#EAE4DC] mt-0.5"
                />
                <div className="text-xs text-[#2A1D1A]">
                  <span className="font-bold block">Stop on Goal Completion Purchase</span>
                  <span className="text-[#6B5E59] text-[11px] block mt-0.5">
                    Automatically halts follow-ups as soon as the patron completes an in-store or online order.
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Right: Live WhatsApp Simulator (5 cols) */}
        <div className="lg:col-span-5 sticky top-6 self-start space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-serif text-xs font-bold text-[#2A1D1A]">
              Live Delivery Preview
            </span>
            <span className="text-[10px] text-[#C99726] font-semibold">
              Step {activeStepIndex + 1}
            </span>
          </div>

          <WhatsAppSimulator
            template={selectedTemplate}
            bindings={currentStep.bindings}
            storeDisplayName={storeDisplayName}
          />
        </div>
      </div>
    </div>
  );
}
