'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../../../components/layout/AppShell';
import { api, generateIdempotencyKey, ConflictError } from '../../../../lib/api';
import { queryKeys } from '../../../../lib/queryKeys';
import { useAuth } from '../../../../lib/useAuth';
import { canManageCampaigns } from '../../../../lib/roles';
import { WizardHeader } from '../../../../components/campaign-wizard/WizardHeader';
import { Step1Trigger } from '../../../../components/campaign-wizard/Step1Trigger';
import { Step2Audience } from '../../../../components/campaign-wizard/Step2Audience';
import { Step3Messages } from '../../../../components/campaign-wizard/Step3Messages';
import { Step4SendingRules } from '../../../../components/campaign-wizard/Step4SendingRules';
import { Step5Review } from '../../../../components/campaign-wizard/Step5Review';
import {
  TriggerConfigSchema,
  AudienceConfigSchema,
  MessagesConfigSchema,
  SendingRulesConfigSchema
} from '../../../../components/campaign-wizard/wizardSchema';
import {
  ArrowLeft,
  ArrowRight,
  Save,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Lock,
  CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';

function CampaignEditWizardContent() {
  const params = useParams();
  const campaignId = (Array.isArray(params?.id) ? params.id[0] : params?.id) || '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const canEdit = canManageCampaigns(user?.role);

  // Active Wizard Step (1 to 5)
  const [currentStep, setCurrentStep] = useState(1);

  // Autosave Status: IDLE | SAVING | SAVED | CONFLICT | DIRTY
  const [autosaveStatus, setAutosaveStatus] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'CONFLICT' | 'DIRTY'>('IDLE');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [stepValidationError, setStepValidationError] = useState<string | null>(null);

  // Draft Form States
  const [campaignName, setCampaignName] = useState('');
  const [triggerData, setTriggerData] = useState<any>({
    type: 'ANNUAL_DATE',
    field: 'customer.birthday',
    advanceDays: 0,
    leapDayPolicy: 'FEB_28',
    timezone: 'Asia/Kolkata',
    localTime: '10:00'
  });
  const [audienceData, setAudienceData] = useState<any>({
    mode: 'ALL_ELIGIBLE',
    rules: { all: [], any: [], none: [] }
  });
  const [steps, setSteps] = useState<any[]>([
    {
      stepId: 'invitation',
      offsetDays: 0,
      localTime: '10:00',
      prerequisite: 'NONE',
      templateRef: { id: '', revision: 1, language: 'en' },
      bindings: {},
      stopOnReply: true,
      stopOnGoal: true,
      maxLatenessMinutes: 120
    }
  ]);
  const [rulesData, setRulesData] = useState<any>({
    priority: 80,
    resumePolicy: 'FUTURE_ONLY',
    goal: { type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED', windowDays: 14 }
  });

  // Track expectedVersion for optimistic concurrency control (Review 2, Spec C16)
  const [expectedVersion, setExpectedVersion] = useState<number>(1);
  const isInitialLoad = useRef(true);

  // 1. Fetch Campaign Detail & Active/Draft Versions
  const {
    data: detailData,
    isLoading: isCampaignLoading,
    isError: isCampaignError,
    error: campaignErr,
    refetch: refetchCampaign
  } = useQuery({
    queryKey: queryKeys.campaigns.detail(campaignId),
    queryFn: () => api.getCampaignDetail(campaignId),
    enabled: Boolean(campaignId)
  });

  // 2. Fetch Approved Template Catalogue
  const {
    data: templatesData,
    isLoading: isTemplatesLoading
  } = useQuery({
    queryKey: queryKeys.templates.all,
    queryFn: () => api.getApprovedTemplates()
  });

  // 3. Fetch Tenant Settings for Store Name
  const { data: settingsData } = useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => api.getCampaignSettings()
  });

  const campaign = detailData?.campaign;
  const latestDraft = detailData?.latestDraft || detailData?.activeVersion;
  const approvedTemplates = templatesData?.templates || [];
  const storeDisplayName = settingsData?.settings?.storeName || 'Padmavati Silks';

  // Populate local wizard state when draft data loads
  useEffect(() => {
    if (latestDraft) {
      setExpectedVersion(campaign?.draftVersion || latestDraft.version || 1);
      setCampaignName(campaign?.name || latestDraft.name || '');

      if (latestDraft.trigger) {
        setTriggerData({
          type: latestDraft.trigger.type || 'ANNUAL_DATE',
          field: latestDraft.trigger.field || 'customer.birthday',
          advanceDays: latestDraft.trigger.advanceDays ?? 0,
          leapDayPolicy: latestDraft.trigger.leapDayPolicy || 'FEB_28',
          eventType: latestDraft.trigger.eventType || 'stock.published',
          inactivityDays: latestDraft.trigger.inactivityDays ?? 90,
          timezone: latestDraft.timezone || 'Asia/Kolkata',
          localTime: latestDraft.trigger.localTime || latestDraft.steps?.[0]?.localTime || '10:00'
        });
      }

      if (latestDraft.audience) {
        setAudienceData({
          mode: latestDraft.audience.mode || 'ALL_ELIGIBLE',
          rules: latestDraft.audience.rules || { all: [], any: [], none: [] }
        });
      }

      if (Array.isArray(latestDraft.steps) && latestDraft.steps.length > 0) {
        setSteps(latestDraft.steps);
      }

      setRulesData({
        priority: latestDraft.priority ?? 80,
        resumePolicy: latestDraft.resumePolicy || 'FUTURE_ONLY',
        goal: latestDraft.goal || { type: 'OCCASION_TAGGED_OR_STAFF_COMPLETED', windowDays: 14 }
      });

      isInitialLoad.current = false;
      setAutosaveStatus('SAVED');
    }
  }, [latestDraft, campaign]);

  // Mutation: PATCH /campaigns/:id/draft (Optimistic autosave allowed ONLY for draft revisions)
  const saveDraftMutation = useMutation({
    mutationFn: async (customExpectedVersion?: number) => {
      setConflictError(null);
      setAutosaveStatus('SAVING');

      const versionToUse = typeof customExpectedVersion === 'number' ? customExpectedVersion : expectedVersion;

      const payload = {
        name: campaignName.trim() || 'Boutique Campaign Draft',
        trigger: triggerData,
        timezone: triggerData.timezone || 'Asia/Kolkata',
        audience: audienceData,
        steps,
        priority: rulesData.priority,
        expectedVersion: versionToUse
      };

      const idemp = generateIdempotencyKey('save_draft');
      return api.saveDraftRevision(campaignId, payload, versionToUse, idemp);
    },
    onSuccess: (data: any) => {
      const nextVer = data?.draftVersion?.version || (expectedVersion + 1);
      setExpectedVersion(nextVer);
      setAutosaveStatus('SAVED');
      setConflictError(null);
      // Invalidate detail cache so latestDraft is fresh
      queryClient.setQueryData(queryKeys.campaigns.detail(campaignId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          campaign: data.campaign || old.campaign,
          latestDraft: data.draftVersion || old.latestDraft
        };
      });
    },
    onError: (err: any) => {
      if (err instanceof ConflictError || err.status === 409) {
        setAutosaveStatus('CONFLICT');
        setConflictError(
          'Version conflict (409): Another session saved changes to this draft. Please reload the latest revision to prevent overwrites.'
        );
      } else {
        setAutosaveStatus('DIRTY');
        toast.error(err.message || 'Draft autosave failed');
      }
    }
  });

  // Debounced Autosave Trigger when form fields mutate
  const triggerAutosave = useCallback(() => {
    if (!canEdit || isInitialLoad.current || isCampaignLoading) return;
    setAutosaveStatus('DIRTY');
  }, [canEdit, isCampaignLoading]);

  // Handle Manual Save
  const handleManualSave = () => {
    if (!canEdit) return;
    saveDraftMutation.mutate(expectedVersion);
  };

  // Step Validation with Zod before advancing
  const validateCurrentStep = (): boolean => {
    setStepValidationError(null);

    if (currentStep === 1) {
      const result = TriggerConfigSchema.safeParse(triggerData);
      if (!result.success) {
        setStepValidationError(result.error.issues[0]?.message || 'Trigger configuration invalid');
        return false;
      }
    } else if (currentStep === 2) {
      const result = AudienceConfigSchema.safeParse(audienceData);
      if (!result.success) {
        setStepValidationError(result.error.issues[0]?.message || 'Audience configuration invalid');
        return false;
      }
    } else if (currentStep === 3) {
      const result = MessagesConfigSchema.safeParse({ steps });
      if (!result.success) {
        setStepValidationError(result.error.issues[0]?.message || 'Message steps configuration invalid');
        return false;
      }
    } else if (currentStep === 4) {
      const result = SendingRulesConfigSchema.safeParse(rulesData);
      if (!result.success) {
        setStepValidationError(result.error.issues[0]?.message || 'Sending rules configuration invalid');
        return false;
      }
    }

    return true;
  };

  const handleNextStep = () => {
    if (!validateCurrentStep()) return;

    // Trigger draft autosave on step advance
    if (canEdit && autosaveStatus === 'DIRTY') {
      saveDraftMutation.mutate(expectedVersion);
    }

    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrevStep = () => {
    setStepValidationError(null);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex > currentStep) {
      if (!validateCurrentStep()) return;
    }
    setStepValidationError(null);
    setCurrentStep(stepIndex);
  };

  const handleReloadLatest = async () => {
    setConflictError(null);
    const refreshed = await refetchCampaign();
    if (refreshed.data?.latestDraft) {
      const ld = refreshed.data.latestDraft;
      setExpectedVersion(refreshed.data.campaign?.draftVersion || ld.version || 1);
      setCampaignName(refreshed.data.campaign?.name || ld.name || '');
      if (ld.trigger) setTriggerData(ld.trigger);
      if (ld.audience) setAudienceData(ld.audience);
      if (ld.steps) setSteps(ld.steps);
      setAutosaveStatus('SAVED');
      toast.success('Latest draft revision reloaded');
    }
  };

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', campaignName || 'Edit Draft', `Step ${currentStep}`]}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Wizard Header Bar & Stepper */}
        <WizardHeader
          campaignId={campaignId}
          campaignName={campaignName}
          currentStep={currentStep}
          onStepClick={handleStepClick}
          autosaveStatus={autosaveStatus}
          conflictError={conflictError}
          onReloadLatest={handleReloadLatest}
          onManualSave={handleManualSave}
          isSaving={saveDraftMutation.isPending}
          canEdit={canEdit}
          draftVersion={expectedVersion}
        />

        {/* Read-Only Notice for Staff */}
        {!canEdit && (
          <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs text-[#6B5E59] flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#C99726] shrink-0" />
            <span>
              Signed in as <strong>Store Staff</strong> (Read-only view). Modifying campaign steps or publishing requires Boutique Owner or Store Manager privileges.
            </span>
          </div>
        )}

        {/* Loading Skeletons */}
        {isCampaignLoading || isTemplatesLoading ? (
          <div className="space-y-4">
            <div className="h-44 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6 space-y-3" />
            <div className="h-80 bg-white border border-[#EAE4DC] rounded-2xl animate-pulse p-6" />
          </div>
        ) : isCampaignError ? (
          <div className="p-10 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
            <p className="text-xs text-[#9E2A2B]">
              {(campaignErr as Error)?.message || 'Failed to load campaign draft.'}
            </p>
            <button
              type="button"
              onClick={() => refetchCampaign()}
              className="px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Step Validation Error Banner */}
            {stepValidationError && (
              <div className="p-3.5 rounded-xl bg-[#FDF2F2] border border-[#F8D7DA] text-xs text-[#9E2A2B] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#9E2A2B] shrink-0" />
                <span>
                  <strong>Validation Error:</strong> {stepValidationError}
                </span>
              </div>
            )}

            {/* Campaign Name Field (Always editable in header card) */}
            <div className="bg-white border border-[#EAE4DC] rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="w-full sm:max-w-md">
                <label className="block text-[11px] font-semibold text-[#6B5E59] mb-1">
                  Campaign Title
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={campaignName}
                  onChange={(e) => {
                    setCampaignName(e.target.value);
                    triggerAutosave();
                  }}
                  placeholder="e.g. Padmavati Silks Birthday Celebration"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden font-bold text-[#431217]"
                />
              </div>

              <div className="text-[11px] text-[#988B86]">
                Purpose: <strong className="uppercase text-[#5C1D24]">{campaign?.purpose || 'MARKETING'}</strong>
              </div>
            </div>

            {/* WIZARD STEP CONTAINER */}
            <div className="min-h-[450px]">
              {/* STEP 1: TRIGGER */}
              {currentStep === 1 && (
                <Step1Trigger
                  triggerData={triggerData}
                  disabled={!canEdit}
                  onChange={(updated) => {
                    setTriggerData(updated);
                    triggerAutosave();
                  }}
                />
              )}

              {/* STEP 2: AUDIENCE */}
              {currentStep === 2 && (
                <Step2Audience
                  audienceData={audienceData}
                  disabled={!canEdit}
                  onChange={(updated) => {
                    setAudienceData(updated);
                    triggerAutosave();
                  }}
                />
              )}

              {/* STEP 3: MESSAGES */}
              {currentStep === 3 && (
                <Step3Messages
                  steps={steps}
                  approvedTemplates={approvedTemplates}
                  storeDisplayName={storeDisplayName}
                  disabled={!canEdit}
                  onChange={(updated) => {
                    setSteps(updated);
                    triggerAutosave();
                  }}
                />
              )}

              {/* STEP 4: SENDING RULES */}
              {currentStep === 4 && (
                <Step4SendingRules
                  rulesData={rulesData}
                  disabled={!canEdit}
                  onChange={(updated) => {
                    setRulesData(updated);
                    triggerAutosave();
                  }}
                />
              )}

              {/* STEP 5: REVIEW & ACTIVATION */}
              {currentStep === 5 && (
                <Step5Review
                  campaignId={campaignId}
                  campaignName={campaignName}
                  draftVersion={expectedVersion}
                  triggerData={triggerData}
                  audienceData={audienceData}
                  steps={steps}
                  rulesData={rulesData}
                  autosaveStatus={autosaveStatus}
                  canEdit={canEdit}
                  onReloadLatest={handleReloadLatest}
                />
              )}
            </div>

            {/* WIZARD BOTTOM NAVIGATION BAR */}
            <div className="flex items-center justify-between pt-6 border-t border-[#EAE4DC]">
              {/* Previous Button */}
              <div>
                {currentStep > 1 && (
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#EAE4DC] bg-white text-xs font-semibold text-[#6B5E59] hover:bg-[#FAF8F5] transition-all cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>
                )}
              </div>

              {/* Next / Proceed Button */}
              <div className="flex items-center gap-3">
                {currentStep < 5 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all shadow-xs cursor-pointer"
                  >
                    <span>Next Step</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <Link
                    href={`/campaigns/${campaignId}`}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all shadow-xs"
                  >
                    <span>View Campaign Detail</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function CampaignEditWizardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-[#FAF8F5] items-center justify-center text-xs text-[#6B5E59] gap-2">
          <div className="w-5 h-5 border-2 border-[#5C1D24] border-t-transparent rounded-full animate-spin" />
          <span>Loading campaign wizard...</span>
        </div>
      }
    >
      <CampaignEditWizardContent />
    </Suspense>
  );
}
