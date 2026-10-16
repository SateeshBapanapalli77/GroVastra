'use client';

import React from 'react';
import { Users, Plus, Trash2, ShieldAlert, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import {
  ALLOWLISTED_AUDIENCE_FIELDS,
  ALLOWLISTED_AUDIENCE_OPERATORS,
  RulePredicate
} from './wizardSchema';

interface Step2AudienceProps {
  audienceData: any;
  onChange: (updatedAudience: any) => void;
  disabled?: boolean;
}

export function Step2Audience({ audienceData, onChange, disabled = false }: Step2AudienceProps) {
  const mode = audienceData?.mode || 'ALL_ELIGIBLE';
  const rules = audienceData?.rules || { all: [], any: [], none: [] };

  const setMode = (newMode: 'ALL_ELIGIBLE' | 'RULE_BASED') => {
    onChange({
      ...audienceData,
      mode: newMode
    });
  };

  const addPredicate = (section: 'all' | 'any' | 'none') => {
    const currentList = rules[section] || [];
    const newPredicate: RulePredicate = {
      field: 'customer.tags',
      op: 'contains',
      value: 'VIP'
    };
    onChange({
      ...audienceData,
      mode: 'RULE_BASED',
      rules: {
        ...rules,
        [section]: [...currentList, newPredicate]
      }
    });
  };

  const updatePredicate = (
    section: 'all' | 'any' | 'none',
    index: number,
    updated: Partial<RulePredicate>
  ) => {
    const currentList = [...(rules[section] || [])];
    currentList[index] = { ...currentList[index], ...updated };
    onChange({
      ...audienceData,
      rules: {
        ...rules,
        [section]: currentList
      }
    });
  };

  const removePredicate = (section: 'all' | 'any' | 'none', index: number) => {
    const currentList = (rules[section] || []).filter((_: any, i: number) => i !== index);
    onChange({
      ...audienceData,
      rules: {
        ...rules,
        [section]: currentList
      }
    });
  };

  const totalPredicates =
    (rules.all?.length || 0) + (rules.any?.length || 0) + (rules.none?.length || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
          <Users className="w-5 h-5 text-[#C99726]" />
          <span>Step 2: Audience Qualification &amp; Rules</span>
        </h2>
        <p className="text-xs text-[#6B5E59] mt-1">
          Specify which boutique patrons are enrolled into this sequence, or target all eligible customers.
        </p>
      </div>

      {/* Mode Selection */}
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-4">
        <label className="block text-xs font-bold text-[#2A1D1A]">
          Audience Targeting Mode
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('ALL_ELIGIBLE')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              mode === 'ALL_ELIGIBLE'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-serif font-bold text-xs text-[#431217]">
                All Eligible Boutique Patrons
              </span>
              <CheckCircle2
                className={`w-4 h-4 ${mode === 'ALL_ELIGIBLE' ? 'text-[#C99726]' : 'text-transparent'}`}
              />
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Every patron with a valid occasion/event date who passes all preflight safeguards is automatically enrolled.
            </p>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('RULE_BASED')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              mode === 'RULE_BASED'
                ? 'bg-[#FEF9EE] border-[#C99726] shadow-xs ring-1 ring-[#C99726]'
                : 'bg-[#FAF8F5] border-[#EAE4DC] hover:border-[#C99726]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-serif font-bold text-xs text-[#431217]">
                Segmented Rule Builder (All / Any / None)
              </span>
              <CheckCircle2
                className={`w-4 h-4 ${mode === 'RULE_BASED' ? 'text-[#C99726]' : 'text-transparent'}`}
              />
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Target by tags (e.g. VIP, Bridal), weave preference, spend tier, or language using allowlisted operators.
            </p>
          </button>
        </div>
      </div>

      {/* Rule Builder Container */}
      {mode === 'RULE_BASED' && (
        <div className="bg-white border border-[#EAE4DC] rounded-2xl p-5 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-[#EAE4DC] pb-3">
            <div>
              <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
                Patron Predicate Conditions
              </h3>
              <p className="text-[11px] text-[#6B5E59]">
                Structured rule evaluator executing safe allowlisted comparisons against customer documents.
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#8F6910]">
              {totalPredicates} Condition{totalPredicates === 1 ? '' : 's'} Active
            </span>
          </div>

          {totalPredicates === 0 && (
            <div className="p-4 rounded-xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
              <span>
                <strong>Audience Validation Warning:</strong> An empty audience is invalid under RULE_BASED mode. Add at least one condition below, or choose <em>All Eligible Boutique Patrons</em>.
              </span>
            </div>
          )}

          {/* Section: ALL (AND) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#2A1D1A] flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-[#5C1D24] text-white text-[10px] uppercase font-mono font-bold">
                  ALL
                </span>
                <span>All of these conditions must match (Logical AND)</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => addPredicate('all')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C1D24] hover:text-[#73232C] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Condition</span>
              </button>
            </div>

            {(rules.all || []).length === 0 ? (
              <p className="text-[11px] text-[#988B86] italic pl-2">No &quot;ALL&quot; conditions added.</p>
            ) : (
              <div className="space-y-2">
                {rules.all.map((pred: RulePredicate, idx: number) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]"
                  >
                    <select
                      disabled={disabled}
                      value={pred.field}
                      onChange={(e) => updatePredicate('all', idx, { field: e.target.value })}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    >
                      {ALLOWLISTED_AUDIENCE_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    <select
                      disabled={disabled}
                      value={pred.op}
                      onChange={(e) => updatePredicate('all', idx, { op: e.target.value as any })}
                      className="w-36 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden font-mono"
                    >
                      {ALLOWLISTED_AUDIENCE_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      disabled={disabled}
                      value={pred.value}
                      placeholder="Value"
                      onChange={(e) => updatePredicate('all', idx, { value: e.target.value })}
                      className="w-48 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    />

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removePredicate('all', idx)}
                      className="p-1.5 text-[#988B86] hover:text-[#9E2A2B] rounded-lg hover:bg-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: ANY (OR) */}
          <div className="space-y-3 pt-3 border-t border-[#F3EFE8]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#2A1D1A] flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-[#C99726] text-white text-[10px] uppercase font-mono font-bold">
                  ANY
                </span>
                <span>At least one of these conditions must match (Logical OR)</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => addPredicate('any')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C1D24] hover:text-[#73232C] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Condition</span>
              </button>
            </div>

            {(rules.any || []).length === 0 ? (
              <p className="text-[11px] text-[#988B86] italic pl-2">No &quot;ANY&quot; conditions added.</p>
            ) : (
              <div className="space-y-2">
                {rules.any.map((pred: RulePredicate, idx: number) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]"
                  >
                    <select
                      disabled={disabled}
                      value={pred.field}
                      onChange={(e) => updatePredicate('any', idx, { field: e.target.value })}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    >
                      {ALLOWLISTED_AUDIENCE_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    <select
                      disabled={disabled}
                      value={pred.op}
                      onChange={(e) => updatePredicate('any', idx, { op: e.target.value as any })}
                      className="w-36 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden font-mono"
                    >
                      {ALLOWLISTED_AUDIENCE_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      disabled={disabled}
                      value={pred.value}
                      placeholder="Value"
                      onChange={(e) => updatePredicate('any', idx, { value: e.target.value })}
                      className="w-48 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    />

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removePredicate('any', idx)}
                      className="p-1.5 text-[#988B86] hover:text-[#9E2A2B] rounded-lg hover:bg-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: NONE (NOT) */}
          <div className="space-y-3 pt-3 border-t border-[#F3EFE8]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#2A1D1A] flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-[#9E2A2B] text-white text-[10px] uppercase font-mono font-bold">
                  NONE
                </span>
                <span>Exclude patrons matching any of these (Logical NOT)</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => addPredicate('none')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C1D24] hover:text-[#73232C] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Condition</span>
              </button>
            </div>

            {(rules.none || []).length === 0 ? (
              <p className="text-[11px] text-[#988B86] italic pl-2">No &quot;NONE&quot; exclusion conditions added.</p>
            ) : (
              <div className="space-y-2">
                {rules.none.map((pred: RulePredicate, idx: number) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DC]"
                  >
                    <select
                      disabled={disabled}
                      value={pred.field}
                      onChange={(e) => updatePredicate('none', idx, { field: e.target.value })}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    >
                      {ALLOWLISTED_AUDIENCE_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    <select
                      disabled={disabled}
                      value={pred.op}
                      onChange={(e) => updatePredicate('none', idx, { op: e.target.value as any })}
                      className="w-36 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden font-mono"
                    >
                      {ALLOWLISTED_AUDIENCE_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      disabled={disabled}
                      value={pred.value}
                      placeholder="Value"
                      onChange={(e) => updatePredicate('none', idx, { value: e.target.value })}
                      className="w-48 px-2.5 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden"
                    />

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removePredicate('none', idx)}
                      className="p-1.5 text-[#988B86] hover:text-[#9E2A2B] rounded-lg hover:bg-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mandatory Safeguard Gates (Read-Only per Spec p.10 & DECISIONS.md) */}
      <div className="bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[#C99726]" />
          <h3 className="font-serif text-xs font-bold text-[#431217]">
            Mandatory Safeguard Preflight Gates (Always Active &amp; Enforced)
          </h3>
        </div>
        <p className="text-[11px] text-[#6B5E59] leading-relaxed">
          Regardless of audience rules, every patron evaluation must pass these 9 strict preflight gates before any WhatsApp delivery intent is frozen:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-[11px] text-[#431217]">
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>1. Patron Consent:</strong> Excludes deleted, channel-suppressed, or opt-out patrons.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>2. Control Gates:</strong> Honors tenant-wide and campaign-level pause switches.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>3. Source Validity:</strong> Verifies active customer enrollment &amp; stock availability.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>4. Expiry Window:</strong> Skips steps that passed max lateness threshold.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>5. Stop on Reply / Goal:</strong> Immediate hold if customer replied or completed purchase.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>6. Meta Template:</strong> Verifies template is approved, unpaused, and mapped.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>7. Sequential Prerequisite:</strong> Step 2/3 requires step 1 accepted.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>8. Anti-Spam Contact Caps:</strong> Strictly limits marketing messages to 1/24h and 3/7d.
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-[#EAE4DC]">
            <strong>9. Quiet Hours:</strong> Defers sends outside 10:00–19:00 or on store blackout dates.
          </div>
        </div>
      </div>
    </div>
  );
}
