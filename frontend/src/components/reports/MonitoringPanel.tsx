'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  FileX,
  Server,
  Layers,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { DateTime } from 'luxon';
import { MonitoringAlertsSchema } from '../../lib/schemas';
import { z } from 'zod';

type MonitoringData = z.infer<typeof MonitoringAlertsSchema>;

interface MonitoringPanelProps {
  monitoring?: MonitoringData;
  isLoading?: boolean;
}

export const MonitoringPanel: React.FC<MonitoringPanelProps> = ({
  monitoring,
  isLoading
}) => {
  if (isLoading) {
    return (
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="h-6 w-48 bg-[#FAF8F5] rounded animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-20 bg-[#FAF8F5] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!monitoring) {
    return (
      <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 text-center text-xs text-[#988B86]">
        Monitoring metrics currently unavailable from backend engine.
      </div>
    );
  }

  const { status, alerts, metrics, evaluatedAt } = monitoring;

  const evaluatedLocal = evaluatedAt
    ? DateTime.fromISO(evaluatedAt).setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm:ss')
    : 'Just now';
  const evaluatedUtc = evaluatedAt
    ? DateTime.fromISO(evaluatedAt).toUTC().toFormat('yyyy-MM-dd HH:mm:ss') + ' UTC'
    : 'Unknown';

  const statusConfig = {
    HEALTHY: {
      label: 'All Systems Nominal',
      sublabel: 'Workers, schedulers, and delivery channels active',
      badgeClass: 'bg-[#EBF7EE] text-[#145C32] border-[#C3E8CB]',
      icon: CheckCircle2
    },
    DEGRADED: {
      label: 'Performance Degraded',
      sublabel: 'Operational backlogs or elevated latencies detected',
      badgeClass: 'bg-[#FEF9EE] text-[#8F6910] border-[#F3E0B5]',
      icon: AlertTriangle
    },
    CRITICAL: {
      label: 'Critical Backlog Alert',
      sublabel: 'Severe worker delay or stalled processing checkpoints',
      badgeClass: 'bg-[#FDF2F2] text-[#9E2A2B] border-[#F8D7DA]',
      icon: ShieldAlert
    }
  }[status] || {
    label: 'Status Unknown',
    sublabel: 'Metrics evaluating',
    badgeClass: 'bg-[#FAF8F5] text-[#6B5E59] border-[#EAE4DC]',
    icon: HelpCircle
  };

  const StatusIcon = statusConfig.icon;

  const metricCards = [
    {
      id: 'plannerLag',
      label: 'Planner Lag',
      value: `${metrics.plannerLagMinutes} min`,
      subtext: 'Target < 60 min',
      isWarning: metrics.plannerLagMinutes > 60,
      icon: Clock
    },
    {
      id: 'dueStepAge',
      label: 'Due-Step Age',
      value: `${metrics.dueStepAgeMinutes} min`,
      subtext: 'Overdue execution queue',
      isWarning: metrics.dueStepAgeMinutes > 15,
      isCritical: metrics.dueStepAgeMinutes > 120,
      icon: Activity
    },
    {
      id: 'quarantinedEvents',
      label: 'Quarantined Events',
      value: metrics.eventBacklogCount,
      subtext: 'Inbox backlog awaiting scan',
      isWarning: metrics.eventBacklogCount > 10,
      icon: Layers
    },
    {
      id: 'unknownOutcomes',
      label: 'Unknown Outcomes',
      value: metrics.unknownOutcomesCount,
      subtext: 'Ambiguous provider receipts',
      isWarning: metrics.unknownOutcomesCount > 0,
      icon: HelpCircle
    },
    {
      id: 'templateBlocks',
      label: 'Template Blocks',
      value: metrics.templateBlocksCount,
      subtext: 'Missing templates or variables',
      isWarning: metrics.templateBlocksCount > 0,
      icon: FileX
    },
    {
      id: 'stalledCheckpoints',
      label: 'Stalled Workers',
      value: metrics.stalledCheckpointsCount,
      subtext: 'Idle worker cursors (>30m)',
      isWarning: metrics.stalledCheckpointsCount > 0,
      icon: Server
    }
  ];

  return (
    <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-6">
      {/* Header and Operational Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#EAE4DC]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-lg font-bold text-[#431217]">
              Engine Health &amp; Operations Monitoring
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${statusConfig.badgeClass}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              <span>{status}</span>
            </span>
          </div>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Real-time pipeline diagnostics, planner queue lag, and automated safeguard alerts.
          </p>
        </div>

        <div className="text-right">
          <div
            className="text-[11px] text-[#988B86] cursor-help inline-flex items-center gap-1"
            title={`Evaluated UTC: ${evaluatedUtc}`}
          >
            <Clock className="w-3 h-3 text-[#C99726]" />
            <span>Evaluated: {evaluatedLocal}</span>
          </div>
          <div className="text-[10px] text-[#988B86] font-mono">
            Asia/Kolkata (Hover for UTC)
          </div>
        </div>
      </div>

      {/* 6 Key Operational Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metricCards.map((card) => {
          const CardIcon = card.icon;

          return (
            <div
              key={card.id}
              className={`p-3.5 rounded-xl border transition-all ${
                card.isCritical
                  ? 'bg-[#FDF2F2] border-[#F8D7DA]'
                  : card.isWarning
                  ? 'bg-[#FEF9EE] border-[#F3E0B5]'
                  : 'bg-[#FAF8F5] border-[#EAE4DC]'
              }`}
            >
              <div className="flex items-center justify-between text-[#6B5E59] mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider truncate">
                  {card.label}
                </span>
                <CardIcon
                  className={`w-3.5 h-3.5 ${
                    card.isCritical
                      ? 'text-[#9E2A2B]'
                      : card.isWarning
                      ? 'text-[#C99726]'
                      : 'text-[#988B86]'
                  }`}
                />
              </div>

              <div
                className={`text-xl font-bold font-serif ${
                  card.isCritical
                    ? 'text-[#9E2A2B]'
                    : card.isWarning
                    ? 'text-[#8F6910]'
                    : 'text-[#2A1D1A]'
                }`}
              >
                {card.value}
              </div>

              <p className="text-[10px] text-[#988B86] mt-0.5 truncate" title={card.subtext}>
                {card.subtext}
              </p>
            </div>
          );
        })}
      </div>

      {/* Active System Alerts Feed */}
      <div>
        <h3 className="font-serif text-xs font-bold text-[#2A1D1A] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#5C1D24]" />
          <span>Active Alerts &amp; Diagnostic Logs ({alerts.length})</span>
        </h3>

        {alerts.length === 0 ? (
          <div className="p-4 rounded-xl border border-[#C3E8CB] bg-[#EBF7EE] text-xs text-[#145C32] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#1B7A43] shrink-0" />
            <span>Zero active operational incidents. All dispatch workers and planner cursors are operating normally.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert, index) => {
              const isCrit = alert.severity === 'CRITICAL';
              return (
                <div
                  key={`${alert.code}-${index}`}
                  className={`p-3 rounded-xl border text-xs flex items-start gap-3 ${
                    isCrit
                      ? 'bg-[#FDF2F2] border-[#F8D7DA] text-[#9E2A2B]'
                      : 'bg-[#FEF9EE] border-[#F3E0B5] text-[#8F6910]'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold font-mono text-[11px] uppercase tracking-wide">
                        {alert.code}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                          isCrit
                            ? 'bg-[#9E2A2B] text-white border-[#721C24]'
                            : 'bg-[#C99726] text-white border-[#8F6910]'
                        }`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#2A1D1A]">
                      {alert.message}
                    </p>
                    <div className="text-[10px] text-[#6B5E59] pt-1">
                      <strong>Remediation: </strong>
                      {alert.code === 'PLANNER_LAG' &&
                        'Check worker process logs (workers/planner.ts) and verify MongoDB replica connection.'}
                      {alert.code === 'DUE_STEP_BACKLOG' &&
                        'Verify executor worker loop (workers/executor.ts) and database IOPS.'}
                      {alert.code === 'EVENT_BACKLOG' &&
                        'Run event rescan worker and inspect event inbox quarantine.'}
                      {alert.code === 'UNKNOWN_OUTCOMES' &&
                        'Correlate with WhatsApp webhook status receipts. Do not force resend.'}
                      {alert.code === 'TEMPLATE_BLOCKS' &&
                        'Verify approved template status and variable parameters in catalogue.'}
                      {alert.code === 'STALLED_CHECKPOINTS' &&
                        'Inspect worker container heap/memory and restart affected worker.'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
