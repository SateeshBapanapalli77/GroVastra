'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import {
  Users,
  Search,
  Phone,
  Tag,
  AlertCircle,
  Calendar,
  Clock,
  ChevronRight,
  RefreshCw,
  X
} from 'lucide-react';
import { DateTime } from 'luxon';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  const {
    data: customersData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.customers.all,
    queryFn: () => api.getCustomers()
  });

  const {
    data: timelineData,
    isLoading: timelineLoading
  } = useQuery({
    queryKey: queryKeys.customers.timeline(selectedCustomer?.id || ''),
    queryFn: () => api.getCustomerTimeline(selectedCustomer!.id),
    enabled: Boolean(selectedCustomer?.id)
  });

  const customers = customersData?.customers || [];

  const filtered = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const nameMatch = c.name?.toLowerCase().includes(q);
    const phoneMatch = c.phone?.toLowerCase().includes(q);
    const tagMatch = c.tags?.some((t: string) => t.toLowerCase().includes(q));
    return nameMatch || phoneMatch || tagMatch;
  });

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Patrons & CRM']}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[#431217]">
              Patrons &amp; CRM Eligibility
            </h1>
            <p className="text-xs text-[#6B5E59] mt-0.5">
              Audience profiles evaluated for annual occasions, birthdays, and restock notifications.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#988B86] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, tag, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#EAE4DC] bg-white focus:border-[#5C1D24] outline-hidden w-64"
              />
            </div>
          </div>
        </div>

        {/* Customer Cards Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 bg-white border border-[#F8D7DA] rounded-xl text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
            <h3 className="text-xs font-bold text-[#9E2A2B]">Unable to load patrons</h3>
            <p className="text-xs text-[#6B5E59]">{(error as Error)?.message || 'Service offline'}</p>
            <button
              onClick={() => refetch()}
              className="px-3.5 py-1.5 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 bg-white border border-[#EAE4DC] rounded-2xl text-center space-y-3">
            <Users className="w-8 h-8 text-[#C99726] mx-auto" />
            <h3 className="font-serif text-sm font-bold text-[#2A1D1A]">
              No patrons match your search
            </h3>
            <p className="text-xs text-[#6B5E59] max-w-sm mx-auto">
              Ensure customer records in store CRM contain valid birthday and anniversary dates.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((customer) => {
              // Date-only display rule (Non-negotiable 9): Date-only values (birthdays) are never converted through UTC.
              const birthday = customer.preferences?.birthday || (customer as any).birthday;
              const anniversary = customer.preferences?.anniversary || (customer as any).anniversary;

              return (
                <div
                  key={customer.id}
                  onClick={() => setSelectedCustomer(customer)}
                  className="bg-white border border-[#EAE4DC] rounded-xl p-4 shadow-2xs hover:border-[#5C1D24] cursor-pointer transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE4DC] text-[#6B5E59]">
                        {customer.id}
                      </span>
                      {customer.optedOut ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FDF2F2] text-[#9E2A2B] border border-[#F8D7DA] font-semibold">
                          Opted Out
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EBF7EE] text-[#1B7A43] border border-[#C3E8CB] font-semibold">
                          Opted In
                        </span>
                      )}
                    </div>

                    <h3 className="font-serif text-sm font-bold text-[#2A1D1A] group-hover:text-[#5C1D24] transition-colors">
                      {customer.name || 'Anonymous Patron'}
                    </h3>

                    {/* Masked phone projection (Non-negotiable 12) */}
                    <div className="flex items-center gap-1.5 text-xs text-[#6B5E59] mt-1">
                      <Phone className="w-3 h-3 text-[#988B86]" />
                      <span>{customer.phone || 'Masked on file'}</span>
                    </div>

                    {/* Occasion dates */}
                    <div className="mt-3 pt-2.5 border-t border-[#F3EFE8] space-y-1 text-[11px] text-[#6B5E59]">
                      {birthday && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-[#C99726]" />
                          <span>Birthday: <strong className="text-[#2A1D1A]">{birthday}</strong></span>
                        </div>
                      )}
                      {anniversary && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-[#5C1D24]" />
                          <span>Anniversary: <strong className="text-[#2A1D1A]">{anniversary}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  {customer.tags && customer.tags.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-[#F3EFE8] flex items-center gap-1 flex-wrap">
                      {customer.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-[#FAF8F5] text-[#8F6910] border border-[#EAE4DC]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Customer Timeline Modal */}
        {selectedCustomer && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4 z-50">
            <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-xl w-full p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#EAE4DC] pb-3">
                <div>
                  <h3 className="font-serif text-base font-bold text-[#431217]">
                    Patron Lifecycle Timeline
                  </h3>
                  <p className="text-xs text-[#6B5E59]">
                    {selectedCustomer.name} • {selectedCustomer.phone}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="p-1 rounded-lg text-[#988B86] hover:text-[#2A1D1A] hover:bg-[#F3EFE8]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {timelineLoading ? (
                <div className="py-8 text-center text-xs text-[#6B5E59] animate-pulse">
                  Loading patron timeline...
                </div>
              ) : !((timelineData as any)?.timeline) || (timelineData as any).timeline.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#6B5E59]">
                  No campaign dispatches or occasion enrollments recorded for this patron yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {((timelineData as any).timeline as any[]).map((item: any, idx: number) => {
                    const dt = item.time ? DateTime.fromISO(item.time).setZone('Asia/Kolkata') : null;
                    const formattedTime = dt ? dt.toFormat('dd LLL yyyy, HH:mm') : 'Recorded';

                    return (
                      <div
                        key={item.id || idx}
                        className="p-3 rounded-lg border border-[#EAE4DC] bg-[#FAF8F5] text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#5C1D24] uppercase text-[10px]">
                            {item.type || 'EXECUTION'}
                          </span>
                          <span className="text-[10px] text-[#988B86]">{formattedTime}</span>
                        </div>
                        <p className="text-[#2A1D1A] font-medium">{item.summary || item.state}</p>
                        {item.details && (
                          <p className="text-[11px] text-[#6B5E59]">{item.details}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
