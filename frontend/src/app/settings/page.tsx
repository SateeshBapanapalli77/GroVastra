'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppShell } from '../../components/layout/AppShell';
import { api, generateIdempotencyKey, ConflictError } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../lib/useAuth';
import { canManageSettings } from '../../lib/roles';
import {
  Settings,
  Clock,
  Shield,
  Save,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  RefreshCw,
  Lock,
  PauseCircle,
  Building,
  Calendar,
  Plus,
  Trash2,
  X,
  Radio,
  FileText
} from 'lucide-react';
import { IANAZone } from 'luxon';
import { toast } from 'sonner';

// Curated list of typical boutique IANA timezones
const COMMON_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST — India Standard Time)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST — Gulf Standard Time)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT — Singapore Time)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST — UK Time)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT — US Eastern)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' }
];

// RHF + Zod Validation Schema per Phase 1 Non-negotiables
const SettingsFormSchema = z
  .object({
    storeName: z.string().nullable().optional(),
    timezone: z
      .string()
      .min(1, 'Timezone is required')
      .refine((tz) => IANAZone.isValidZone(tz), {
        message: 'Must be a valid IANA timezone name (e.g. Asia/Kolkata)'
      }),
    allowedHoursStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Must be in HH:mm format (e.g. 10:00)'),
    allowedHoursEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Must be in HH:mm format (e.g. 19:00)'),
    marketing24h: z
      .number()
      .int('Must be an integer')
      .min(0, 'Cap cannot be negative')
      .max(
        1,
        'Platform safeguard is max 1 message per 24 hours. Owners may only tighten contact caps (0 or 1), never relax them.'
      ),
    marketing7d: z
      .number()
      .int('Must be an integer')
      .min(0, 'Cap cannot be negative')
      .max(
        3,
        'Platform safeguard is max 3 messages per 7 days. Owners may only tighten contact caps (0 to 3), never relax them.'
      ),
    globalPause: z.boolean(),
    leapDayPolicy: z.enum(['FEB_28', 'MAR_01', 'LEAP_ONLY']),
    outageGraceMinutes: z.number().min(0, 'Grace period cannot be negative')
  })
  .refine(
    (data) => {
      const [sH, sM] = data.allowedHoursStart.split(':').map(Number);
      const [eH, eM] = data.allowedHoursEnd.split(':').map(Number);
      const startMinutes = sH * 60 + sM;
      const endMinutes = eH * 60 + eM;
      // Reject overnight and equal hours: start must be strictly before end
      return startMinutes < endMinutes;
    },
    {
      message:
        'Allowed delivery window must start strictly before it ends on the same calendar day. Overnight and equal hours are rejected.',
      path: ['allowedHoursEnd']
    }
  );

type SettingsFormData = z.infer<typeof SettingsFormSchema>;

