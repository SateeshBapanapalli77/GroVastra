'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Shield, Clock, AlertTriangle, CheckCircle2, PauseCircle, PlayCircle } from 'lucide-react';
import { api } from '../lib/api';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await api.getSettings();
      if (res?.settings) {
        setSettings(res.settings);
      }
    } catch (err: any) {
      console.warn('Could not load settings from backend:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleGlobalPause = async () => {
    if (!settings) return;
    try {
      setSaving(true);
      const res = await api.updateSettings({
        expectedVersion: settings.version,
        globalPause: !settings.globalPause
      });
      if (res?.settings) {
        setSettings(res.settings);
        setMsg(`Global pause set to ${res.settings.globalPause ? 'PAUSED' : 'ACTIVE'}`);
      }
    } catch (err: any) {
      alert(`Settings update failed: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const allowedStart = settings?.allowedHours?.start || '10:00';
  const allowedEnd = settings?.allowedHours?.end || '19:00';
  const cap24h = settings?.caps?.rolling24Hours ?? 1;
  const cap7d = settings?.caps?.rolling7Days ?? 3;
  const tz = settings?.timezone || 'Asia/Kolkata';
  const notice = settings?.notice || 'This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="border-b border-[#EAE4DC] pb-5">
        <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
          Store Safeguards
        </div>
        <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
          Campaign Global Policies &amp; Caps
        </h1>
        <p className="text-xs text-[#6B5E59] mt-0.5">
          Tenant-level restrictions enforced across all active campaigns to guarantee compliance with Meta policies
        </p>
      </div>

      {msg && (
        <div className="p-3 bg-[#E8F8EE] border border-[#A2D9C3] rounded-xl text-xs text-[#1B7A43] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#1B7A43]" />
          <span>{msg}</span>
        </div>
      )}

      {/* Required Settings Notice */}
      <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#EAE4DC] flex items-start gap-3">
        <Shield className="w-5 h-5 text-[#5C1D24] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="text-xs font-bold text-[#431217]">Policy Protection Notice</div>
          <p className="text-xs text-[#6B5E59] leading-relaxed">
            {notice}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-[#271E1B]">
        {/* Card 1: Quiet Hours */}
        <div className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#C99726]" />
            <span className="font-bold text-sm text-[#431217]">Respectful Sending Hours</span>
          </div>
          <p className="text-[#6B5E59] text-[11px] leading-relaxed">
            All marketing campaigns are restricted to daytime delivery. Nighttime and early morning sends are rejected by policy.
          </p>
          <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] flex items-center justify-between">
            <span className="text-[#6B5E59]">Configured Window:</span>
            <span className="font-bold text-[#5C1D24]">{allowedStart} – {allowedEnd} ({tz})</span>
          </div>
        </div>

        {/* Card 2: Contact Caps */}
        <div className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#5C1D24]" />
            <span className="font-bold text-sm text-[#431217]">Anti-Spam Frequency Caps</span>
          </div>
          <p className="text-[#6B5E59] text-[11px] leading-relaxed">
            Prevents overwhelming patrons across multiple competing campaigns.
          </p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC]">
              <div className="font-bold text-base text-[#5C1D24]">{cap24h} / 24h</div>
              <div className="text-[10px] text-[#6B5E59]">Rolling 24h cap</div>
            </div>
            <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC]">
              <div className="font-bold text-base text-[#5C1D24]">{cap7d} / 7d</div>
              <div className="text-[10px] text-[#6B5E59]">Rolling 7d cap</div>
            </div>
          </div>
        </div>

        {/* Card 3: Global Pause */}
        <div className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#8F6910]" />
            <span className="font-bold text-sm text-[#431217]">Emergency Global Pause</span>
          </div>
          <p className="text-[#6B5E59] text-[11px] leading-relaxed">
            Instantly pauses dispatching across all campaigns in this boutique.
          </p>
          <div className="pt-2">
            <button
              disabled={saving || !settings}
              onClick={handleToggleGlobalPause}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                settings?.globalPause
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                  : 'bg-[#5C1D24] hover:bg-[#431217] text-white'
              }`}
            >
              {settings?.globalPause ? (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>Resume All Automations</span>
                </>
              ) : (
                <>
                  <PauseCircle className="w-4 h-4" />
                  <span>Pause All Automations</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
