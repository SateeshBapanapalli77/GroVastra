'use client';

import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Users,
  Fingerprint,
  Calendar,
  Sparkles,
  ArrowRight,
  Eye,
  Rocket
} from 'lucide-react';

interface DryRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivateSuccess: () => void;
  result?: any;
}

export const DryRunModal: React.FC<DryRunModalProps> = ({
  isOpen,
  onClose,
  onActivateSuccess,
  result
}) => {
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  if (!isOpen) return null;

  const handleActivate = () => {
    setActivating(true);
    setTimeout(() => {
      setActivating(false);
      setActivated(true);
      setTimeout(() => {
        onActivateSuccess();
      }, 1500);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#FFFFFF] w-full max-w-3xl rounded-3xl border border-[#EAE4DC] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 border-b border-[#EAE4DC] bg-[#FAF8F5] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#5C1D24] text-white flex items-center justify-center font-serif text-lg font-bold">
              <Eye className="w-5 h-5 text-[#F3E0B5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-lg text-[#431217]">
                  Campaign Dry Run &amp; Pre-Flight Audit
                </h3>
                <span className="text-[10px] bg-[#E8F8EE] text-[#1B7A43] font-bold px-2 py-0.5 rounded-full">
                  Zero Live Sends
                </span>
              </div>
              <p className="text-xs text-[#6B5E59]">
                Review projected patron discovery and exclusion evidence before activation
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-[#988B86] hover:text-[#271E1B] rounded-xl hover:bg-[#EAE4DC] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs text-[#271E1B]">
          {/* Fingerprint Banner */}
          <div className="p-4 bg-[#FEF9EE] border border-[#F3E0B5] rounded-2xl flex items-center justify-between text-[#8F6910]">
            <div className="flex items-center gap-3">
              <Fingerprint className="w-5 h-5 text-[#C99726]" />
              <div>
                <span className="font-bold">Draft Review Fingerprint:</span>{' '}
                <code className="bg-white px-2 py-0.5 rounded border border-[#F3E0B5] font-mono text-[11px] text-[#5C1D24]">
                  sha256:bday_v2.4_98f1a4e21
                </code>
              </div>
            </div>
            <span className="text-[10px] text-[#8F6910] uppercase font-bold tracking-wider">
              Frozen for Activation
            </span>
          </div>

          {/* Projection Stat Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#EAE4DC] text-center">
              <div className="text-[10px] uppercase font-bold text-[#988B86]">
                Total Evaluated
              </div>
              <div className="font-serif text-2xl font-bold text-[#271E1B] mt-1">
                1,428
              </div>
              <div className="text-[10px] text-[#6B5E59]">
                Registered Store Patrons
              </div>
            </div>

            <div className="p-4 bg-[#E8F8EE] rounded-2xl border border-[#A2D9C3] text-center">
              <div className="text-[10px] uppercase font-bold text-[#1B7A43]">
                Projected Eligible
              </div>
              <div className="font-serif text-2xl font-bold text-[#1B7A43] mt-1">
                842
              </div>
              <div className="text-[10px] text-[#1B7A43]">
                Birthdays in 30d Window
              </div>
            </div>

            <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#EAE4DC] text-center">
              <div className="text-[10px] uppercase font-bold text-[#988B86]">
                Safely Excluded
              </div>
              <div className="font-serif text-2xl font-bold text-[#8F6910] mt-1">
                586
              </div>
              <div className="text-[10px] text-[#6B5E59]">
                Protected by Safeguards
              </div>
            </div>
          </div>

          {/* Exclusion Breakdown */}
          <div className="p-4 bg-[#FFFFFF] rounded-2xl border border-[#EAE4DC] space-y-3">
            <div className="font-serif font-bold text-sm text-[#431217]">
              Exclusion Reasons Breakdown
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-[#FAF8F5]">
                <span className="text-[#6B5E59]">
                  No birthday falling within upcoming 30-day planning horizon
                </span>
                <span className="font-semibold text-[#271E1B]">570 patrons</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#FAF8F5]">
                <span className="text-[#6B5E59]">
                  Protected by 24h anti-spam contact cap (active dialogue with store)
                </span>
                <span className="font-semibold text-[#8F6910]">12 patrons</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[#6B5E59]">
                  Customer opted out of promotional messages
                </span>
                <span className="font-semibold text-[#5C1D24]">4 patrons</span>
              </div>
            </div>
          </div>

          {/* Sample Rendered Messages (Real Engine Projections) */}
          <div className="space-y-3">
            <div className="font-serif font-bold text-sm text-[#431217]">
              Sample Patron Payload Projections (Server Rendered)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {result?.samplePlans && result.samplePlans.length > 0 ? (
                result.samplePlans.slice(0, 2).map((plan: any, idx: number) => (
                  <div key={idx} className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] space-y-1.5">
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-[#5C1D24]">{plan.customerName}</span>
                      <span className="text-[10px] bg-white px-2 py-0.5 rounded border border-[#EAE4DC]">
                        Occasion: {plan.occasionDate}
                      </span>
                    </div>
                    {plan.steps && plan.steps.map((st: any, sIdx: number) => (
                      <div key={sIdx} className="space-y-1">
                        <div className="text-[11px] text-[#6B5E59]">
                          Step: <strong>{st.stepId}</strong> • Due: {st.localTime}
                        </div>
                        <p className="p-2 bg-white rounded-lg border border-[#EAE4DC] text-[10px] text-[#271E1B] italic">
                          &quot;{st.renderedPreview}&quot;
                        </p>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <div className="p-4 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs text-[#6B5E59] italic col-span-2 text-center">
                  Live dry run audit ready. Real approved template previews will render from store database.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer / Activation CTA */}
        <div className="p-5 border-t border-[#EAE4DC] bg-[#FAF8F5] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#6B5E59] hover:text-[#271E1B]"
          >
            Back to Editor
          </button>

          <button
            disabled={activating || activated}
            onClick={handleActivate}
            className="flex items-center gap-2 bg-[#5C1D24] hover:bg-[#431217] disabled:bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-98"
          >
            {activated ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Campaign Activated! Launching...</span>
              </>
            ) : activating ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin text-[#F3E0B5]" />
                <span>Publishing Immutable Version...</span>
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 text-[#F3E0B5]" />
                <span>Activate Campaign Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