export default function CampaignSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Blackouts and Holidays local state arrays
  const [blackouts, setBlackouts] = useState<string[]>([]);
  const [newBlackoutDate, setNewBlackoutDate] = useState('');

  // Global pause confirmation modal state
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pendingPauseAction, setPendingPauseAction] = useState<boolean | null>(null);

  const canEdit = canManageSettings(user?.role);

  // 1. Fetch Tenant Settings via TanStack Query
  const {
    data: settingsData,
    isLoading: isSettingsLoading,
    isError: isSettingsError,
    error: settingsErr,
    refetch: refetchSettings
  } = useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => api.getCampaignSettings()
  });

  // 2. Fetch Integration Readiness (read-only WhatsApp connection status)
  const {
    data: readinessData,
    isLoading: isReadinessLoading
  } = useQuery({
    queryKey: queryKeys.readiness.all,
    queryFn: () => api.getIntegrationReadiness()
  });

  // 3. Fetch Approved Template Catalogue (read-only)
  const {
    data: templatesData,
    isLoading: isTemplatesLoading
  } = useQuery({
    queryKey: queryKeys.templates.all,
    queryFn: () => api.getApprovedTemplates()
  });

  const settings = settingsData?.settings;
  const currentVersion = settings?.version || 1;

  // React Hook Form initialization
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty }
  } = useForm<SettingsFormData>({
    resolver: zodResolver(SettingsFormSchema),
    defaultValues: {
      storeName: '',
      timezone: 'Asia/Kolkata',
      allowedHoursStart: '10:00',
      allowedHoursEnd: '19:00',
      marketing24h: 1,
      marketing7d: 3,
      globalPause: false,
      leapDayPolicy: 'FEB_28',
      outageGraceMinutes: 120
    }
  });

  const currentGlobalPause = watch('globalPause');

  // Synchronize form defaults from server state
  useEffect(() => {
    if (settings) {
      reset({
        storeName: settings.storeName || '',
        timezone: settings.timezone || 'Asia/Kolkata',
        allowedHoursStart: settings.allowedHours?.start || '10:00',
        allowedHoursEnd: settings.allowedHours?.end || '19:00',
        marketing24h: settings.caps?.marketing24h ?? 1,
        marketing7d: settings.caps?.marketing7d ?? 3,
        globalPause: Boolean(settings.globalPause),
        leapDayPolicy: settings.leapDayPolicy || 'FEB_28',
        outageGraceMinutes: settings.outageGraceMinutes ?? 120
      });
      setBlackouts(Array.isArray(settings.blackouts) ? settings.blackouts : []);
    }
  }, [settings, reset]);

  // Mutation: PATCH /campaign-settings (Sends expectedVersion & Idempotency-Key)
  const updateMutation = useMutation({
    mutationFn: async (formData: SettingsFormData) => {
      setConflictError(null);
      const payload = {
        storeName: formData.storeName?.trim() || null,
        timezone: formData.timezone,
        allowedHours: {
          start: formData.allowedHoursStart,
          end: formData.allowedHoursEnd
        },
        caps: {
          marketing24h: formData.marketing24h,
          marketing7d: formData.marketing7d
        },
        globalPause: formData.globalPause,
        leapDayPolicy: formData.leapDayPolicy,
        outageGraceMinutes: formData.outageGraceMinutes,
        blackouts,
        expectedVersion: currentVersion
      };

      const idemp = generateIdempotencyKey('update_settings');
      return api.updateCampaignSettings(payload, currentVersion, idemp);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success('Campaign settings saved successfully');
    },
    onError: (err: any) => {
      if (err instanceof ConflictError || err.status === 409) {
        setConflictError(
          `Version conflict (409): Settings were modified in another session. Please reload latest settings.`
        );
      } else {
        toast.error(err.message || 'Failed to update campaign settings');
      }
    }
  });

  const onSubmit = (data: SettingsFormData) => {
    if (!canEdit) return;
    updateMutation.mutate(data);
  };

  // Blackout Date Handlers
  const handleAddBlackout = () => {
    if (!newBlackoutDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newBlackoutDate)) {
      toast.error('Date must be in YYYY-MM-DD format');
      return;
    }
    if (blackouts.includes(newBlackoutDate)) {
      toast.error('Date is already added to blackout list');
      return;
    }
    setBlackouts([...blackouts, newBlackoutDate].sort());
    setNewBlackoutDate('');
  };

  const handleRemoveBlackout = (dateStr: string) => {
    if (!canEdit) return;
    setBlackouts(blackouts.filter((d) => d !== dateStr));
  };

  // Global Pause confirmation workflow (Honest copy requirement)
  const handleToggleGlobalPauseClick = (targetChecked: boolean) => {
    if (!canEdit) return;
    setPendingPauseAction(targetChecked);
    setPauseModalOpen(true);
  };

  const handleConfirmGlobalPause = () => {
    if (pendingPauseAction !== null) {
      setValue('globalPause', pendingPauseAction, { shouldDirty: true });
    }
    setPauseModalOpen(false);
    setPendingPauseAction(null);
  };

  const connection = readinessData?.connection;
  const templates = templatesData?.templates || [];

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Campaign Settings']}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#EAE4DC] pb-5">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[#431217]">
              Campaign &amp; Safeguard Settings
            </h1>
            <p className="text-xs text-[#6B5E59] mt-0.5">
              Tenant delivery windows, quiet hours, anti-spam contact caps, and integration status.
            </p>
          </div>

          <div className="text-[11px] text-[#988B86]">
            Configuration Version:{' '}
            <strong className="font-mono text-[#5C1D24]">v{currentVersion}</strong>
          </div>
        </div>

        {/* Conflict Banner (Non-negotiable 3: 409 handling with visible banner & Reload latest action) */}
        {conflictError && (
          <div className="p-4 rounded-xl bg-[#FFF7E6] border border-[#FFE2B3] text-xs text-[#B26A00] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-[#C99726] shrink-0" />
              <span>{conflictError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setConflictError(null);
                refetchSettings();
              }}
              className="px-4 py-1.5 rounded-lg bg-[#B26A00] text-white font-semibold hover:bg-[#8F6910] transition-colors cursor-pointer text-xs shrink-0"
            >
              Reload latest
            </button>
          </div>
        )}

        {/* Mandatory Settings Notice (Non-negotiable 7: EXACT WORDING REQUIRED) */}
        <div className="bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl p-4 text-xs text-[#8F6910] leading-relaxed flex items-start gap-3">
          <Info className="w-4 h-4 text-[#C99726] shrink-0 mt-0.5" />
          <div>
            <strong className="text-[#431217]">Integration Boundary Notice: </strong>
            This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.
          </div>
        </div>

        {/* Role Gating Notice for Staff */}
        {!canEdit && (
          <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#C99726] shrink-0" />
            <span>
              Signed in as <strong>Store Staff</strong> (Read-only view). Modifying boutique campaign settings requires Boutique Owner or Store Manager credentials.
            </span>
          </div>
        )}

        {/* LOADING SKELETON */}
        {isSettingsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6 space-y-3">
                <div className="h-5 bg-[#F4EFE8] rounded w-1/4" />
                <div className="h-4 bg-[#FAF8F5] rounded w-1/2" />
                <div className="h-10 bg-[#FAF8F5] rounded w-full" />
              </div>
            ))}
          </div>
        ) : isSettingsError ? (
          <div className="p-8 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
            <p className="text-xs text-[#9E2A2B]">
              {(settingsErr as Error)?.message || 'Failed to load campaign settings from server.'}
            </p>
            <button
              type="button"
              onClick={() => refetchSettings()}
              className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* 1. STORE IDENTITY & TIMEZONE */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                <Building className="w-4 h-4 text-[#5C1D24]" />
                <span>Boutique Store Identity &amp; Timezone</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Store Display Name */}
                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Store Display Name
                  </label>
                  <input
                    {...register('storeName')}
                    disabled={!canEdit}
                    type="text"
                    placeholder="e.g. Padmavati Silks"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
                  />
                  {errors.storeName && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.storeName.message}</p>
                  )}
                  <p className="text-[10px] text-[#988B86] mt-1">
                    Used to populate greeting variables in WhatsApp message templates.
                  </p>
                </div>

                {/* Valid IANA Timezone */}
                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Tenant IANA Timezone
                  </label>
                  <select
                    {...register('timezone')}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  {errors.timezone && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.timezone.message}</p>
                  )}
                  <p className="text-[10px] text-[#988B86] mt-1">
                    All scheduled delivery windows and quiet hours evaluate against this zone.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. ALLOWED DELIVERY HOURS (QUIET HOURS SAFEGUARD) */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#C99726]" />
                    <span>Allowed Delivery Hours (Quiet Hours Safeguard)</span>
                  </h2>
                  <p className="text-xs text-[#6B5E59] mt-0.5">
                    Messages are only dispatched within this window. Steps due outside these hours defer to the next morning.
                  </p>
                </div>
                <span className="text-[10px] text-[#8F6910] bg-[#FEF9EE] px-2 py-0.5 rounded border border-[#F3E0B5]">
                  Start inclusive, end exclusive
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Window Opening (Start HH:mm)
                  </label>
                  <input
                    {...register('allowedHoursStart')}
                    disabled={!canEdit}
                    type="text"
                    placeholder="10:00"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60 font-mono"
                  />
                  {errors.allowedHoursStart && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">
                      {errors.allowedHoursStart.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Window Closing (End HH:mm)
                  </label>
                  <input
                    {...register('allowedHoursEnd')}
                    disabled={!canEdit}
                    type="text"
                    placeholder="19:00"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60 font-mono"
                  />
                  {errors.allowedHoursEnd && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">
                      {errors.allowedHoursEnd.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 3. CONTACT FREQUENCY CAPS (ANTI-SPAM) */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#1B7A43]" />
                    <span>Marketing Frequency Caps (Anti-Spam Safeguard)</span>
                  </h2>
                  <p className="text-xs text-[#6B5E59] mt-0.5">
                    Platform defaults: 1/24h, 3/7d. Owners may only tighten limits to protect patron goodwill, never relax them.
                  </p>
                </div>
                <span className="text-[10px] text-[#1B7A43] bg-[#EBF7EE] px-2 py-0.5 rounded border border-[#C3E8CB]">
                  Tightening only
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Max Messages per 24 Hours
                  </label>
                  <input
                    {...register('marketing24h', { valueAsNumber: true })}
                    disabled={!canEdit}
                    type="number"
                    min="0"
                    max="1"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
                  />
                  {errors.marketing24h && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.marketing24h.message}</p>
                  )}
                  <p className="text-[10px] text-[#988B86] mt-1">
                    Default: 1. Set to 0 to completely halt 24h promotional touches.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2A1D1A] mb-1">
                    Max Messages per 7 Days
                  </label>
                  <input
                    {...register('marketing7d', { valueAsNumber: true })}
                    disabled={!canEdit}
                    type="number"
                    min="0"
                    max="3"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden disabled:opacity-60"
                  />
                  {errors.marketing7d && (
                    <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.marketing7d.message}</p>
                  )}
                  <p className="text-[10px] text-[#988B86] mt-1">
                    Default: 3. Set lower (e.g. 1 or 2) for ultra-conservative boutique outreach.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. BLACKOUT & HOLIDAY DATES */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#8F6910]" />
                <span>Store Blackout &amp; Holiday Dates</span>
              </h2>
              <p className="text-xs text-[#6B5E59]">
                Marketing steps scheduled on these dates defer to the next opening business day.
              </p>

              {/* Add Blackout Input */}
              {canEdit && (
                <div className="flex items-center gap-2 max-w-sm">
                  <input
                    type="date"
                    value={newBlackoutDate}
                    onChange={(e) => setNewBlackoutDate(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleAddBlackout}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Date</span>
                  </button>
                </div>
              )}

              {/* Blackouts Pill List */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {blackouts.length === 0 ? (
                  <p className="text-xs text-[#988B86] italic">
                    No blackout dates configured. Outreach operates standard days within allowed hours.
                  </p>
                ) : (
                  blackouts.map((dateStr) => (
                    <span
                      key={dateStr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FAF8F5] border border-[#EAE4DC] text-xs font-mono text-[#2A1D1A]"
                    >
                      <Calendar className="w-3 h-3 text-[#C99726]" />
                      <span>{dateStr}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBlackout(dateStr)}
                          className="text-[#988B86] hover:text-[#9E2A2B] ml-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* 5. GLOBAL PAUSE SWITCH WITH CONFIRMATION MODAL (HONEST BOUNDARY COPY) */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                <PauseCircle className="w-4 h-4 text-[#8F6910]" />
                <span>Store-Wide Global Pause Control</span>
              </h2>

              <div className="p-4 rounded-xl border border-[#F3E0B5] bg-[#FEF9EE] flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="font-bold text-xs text-[#431217] block">
                    Global Campaign Freeze
                  </span>
                  <p className="text-xs text-[#8F6910] leading-relaxed">
                    Unsent work stops. Messages already being sent may still go out.
                  </p>
                </div>

                <button
                  type="button"
                  id="btn-global-pause-toggle"
                  disabled={!canEdit}
                  onClick={() => handleToggleGlobalPauseClick(!currentGlobalPause)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    currentGlobalPause
                      ? 'bg-[#9E2A2B] text-white hover:bg-[#73232C]'
                      : 'bg-[#5C1D24] text-white hover:bg-[#73232C]'
                  } disabled:opacity-50`}
                >
                  {currentGlobalPause ? 'Resume Auto Campaigns' : 'Pause All Campaigns'}
                </button>
              </div>

              {currentGlobalPause && (
                <div className="p-3 rounded-lg bg-[#FDF2F2] border border-[#F8D7DA] text-xs text-[#9E2A2B] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#9E2A2B] shrink-0" />
                  <span>
                    Store-wide global pause is currently <strong>ACTIVE</strong>. All evaluations and pending campaign dispatches are halted.
                  </span>
                </div>
              )}
            </div>

            {/* 6. READ-ONLY INTEGRATION READINESS */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-serif text-sm font-bold text-[#2A1D1A] flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#5C1D24]" />
                    <span>WhatsApp Integration Readiness (Read-Only)</span>
                  </h2>
                  <p className="text-xs text-[#6B5E59] mt-0.5">
                    Connection and template catalogue are provisioned by your integration developer.
                  </p>
                </div>
                <span className="text-[10px] text-[#988B86] bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#EAE4DC]">
                  Read-only
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Connection Box */}
                <div className="p-4 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2A1D1A]">WhatsApp Channel</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        connection?.status === 'ACTIVE'
                          ? 'bg-[#EBF7EE] text-[#1B7A43] border-[#C3E8CB]'
                          : 'bg-[#FEF9EE] text-[#8F6910] border-[#F3E0B5]'
                      }`}
                    >
                      {connection?.status || 'DISCONNECTED'}
                    </span>
                  </div>
                  <div className="text-xs text-[#6B5E59] space-y-1">
                    <div>
                      Verified Name: <strong>{connection?.verifiedName || 'Padmavati Silks'}</strong>
                    </div>
                    <div>
                      Phone Number ID: <span className="font-mono">{connection?.phoneNumberId || 'conn_active_prod'}</span>
                    </div>
                  </div>
                </div>

                {/* Approved Templates Box */}
                <div className="p-4 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2A1D1A]">Template Catalogue</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF7EE] text-[#1B7A43] border border-[#C3E8CB]">
                      {templates.length} Approved
                    </span>
                  </div>
                  <p className="text-xs text-[#6B5E59] line-clamp-2">
                    Templates approved by Meta for marketing, order service, and occasion reminders.
                  </p>
                </div>
              </div>
            </div>

            {/* SAVE BUTTON */}
            {canEdit && (
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={updateMutation.isPending || (!isDirty && blackouts === (settings?.blackouts || []))}
                  className="px-6 py-2.5 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] text-xs font-semibold tracking-wide transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-[#F3E0B5]" />
                  <span>{updateMutation.isPending ? 'Saving...' : 'Save Settings'}</span>
                </button>
              </div>
            )}
          </form>
        )}

        {/* CONFIRMATION MODAL: GLOBAL PAUSE TOGGLE (HONEST BOUNDARY COPY) */}
        {pauseModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl border border-[#EAE4DC] shadow-xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAE4DC] pb-3">
                <h3 className="font-serif text-base font-bold text-[#431217] flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-[#C99726]" />
                  <span>
                    {pendingPauseAction
                      ? 'Pause All Campaigns Store-Wide?'
                      : 'Resume Auto Campaigns?'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setPauseModalOpen(false)}
                  className="p-1 rounded-lg text-[#988B86] hover:bg-[#FAF8F5] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {pendingPauseAction ? (
                <div className="space-y-3 text-xs text-[#431217]">
                  <div className="p-3.5 bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl text-[#8F6910] leading-relaxed font-semibold">
                    Unsent work stops. Messages already being sent may still go out.
                  </div>
                  <p className="text-[#6B5E59]">
                    This sets the global tenant control gate to paused. In-flight evaluations will defer, and no further marketing dispatches will be sent until resumed.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#6B5E59] leading-relaxed">
                  Automated evaluations will resume according to each campaign&apos;s scheduled local time and allowed delivery hours.
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#EAE4DC]">
                <button
                  type="button"
                  onClick={() => setPauseModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-[#EAE4DC] text-xs font-semibold text-[#6B5E59] hover:bg-[#FAF8F5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmGlobalPause}
                  className={`px-5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-xs cursor-pointer ${
                    pendingPauseAction
                      ? 'bg-[#9E2A2B] text-white hover:bg-[#73232C]'
                      : 'bg-[#5C1D24] text-white hover:bg-[#73232C]'
                  }`}
                >
                  {pendingPauseAction ? 'Confirm Store-Wide Pause' : 'Confirm Resume'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
