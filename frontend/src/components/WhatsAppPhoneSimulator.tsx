'use client';

import React from 'react';
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  CheckCheck,
  MapPin,
  BookOpen,
  Sparkles,
  Wifi,
  BatteryMedium,
  CheckCircle2
} from 'lucide-react';

interface WhatsAppSimulatorProps {
  activeStep: 1 | 2 | 3;
  onSelectStep: (step: 1 | 2 | 3) => void;
  customerName?: string;
  storeName?: string;
  offerText?: string;
}

export const WhatsAppPhoneSimulator: React.FC<WhatsAppSimulatorProps> = ({
  activeStep,
  onSelectStep,
  customerName = 'Sravani garu 🙏',
  storeName = 'GroVastra Boutique',
  offerText = 'Curated festive preview'
}) => {
  return (
    <div className="flex flex-col items-center">
      {/* Header and Step Selector Tabs */}
      <div className="w-full flex items-center justify-between mb-4">
        <div>
          <h3 className="font-serif text-sm font-bold text-[#431217]">
            Live Preview: Step 0{activeStep}
          </h3>
          <p className="text-[11px] text-[#6B5E59]">
            Rendered via Meta WhatsApp Cloud Graph API simulator
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#FFFFFF] p-1 rounded-lg border border-[#EAE4DC] shadow-xs">
          {[1, 2, 3].map((step) => (
            <button
              key={step}
              onClick={() => onSelectStep(step as 1 | 2 | 3)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                activeStep === step
                  ? 'bg-[#5C1D24] text-white shadow-xs'
                  : 'text-[#6B5E59] hover:bg-[#F3EFE8]'
              }`}
            >
              Step {step}
            </button>
          ))}
        </div>
      </div>

      {/* Realistic Smartphone Chassis */}
      <div className="w-[340px] h-[670px] bg-[#111111] rounded-[44px] p-3 shadow-2xl border-4 border-[#2A2A2A] relative flex flex-col overflow-hidden">
        {/* Dynamic Island / Notch */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-28 h-4 bg-black rounded-full z-20 flex items-center justify-end px-2">
          <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
        </div>

        {/* Screen Bezel Area */}
        <div className="w-full h-full bg-[#E5DDD5] rounded-[34px] flex flex-col overflow-hidden relative">
          {/* Status Bar */}
          <div className="h-8 bg-[#075E54] text-white px-5 flex items-center justify-between text-[11px] pt-1 z-10 shrink-0">
            <span className="font-semibold">10:00</span>
            <div className="flex items-center gap-1.5 opacity-90">
              <Wifi className="w-3 h-3" />
              <BatteryMedium className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* WhatsApp Header */}
          <div className="h-14 bg-[#075E54] text-white px-3 flex items-center justify-between shadow-md shrink-0 z-10">
            <div className="flex items-center gap-2 overflow-hidden">
              <ArrowLeft className="w-4 h-4 cursor-pointer" />
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-[#5C1D24] border border-[#F3E0B5] flex items-center justify-center font-serif text-sm font-bold text-[#F3E0B5] shrink-0">
                P
              </div>
              <div className="truncate text-left">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-xs truncate max-w-[140px]">
                    {storeName}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#25D366] fill-[#25D366] stroke-[#075E54] shrink-0" />
                </div>
                <div className="text-[10px] text-[#A2D9C3] leading-none">
                  Official Business Account
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-white/90">
              <Video className="w-4 h-4 cursor-pointer hover:text-white" />
              <Phone className="w-3.5 h-3.5 cursor-pointer hover:text-white" />
              <MoreVertical className="w-4 h-4 cursor-pointer hover:text-white" />
            </div>
          </div>

          {/* Chat Canvas (WhatsApp Wallpaper Pattern) */}
          <div
            className="flex-1 p-3 overflow-y-auto space-y-3 relative"
            style={{
              backgroundColor: '#ECE5DD',
              backgroundImage: `radial-gradient(#D6CBC1 1px, transparent 1px)`,
              backgroundSize: '16px 16px'
            }}
          >
            {/* Date Pill */}
            <div className="flex justify-center my-1">
              <span className="bg-[#FFFFFF]/90 text-[#6B5E59] text-[9px] font-bold tracking-wider px-2.5 py-1 rounded-md uppercase shadow-2xs">
                {activeStep === 1 && 'Today (14 Days Prior to Birthday)'}
                {activeStep === 2 && '7 Days Prior • Follow-Up Lookbook'}
                {activeStep === 3 && 'Day of Event (D0) • Morning Auspicious'}
              </span>
            </div>

            {/* Message Bubble */}
            <div className="max-w-[280px] bg-white rounded-xl rounded-tl-xs shadow-sm overflow-hidden text-xs text-[#111111] animate-in fade-in duration-200">
              {/* Step 1 Content */}
              {activeStep === 1 && (
                <>
                  {/* Silk Saree Hero Image */}
                  <div className="relative h-32 w-full bg-gradient-to-br from-[#4A151B] to-[#73242E] p-3 flex flex-col justify-end text-white overflow-hidden">
                    <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#D4AF37_1px,transparent_1px)] [background-size:8px_8px]" />
                    <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#C99726] text-black text-[9px] font-extrabold rounded-full uppercase tracking-wider shadow-xs">
                      Exclusive
                    </div>
                    <div className="relative z-10">
                      <div className="text-[10px] font-medium text-[#F3E0B5] uppercase tracking-wider">
                        Kanchipuram & Gadwal Privileges
                      </div>
                      <div className="font-serif font-bold text-sm leading-tight text-white">
                        Royal Heritage Silk Collection
                      </div>
                    </div>
                  </div>

                  {/* Body Text */}
                  <div className="p-3 space-y-2 text-[11px] leading-relaxed text-[#271E1B]">
                    <p>
                      Namaste <strong className="text-[#5C1D24]">{customerName}</strong> ✨
                    </p>
                    <p>
                      <strong>{storeName}</strong> wishes you a wonderful advance Happy Birthday!
                    </p>
                    <p>
                      To make your celebration auspicious, we have curated a private viewing of handwoven Kanchipuram and Pochampally sarees with an exclusive{' '}
                      <strong className="text-[#8F6910] bg-[#FEF9EE] px-1 py-0.5 rounded border border-[#F3E0B5]">
                        {offerText}
                      </strong>
                      .
                    </p>
                    <p className="text-[10px] text-[#6B5E59]">
                      Reply <strong>DETAILS</strong> to view the lookbook or visit our Kukatpally boutique.
                    </p>

                    <div className="flex items-center justify-end gap-1 text-[9px] text-[#988B86] pt-1">
                      <span>10:02 AM</span>
                      <CheckCheck className="w-3.5 h-3.5 text-[#34B7F1]" />
                    </div>
                  </div>

                  {/* WhatsApp Interactive Action Buttons */}
                  <div className="border-t border-[#F0EBE4] divide-y divide-[#F0EBE4] bg-[#FAFAF8]">
                    <button className="w-full py-2 px-3 text-[#00A884] font-semibold text-[11px] flex items-center justify-center gap-1.5 hover:bg-black/5 transition-colors">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Browse Birthday Lookbook</span>
                    </button>
                    <button className="w-full py-2 px-3 text-[#00A884] font-semibold text-[11px] flex items-center justify-center gap-1.5 hover:bg-black/5 transition-colors">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Visit Kukatpally Boutique</span>
                    </button>
                  </div>
                </>
              )}

              {/* Step 2 Content */}
              {activeStep === 2 && (
                <div className="p-3 space-y-2 text-[11px] leading-relaxed text-[#271E1B]">
                  <p>
                    Hi <strong className="text-[#5C1D24]">{customerName}</strong>,
                  </p>
                  <p>
                    Just a gentle reminder that your birthday boutique privilege pass is active this week at{' '}
                    <strong>{storeName}</strong>.
                  </p>
                  <p>
                    Our master drapers have set aside 3 exclusive handloom silk creations suited to your weave preferences.
                  </p>
                  <div className="p-2 bg-[#FAF8F5] rounded-lg border border-[#EAE4DC] text-[10px]">
                    <span className="text-[#8F6910] font-semibold">📍 Reserved at:</span> Main Counter, Kukatpally
                  </div>
                  <div className="flex items-center justify-end gap-1 text-[9px] text-[#988B86] pt-1">
                    <span>10:00 AM</span>
                    <CheckCheck className="w-3.5 h-3.5 text-[#34B7F1]" />
                  </div>
                </div>
              )}

              {/* Step 3 Content */}
              {activeStep === 3 && (
                <div className="p-3 space-y-2 text-[11px] leading-relaxed text-[#271E1B]">
                  <div className="flex items-center gap-1.5 text-[#C99726] font-semibold text-[10px] uppercase tracking-wide">
                    <Sparkles className="w-3.5 h-3.5" /> Auspicious Greetings
                  </div>
                  <p className="font-serif text-sm font-bold text-[#431217]">
                    Wishing you a Very Happy Birthday, {customerName}! 🌸
                  </p>
                  <p>
                    May your special year be blessed with joy, prosperity, and timeless elegance from the entire weaving family at{' '}
                    <strong>{storeName}</strong>.
                  </p>
                  <div className="flex items-center justify-end gap-1 text-[9px] text-[#988B86] pt-1">
                    <span>10:00 AM</span>
                    <CheckCheck className="w-3.5 h-3.5 text-[#34B7F1]" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Fake Bottom Input Bar */}
          <div className="h-12 bg-[#F0F2F5] px-3 flex items-center justify-between text-[11px] text-[#8696A0] shrink-0 border-t border-[#E9EDEF]">
            <span className="bg-white px-3 py-1.5 rounded-full flex-1 border border-[#E9EDEF] text-[10px]">
              Type a message...
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
