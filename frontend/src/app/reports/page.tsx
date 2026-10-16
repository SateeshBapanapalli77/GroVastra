'use client';

import React, { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '../../components/layout/AppShell';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../lib/useAuth';
import { canViewReports } from '../../lib/roles';
import { DateTime } from 'luxon';
import {
  BarChart3,
  RefreshCw,
  AlertCircle,
  Clock,
  ShieldAlert,
  ShoppingBag,
  TrendingUp,
  ShieldCheck,
  Server
} from 'lucide-react';
import { OwnerOverviewMetrics } from '../../components/reports/OwnerOverviewMetrics';
import { SalesAttributionSection } from '../../components/reports/SalesAttributionSection';
import { FunnelChart } from '../../components/reports/FunnelChart';
import { SafeguardsChart } from '../../components/reports/SafeguardsChart';
import { MonitoringPanel } from '../../components/reports/MonitoringPanel';
import { ExportCsvButton } from '../../components/reports/ExportCsvButton';

function OwnerReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';

  const { user, isLoading: authLoading } = useAuth();

  // 1. Live Owner Overview Report (GET /campaigns/reports/owner-overview)
  const {
    data: reportData,
    isLoading: reportLoading,
    isError: reportError,
    error: reportErr,
    refetch: refetchReport
  } = useQuery({
    queryKey: queryKeys.reports.overview,
    queryFn: () => api.getOwnerOverviewReport()
  });

  // 2. Operational Monitoring Alerts (GET /campaigns/monitoring/alerts)
  const {
    data: monitoringData,
    isLoading: monitoringLoading,
    isError: monitoringError,
    error: monitoringErr,
    refetch: refetchMonitoring
  } = useQuery({
    queryKey: queryKeys.reports.alerts,
    queryFn: () => api.getMonitoringAlerts()
  });

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/reports?${params.toString()}`);
  };

  const handleRefreshAll = () => {
    refetchReport();
    refetchMonitoring();
  };

  const report = reportData?.report;
  const monitoring = monitoringData?.monitoring;

  // IANA timezone formatting with UTC instant on hover (Non-negotiable 9)
  const generatedLocal = report?.generatedAt
    ? DateTime.fromISO(report.generatedAt).setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm:ss')
    : 'Live';
  const generatedUtc = report?.generatedAt
    ? DateTime.fromISO(report.generatedAt).toUTC().toFormat('yyyy-MM-dd HH:mm:ss') + ' UTC'
    : 'Unknown';

  // Permission Gate (Non-negotiable 6 & 11)
  if (!authLoading && !canViewReports(user?.role)) {
    return (
      <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Reports & Attribution']}>
        <div className="p-8 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3 max-w-lg mx-auto">
          <ShieldAlert className="w-8 h-8 text-[#9E2A2B] mx-auto" />
          <h2 className="font-serif text-base font-bold text-[#9E2A2B]">Access Restricted</h2>
          <p className="text-xs text-[#6B5E59]">
            Your current role does not have authorization to view tenant executive reports and system monitoring.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={['GroVastra', 'Auto Campaigns', 'Reports & Attribution']}>
      <div className="space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl font-bold text-[#431217]">
                Campaign Performance &amp; Operations
              </h1>
              {monitoring?.status && (
                <span
                  className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                    monitoring.status === 'HEALTHY'
                      ? 'bg-[#EBF7EE] text-[#145C32] border-[#C3E8CB]'
                      : monitoring.status === 'DEGRADED'
                      ? 'bg-[#FEF9EE] text-[#8F6910] border-[#F3E0B5]'
                      : 'bg-[#FDF2F2] text-[#9E2A2B] border-[#F8D7DA]'
                  }`}
                >
                  System: {monitoring.status}
                </span>
              )}
            </div>
            <p className="text-xs text-[#6B5E59] mt-0.5">
              Verified WhatsApp receipts, conservative single-attribution sales auditing, and real-time engine health.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className="text-[11px] text-[#988B86] cursor-help flex items-center gap-1.5"
              title={`UTC Instant: ${generatedUtc}`}
            >
              <Clock className="w-3.5 h-3.5 text-[#C99726]" />
              <span>Audit: {generatedLocal}</span>
            </div>

            <ExportCsvButton />

            <button
              onClick={handleRefreshAll}
              className="p-1.5 rounded-lg border border-[#EAE4DC] bg-white text-[#6B5E59] hover:text-[#5C1D24] hover:bg-[#FAF8F5] transition-all cursor-pointer shadow-2xs"
              title="Refresh all metrics"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-[#EAE4DC] pb-px">
          {[
            { id: 'overview', label: 'Executive Overview', icon: TrendingUp },
            { id: 'attribution', label: 'Sales Attribution', icon: ShoppingBag },
            { id: 'funnel', label: 'Engagement Funnel', icon: BarChart3 },
            { id: 'safeguards', label: 'Safeguards & Outcomes', icon: ShieldCheck },
            { id: 'monitoring', label: 'Engine Monitoring', icon: Server, badge: monitoring?.alerts.length }
          ].map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  isActive
                    ? 'border-[#5C1D24] text-[#5C1D24]'
                    : 'border-transparent text-[#6B5E59] hover:text-[#2A1D1A]'
                }`}
              >
                <TabIcon className="w-4 h-4" />
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5]">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Content Areas */}
        {reportLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
              ))}
            </div>
            <div className="h-72 bg-white border border-[#EAE4DC] rounded-xl animate-pulse" />
          </div>
        ) : reportError || !report ? (
          <div className="p-8 bg-white border border-[#F8D7DA] rounded-2xl text-center space-y-3 max-w-lg mx-auto">
            <AlertCircle className="w-8 h-8 text-[#9E2A2B] mx-auto" />
            <h3 className="text-xs font-bold text-[#9E2A2B]">Unable to load executive report</h3>
            <p className="text-xs text-[#6B5E59]">
              {(reportErr as Error)?.message || 'The reporting engine is currently unreachable.'}
            </p>
            <button
              onClick={() => refetchReport()}
              className="px-4 py-2 rounded-xl bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#431217]"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tab 1: Executive Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <OwnerOverviewMetrics report={report} />
                <SalesAttributionSection salesAttribution={report.salesAttribution} />
                <MonitoringPanel monitoring={monitoring} isLoading={monitoringLoading} />
              </div>
            )}

            {/* Tab 2: Sales Attribution */}
            {activeTab === 'attribution' && (
              <div className="space-y-6">
                <SalesAttributionSection salesAttribution={report.salesAttribution} />
              </div>
            )}

            {/* Tab 3: Engagement Funnel */}
            {activeTab === 'funnel' && (
              <div className="space-y-6">
                <FunnelChart
                  eligibleCustomers={report.eligibleCustomers}
                  totalEnrollments={report.enrollments.total}
                  accepted={report.evidenceCounts.accepted}
                  delivered={report.evidenceCounts.delivered}
                  read={report.evidenceCounts.read}
                  goalsCompleted={report.goalCompletions.totalGoalEnrollments}
                />
                <OwnerOverviewMetrics report={report} />
              </div>
            )}

            {/* Tab 4: Safeguards & Decision Precedence */}
            {activeTab === 'safeguards' && (
              <div className="space-y-6">
                <SafeguardsChart
                  reasonsSummary={report.reasonsSummary}
                  scheduledCount={report.executions.scheduled}
                  deferredCount={report.executions.deferred}
                  skippedCount={report.executions.skipped}
                  cancelledCount={report.executions.cancelled}
                  expiredCount={report.executions.expired}
                />
              </div>
            )}

            {/* Tab 5: Engine Health & Operational Monitoring */}
            {activeTab === 'monitoring' && (
              <div className="space-y-6">
                <MonitoringPanel monitoring={monitoring} isLoading={monitoringLoading} />
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function OwnerReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-[#FAF8F5] items-center justify-center text-xs text-[#6B5E59] gap-2">
          <div className="w-5 h-5 border-2 border-[#5C1D24] border-t-transparent rounded-full animate-spin" />
          <span>Loading performance reports &amp; system monitoring...</span>
        </div>
      }
    >
      <OwnerReportsContent />
    </Suspense>
  );
}
