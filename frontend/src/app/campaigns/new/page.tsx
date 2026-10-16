'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppShell } from '../../../components/layout/AppShell';
import { api, generateIdempotencyKey } from '../../../lib/api';
import { queryKeys } from '../../../lib/queryKeys';
import { useAuth } from '../../../lib/useAuth';
import { canManageCampaigns } from '../../../lib/roles';
import { Sparkles, ArrowLeft, Check, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

const CreateCampaignSchema = z.object({
  presetId: z.string().min(1, 'Please select a campaign blueprint'),
  name: z
    .string()
    .min(3, 'Campaign name must be at least 3 characters')
    .max(100, 'Campaign name cannot exceed 100 characters')
});

type CreateCampaignFormData = z.infer<typeof CreateCampaignSchema>;

function CreateCampaignForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const defaultPreset = searchParams.get('preset') || '';

  const { data: presetsData, isLoading: presetsLoading } = useQuery({
    queryKey: queryKeys.presets.all,
    queryFn: () => api.getPresets()
  });

  const presets = presetsData?.presets || [];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm<CreateCampaignFormData>({
    resolver: zodResolver(CreateCampaignSchema),
    defaultValues: {
      presetId: defaultPreset,
      name: ''
    }
  });

  const selectedPresetId = watch('presetId');

  const createMutation = useMutation({
    mutationFn: async (data: CreateCampaignFormData) => {
      const idempKey = generateIdempotencyKey('create_campaign');
      return api.createCampaign(data.presetId, data.name, idempKey);
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      const campaignId = res.campaign?.id || res.id;
      if (campaignId) {
        router.push(`/campaigns/${campaignId}`);
      } else {
        router.push('/campaigns');
      }
    }
  });

  if (!canManageCampaigns(user?.role)) {
    return (
      <div className="p-8 bg-white border border-[#F3E0B5] rounded-2xl text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-[#C99726] mx-auto" />
        <h2 className="font-serif text-base font-bold text-[#431217]">
          Owner or Store Manager Permission Required
        </h2>
        <p className="text-xs text-[#6B5E59]">
          Store staff cannot author new campaigns. Contact your boutique administrator.
        </p>
        <Link
          href="/campaigns"
          className="inline-block text-xs font-semibold text-[#5C1D24] underline mt-2"
        >
          Return to Overview
        </Link>
      </div>
    );
  }

  const onSubmit = (data: CreateCampaignFormData) => {
    createMutation.mutate(data);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/campaigns"
          className="p-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[#6B5E59] hover:text-[#5C1D24]"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-serif text-xl font-bold text-[#431217]">Create Auto Campaign</h1>
          <p className="text-xs text-[#6B5E59]">
            Select an approved occasion blueprint and customize name.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Preset Selector */}
        <div className="bg-white border border-[#EAE4DC] rounded-xl p-6 shadow-2xs space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#2A1D1A] uppercase tracking-wider mb-1">
              Step 1: Choose Occasion Blueprint
            </label>
            <p className="text-xs text-[#6B5E59]">
              Each preset includes pre-configured trigger rules and approved WhatsApp message templates.
            </p>
          </div>

          {errors.presetId && (
            <p className="text-xs text-[#9E2A2B] font-medium">{errors.presetId.message}</p>
          )}

          {presetsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-[#FAF8F5] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {presets.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      setValue('presetId', preset.id, { shouldValidate: true });
                      if (!watch('name')) {
                        setValue('name', preset.name, { shouldValidate: true });
                      }
                    }}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#5C1D24] bg-[#FDF5F6] ring-1 ring-[#5C1D24]'
                        : 'border-[#EAE4DC] bg-white hover:border-[#C99726]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8F6910]">
                          {(preset.category || preset.type || 'OCCASION').replace(/_/g, ' ')}
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-[#5C1D24]" />}
                      </div>
                      <h4 className="font-serif text-sm font-bold text-[#2A1D1A]">
                        {preset.name}
                      </h4>
                      <p className="text-[11px] text-[#6B5E59] mt-1 leading-relaxed line-clamp-2">
                        {preset.description}
                      </p>
                    </div>

                    <div className="mt-3 text-[10px] text-[#988B86]">
                      {preset.defaultSteps?.length || 1} pre-approved template step(s)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Campaign Name */}
        <div className="bg-white border border-[#EAE4DC] rounded-xl p-6 shadow-2xs space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#2A1D1A] uppercase tracking-wider mb-1">
              Step 2: Campaign Name
            </label>
            <p className="text-xs text-[#6B5E59]">
              Name displayed to boutique staff in reporting and activity streams.
            </p>
          </div>

          <div>
            <input
              {...register('name')}
              type="text"
              placeholder="e.g. Silk Connoisseur Birthday Invitation"
              className="w-full px-3.5 py-2 text-xs rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] focus:ring-1 focus:ring-[#5C1D24] outline-hidden"
            />
            {errors.name && (
              <p className="text-xs text-[#9E2A2B] mt-1.5">{errors.name.message}</p>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/campaigns"
            className="px-4 py-2 text-xs font-medium text-[#6B5E59] hover:text-[#2A1D1A]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-5 py-2.5 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] text-xs font-semibold tracking-wide transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <span>Initializing Campaign...</span>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#F3E0B5]" />
                <span>Initialize Draft</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'New Campaign']}>
      <Suspense fallback={<div className="p-8 text-center text-xs">Loading wizard...</div>}>
        <CreateCampaignForm />
      </Suspense>
    </AppShell>
  );
}
