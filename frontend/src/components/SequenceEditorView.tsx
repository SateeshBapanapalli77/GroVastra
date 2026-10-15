'use client';

import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  Info,
  ShieldCheck,
  Lock,
  ArrowRight,
  Send,
  Save,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { WhatsAppPhoneSimulator } from './WhatsAppPhoneSimulator';

interface SequenceEditorViewProps {
  onBackToDashboard: () => void;
  onOpenDryRun: () => void;
}

export const SequenceEditorView: React.FC<SequenceEditorViewProps> = ({
  onBackToDashboard,
  onOpenDryRun
}) => {
  const [activeStepTab, setActiveStepTab] = useState<1 | 2 | 3>(1);
  const [testSent, setTestSent] = useState(false);
  const [stopOnReply1, setStopOnReply1] = useState(true);
  const [stopOnGoal1, setStopOnGoal1] = useState(true);
  const [stopOnReply2, setStopOnReply2] = useState(true);
  const [stopOnGoal2, setStopOnGoal2] = useState(true);

  // Stepper steps
  const wizardSteps = [
    { num: 1, label: 'Trigger', sub: 'D-14 Auto Event', state: 'completed' },
    { num: 2, label: 'Audience', sub: 'VIP Patrons (1,840)', state: 'completed' },
    { num: 3, label: 'Messages', sub: '3-Step Cadence', state: 'active' },
    { num: 4, label: 'Sending Rules', sub: 'Quiet Hours & Cap', state: 'pending' },
    { num: 5, label: 'Review', sub: 'Simulate & Launch', state: 'pending' }
  ];

  const handleSendTest = () => {
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Title & Top Meta */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EAE4DC] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#6B5E59]">
            <button
              onClick={onBackToDashboard}
              className="hover:text-[#5C1D24] transition-colors"
            >
              Auto Campaigns
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#988B86]" />
            <span>Birthday Shopping Sequence</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#988B86]" />
            <span className="font-semibold text-[#271E1B]">Sequence Editor</span>
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            <h1 className="font-serif text-2xl font-bold text-[#431217]">
              Campaign Sequence Architecture
            </h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]">
              V2.4 DRAFT
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-[#6B5E59] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Draft saved 10:42 AM IST
          </span>
          <span className="px-2.5 py-1 rounded-full bg-[#FFFFFF] border border-[#EAE4DC] text-[#271E1B] font-medium shadow-2xs">
            Meta Cloud API Connected
          </span>
        </div>
      </div>

      {/* Upstream Settings Modified Banner */}
      <div className="p-4 bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl flex items-center justify-between text-xs text-[#8F6910] shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-1 rounded-full bg-[#C99726] text-white">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold">Upstream Settings Modified</span> (15 mins ago) — Settings were updated by integration specialist (Ananth R.) — audience filter attributes were refreshed. Please review message mappings prior to live dispatch.
          </div>
        </div>
        <button className="px-3 py-1.5 bg-[#FFFFFF] border border-[#F3E0B5] hover:bg-[#FAF8F5] text-[#8F6910] font-semibold rounded-lg text-xs shadow-2xs whitespace-nowrap ml-4">
          Review Delta
        </button>
      </div>

      {/* 5-Step Stepper Bar */}
      <div className="bg-[#FFFFFF] p-4 rounded-2xl border border-[#EAE4DC] shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {wizardSteps.map((step) => (
            <div
              key={step.num}
              onClick={() => {
                if (step.num === 5) onOpenDryRun();
              }}
              className={`p-3 rounded-xl border transition-all flex items-center gap-3 cursor-pointer ${
                step.state === 'active'
                  ? 'bg-[#FDF5F6] border-[#5C1D24] shadow-xs'
                  : step.state === 'completed'
                  ? 'bg-[#FFFFFF] border-[#EAE4DC] hover:border-[#D4AF37]'
                  : 'bg-[#FAF8F5] border-transparent opacity-60'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  step.state === 'completed'
                    ? 'bg-[#5C1D24] text-white'
                    : step.state === 'active'
                    ? 'bg-[#5C1D24] text-white ring-2 ring-[#C99726]'
                    : 'bg-[#EAE4DC] text-[#6B5E59]'
                }`}
              >
                {step.state === 'completed' ? (
                  <Check className="w-3.5 h-3.5 stroke-3" />
                ) : (
                  step.num
                )}
              </div>
              <div className="truncate text-left">
                <div
                  className={`text-xs font-bold truncate ${
                    step.state === 'active' ? 'text-[#5C1D24]' : 'text-[#271E1B]'
                  }`}
                >
                  {step.num}. {step.label}
                </div>
                <div className="text-[10px] text-[#6B5E59] truncate">
                  {step.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2-Column Campaign Sequence Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Sequence Step Configurator (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Read-Only Approved Template Catalogue Notice */}
          <div className="p-4 bg-[#FFFFFF] rounded-2xl border border-[#EAE4DC] text-xs space-y-1.5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#271E1B] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#C99726]" /> Approved Template Catalogue (Read-Only)
              </span>
              <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] font-bold px-2 py-0.5 rounded border border-[#F3E0B5]">
                WhatsApp Tier 2
              </span>
            </div>
            <p className="text-[11px] text-[#6B5E59] leading-relaxed">
              Under Meta Commercial messaging policies, only pre-screened utility and marketing templates can be staged in autonomous sequences for your boutique. Template creation and parameter modifications are managed via your GroVastra Account Liaison.
            </p>
          </div>

          {/* STEP 1 Card */}
          <div
            onClick={() => setActiveStepTab(1)}
            className={`p-6 bg-[#FFFFFF] rounded-2xl border transition-all space-y-5 shadow-xs cursor-pointer ${
              activeStepTab === 1
                ? 'border-[#5C1D24] ring-2 ring-[#5C1D24]/10'
                : 'border-[#EAE4DC] hover:border-[#D4AF37]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-[#5C1D24] text-white text-[11px] font-bold rounded-lg uppercase tracking-wider">
                  Step 01
                </span>
                <div>
                  <h3 className="font-serif font-bold text-base text-[#431217]">
                    Birthday Invitation (14 Days Prior)
                  </h3>
                  <p className="text-[11px] text-[#6B5E59]">
                    T-Minus 14 Days Before Patron Date of Birth
                  </p>
                </div>
              </div>
              <span className="text-[10px] bg-[#E8F8EE] text-[#1B7A43] px-2 py-0.5 rounded font-bold">
                Active Cadence
              </span>
            </div>

            {/* Template Selector Card */}
            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between text-xs">
              <div>
                <div className="text-[10px] text-[#988B86] uppercase font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3 text-[#C99726]" /> Meta Approved HSM Template
                </div>
                <div className="font-bold text-[#271E1B] mt-0.5">
                  bday_exclusive_invite_v2
                </div>
                <div className="text-[10px] text-[#6B5E59]">
                  Telugu + English Bilingual Greeting
                </div>
              </div>
              <span className="px-2.5 py-1 bg-[#E8F8EE] text-[#1B7A43] text-[10px] font-bold rounded-full">
                Approved
              </span>
            </div>

            {/* Variable Mapping Table */}
            <div>
              <div className="text-[11px] font-bold text-[#271E1B] mb-2 uppercase tracking-wide">
                HSM Variable Mapping Table
              </div>
              <div className="border border-[#EAE4DC] rounded-xl overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-[#FAF8F5] p-2 font-bold text-[#6B5E59] text-[10px] uppercase border-b border-[#EAE4DC]">
                  <div>Placeholder</div>
                  <div>Field Attribute Source</div>
                  <div>Sample Output Preview</div>
                </div>
                <div className="divide-y divide-[#EAE4DC] bg-white">
                  <div className="grid grid-cols-3 p-2.5 items-center">
                    <span className="font-mono text-[#5C1D24] font-semibold text-[11px]">
                      {`{{1}} Customer Name`}
                    </span>
                    <span className="font-mono text-[#6B5E59] text-[11px]">
                      customer.first_name
                    </span>
                    <span className="font-medium text-[#271E1B]">
                      Sravani garu 🙏
                    </span>
                  </div>
                  <div className="grid grid-cols-3 p-2.5 items-center">
                    <span className="font-mono text-[#5C1D24] font-semibold text-[11px]">
                      {`{{2}} Boutique Name`}
                    </span>
                    <span className="font-mono text-[#6B5E59] text-[11px]">
                      store.brand_trade_name
                    </span>
                    <span className="font-medium text-[#271E1B]">
                      GroVastra Boutique
                    </span>
                  </div>
                  <div className="grid grid-cols-3 p-2.5 items-center">
                    <span className="font-mono text-[#5C1D24] font-semibold text-[11px]">
                      {`{{3}} Offer Variable`}
                    </span>
                    <span className="font-mono text-[#6B5E59] text-[11px]">
                      campaign.promo_privilege
                    </span>
                    <span className="font-semibold text-[#8F6910]">
                      Curated handloom preview
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Smart Stop Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] cursor-pointer hover:border-[#5C1D24]">
                <input
                  type="checkbox"
                  checked={stopOnReply1}
                  onChange={(e) => setStopOnReply1(e.target.checked)}
                  className="mt-0.5 rounded accent-[#5C1D24]"
                />
                <div className="text-xs">
                  <div className="font-bold text-[#271E1B]">
                    Stop on customer reply
                  </div>
                  <div className="text-[10px] text-[#6B5E59]">
                    Routes conversation to human weaver desk
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] cursor-pointer hover:border-[#5C1D24]">
                <input
                  type="checkbox"
                  checked={stopOnGoal1}
                  onChange={(e) => setStopOnGoal1(e.target.checked)}
                  className="mt-0.5 rounded accent-[#5C1D24]"
                />
                <div className="text-xs">
                  <div className="font-bold text-[#271E1B]">
                    Stop on purchase completed
                  </div>
                  <div className="text-[10px] text-[#6B5E59]">
                    Halts cadence upon billing sync
                  </div>
                </div>
              </label>
            </div>

            {/* Step 1 Footer */}
            <div className="pt-3 border-t border-[#F4EFE8] flex items-center justify-between text-[11px] text-[#988B86]">
              <span>Useful lifespan window: 14 days following birthdate trigger</span>
              <span className="font-bold text-[#5C1D24]">Priority: High (80)</span>
            </div>
          </div>

          {/* STEP 2 Card */}
          <div
            onClick={() => setActiveStepTab(2)}
            className={`p-6 bg-[#FFFFFF] rounded-2xl border transition-all space-y-4 shadow-xs cursor-pointer ${
              activeStepTab === 2
                ? 'border-[#5C1D24] ring-2 ring-[#5C1D24]/10'
                : 'border-[#EAE4DC] hover:border-[#D4AF37]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-[#FEF9EE] text-[#8F6910] text-[11px] font-bold rounded-lg border border-[#F3E0B5] uppercase tracking-wider">
                  Step 02
                </span>
                <div>
                  <h3 className="font-serif font-bold text-base text-[#431217]">
                    Bespoke Curations Reminder (7 Days Prior)
                  </h3>
                  <p className="text-[11px] text-[#6B5E59]">
                    T-Minus 7 Days Prior • Follow-Up Catalog
                  </p>
                </div>
              </div>
              <span className="text-[10px] bg-[#FAF8F5] text-[#8F6910] px-2 py-0.5 rounded font-bold border border-[#F3E0B5]">
                Conditional Flow
              </span>
            </div>

            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between text-xs">
              <div>
                <div className="text-[10px] text-[#988B86] uppercase font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3 text-[#C99726]" /> Meta Approved HSM Template
                </div>
                <div className="font-bold text-[#271E1B] mt-0.5">
                  bday_reminder_lookbook_v1
                </div>
              </div>
              <span className="px-2.5 py-1 bg-[#E8F8EE] text-[#1B7A43] text-[10px] font-bold rounded-full">
                Approved
              </span>
            </div>

            {/* Configured Parameters summary */}
            <div className="p-3 bg-white rounded-xl border border-[#EAE4DC] text-xs">
              <div className="text-[10px] font-bold uppercase text-[#988B86] mb-2">
                Configured Parameters
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="p-1.5 bg-[#FAF8F5] rounded-md border border-[#EAE4DC]">
                  <div className="text-[#6B5E59] font-medium">{`{{1}} Patron Salutation`}</div>
                  <div className="font-bold text-[#271E1B] truncate">customer.first_name</div>
                </div>
                <div className="p-1.5 bg-[#FAF8F5] rounded-md border border-[#EAE4DC]">
                  <div className="text-[#6B5E59] font-medium">{`{{2}} Staff Curator`}</div>
                  <div className="font-bold text-[#271E1B] truncate">store.senior_draper</div>
                </div>
                <div className="p-1.5 bg-[#FAF8F5] rounded-md border border-[#EAE4DC]">
                  <div className="text-[#6B5E59] font-medium">{`{{3}} Featured Weave`}</div>
                  <div className="font-bold text-[#271E1B] truncate">Kanchipuram & Banaras...</div>
                </div>
              </div>
            </div>

            {/* Prerequisite Condition */}
            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between text-xs">
              <span className="font-bold text-[#271E1B] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#C99726]" /> Prerequisite Condition:
              </span>
              <span className="text-[#8F6910] font-semibold text-[11px]">
                Only if Step 01 message was accepted &amp; delivered
              </span>
            </div>
          </div>

          {/* STEP 3 Card */}
          <div
            onClick={() => setActiveStepTab(3)}
            className={`p-6 bg-[#FFFFFF] rounded-2xl border transition-all space-y-4 shadow-xs cursor-pointer ${
              activeStepTab === 3
                ? 'border-[#5C1D24] ring-2 ring-[#5C1D24]/10'
                : 'border-[#EAE4DC] hover:border-[#D4AF37]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-[#FEF9EE] text-[#8F6910] text-[11px] font-bold rounded-lg border border-[#F3E0B5] uppercase tracking-wider">
                  Step 03
                </span>
                <div>
                  <h3 className="font-serif font-bold text-base text-[#431217]">
                    Day-of Warm Greetings (Birthday Morning)
                  </h3>
                  <p className="text-[11px] text-[#6B5E59]">
                    Day of Event (D0) • Auspicious Morning Greeting
                  </p>
                </div>
              </div>
              <span className="text-[10px] bg-[#FEF9EE] text-[#8F6910] px-2 py-0.5 rounded font-bold border border-[#F3E0B5]">
                Fixed Day Schedule
              </span>
            </div>

            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between text-xs">
              <div>
                <div className="text-[10px] text-[#988B86] uppercase font-bold flex items-center gap-1">
                  <Lock className="w-3 h-3 text-[#C99726]" /> Meta Approved HSM Template
                </div>
                <div className="font-bold text-[#271E1B] mt-0.5">
                  bday_wishes_greeting_v3
                </div>
              </div>
              <span className="px-2.5 py-1 bg-[#E8F8EE] text-[#1B7A43] text-[10px] font-bold rounded-full">
                Approved
              </span>
            </div>

            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#C99726]" />
                <span className="text-[#6B5E59]">
                  Always dispatches greeting on actual patron birth date exactly at:
                </span>
              </div>
              <span className="font-bold text-[#431217]">10:00 AM IST</span>
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="p-4 bg-[#FFFFFF] rounded-2xl border border-[#EAE4DC] shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#6B5E59] hover:text-[#5C1D24] px-3 py-2 rounded-lg hover:bg-[#FAF8F5]"
            >
              <Save className="w-4 h-4" />
              <span>Save as draft</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSendTest}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  testSent
                    ? 'bg-[#E8F8EE] border-[#25D366] text-[#1B7A43]'
                    : 'bg-[#FFFFFF] border-[#EAE4DC] text-[#271E1B] hover:border-[#5C1D24]'
                }`}
              >
                {testSent ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Sent to +91 98490 12345</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 text-[#5C1D24]" />
                    <span>Send test to my number</span>
                  </>
                )}
              </button>

              <button
                onClick={onOpenDryRun}
                className="flex items-center gap-2 bg-[#5C1D24] hover:bg-[#431217] text-white px-5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-98"
              >
                <span>Continue to Sending Rules</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Live WhatsApp Phone Simulator (5 Cols) */}
        <div className="lg:col-span-5 sticky top-24">
          <WhatsAppPhoneSimulator
            activeStep={activeStepTab}
            onSelectStep={setActiveStepTab}
          />
        </div>
      </div>
    </div>
  );
};
