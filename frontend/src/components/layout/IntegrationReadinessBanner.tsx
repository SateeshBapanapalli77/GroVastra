'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { api } from '../../lib/api';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Radio, FileText, Info } from 'lucide-react';

export function IntegrationReadinessBanner() {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.readiness.all,
    queryFn: () => api.getIntegrationReadiness(),
    staleTime: 60 * 1000
  });

  if (isLoading) {
    return (
      <div className="bg-[#FAF8F5] border-b border-[#EAE4DC] px-6 py-2 flex items-center justify-between text-xs text-[#6B5E59] animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#EAE4DC]" />
          <span>Checking integration connection and template readiness...</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-[#FFF7E6] border-b border-[#FFE2B3] px-6 py-2.5 flex items-center justify-between text-xs text-[#B26A00]">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#C99726]" />
          <span>
            Unable to check WhatsApp readiness status: {(error as Error)?.message || 'Service offline'}.
          </span>
        </div>
      </div>
    );
  }

  const { ready, connection, templates, missingConfiguration } = data;

  if (ready) {
    return (
      <div className="bg-[#FEF9EE] border-b border-[#F3E0B5] px-6 py-2 flex items-center justify-between text-xs text-[#8F6910]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1B7A43]"></span>
          </span>
          <span className="font-medium text-[#431217]">
            WhatsApp Integration Ready:
          </span>
          <span>
            Active connection ({connection.verifiedName || connection.phoneNumberId || 'Connected'}) • {templates.length} pre-approved boutique templates active.
          </span>
        </div>
        <div className="text-[11px] text-[#8F6910] font-sans">
          Managed by Integration Developer
        </div>
      </div>
    );
  }

  // Blocker / Missing configuration state
  const approvedCount = templates.filter((t) => t.status === 'APPROVED').length;

  return (
    <div className="bg-[#FEF9EE] border-b border-[#F3E0B5] text-xs text-[#8F6910]">
      <div className="px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#C99726] shrink-0" />
          <div>
            <strong className="text-[#5C1D24] font-semibold">Integration Notice: </strong>
            <span>
              Auto campaigns will be held until external WhatsApp provisioning is complete.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] px-2 py-0.5 rounded bg-[#F3E0B5] text-[#431217] font-medium">
            {connection.status === 'ACTIVE' ? 'Connection OK' : 'Connection Pending'}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#5C1D24] hover:underline"
          >
            {isExpanded ? 'Hide Details' : 'View Readiness Details'}
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="px-6 pb-3 pt-1 border-t border-[#F3E0B5]/60 bg-[#FAF8F5]/80 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="flex items-start gap-2 bg-white p-2.5 rounded border border-[#EAE4DC]">
              <Radio className="w-4 h-4 text-[#8F6910] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#2A1D1A]">WhatsApp Cloud Connection</p>
                <p className="text-[#6B5E59]">
                  Status: <span className="font-medium">{connection.status}</span>
                </p>
                {connection.phoneNumberId && (
                  <p className="text-[#6B5E59]">Phone ID: {connection.phoneNumberId}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-2 bg-white p-2.5 rounded border border-[#EAE4DC]">
              <FileText className="w-4 h-4 text-[#8F6910] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#2A1D1A]">Template Catalogue</p>
                <p className="text-[#6B5E59]">
                  {approvedCount} of {templates.length} templates approved by Meta for this store.
                </p>
              </div>
            </div>
          </div>

          {missingConfiguration.length > 0 && (
            <div className="text-[11px] text-[#5C1D24] bg-[#FDF5F6] p-2 rounded border border-[#F0DADC]">
              <span className="font-semibold">Missing Prerequisites: </span>
              {missingConfiguration.map((m) => m.replace(/_/g, ' ').toLowerCase()).join(', ')}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-[#6B5E59]">
            <Info className="w-3.5 h-3.5 shrink-0 text-[#8F6910]" />
            <span>
              This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
