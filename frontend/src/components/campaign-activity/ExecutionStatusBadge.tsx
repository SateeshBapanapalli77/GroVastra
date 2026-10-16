'use client';

import React from 'react';
import {
  Clock,
  Pause,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Check,
  Eye,
  HelpCircle,
  XCircle,
  MessageSquare
} from 'lucide-react';

export type NormalizedStatus =
  | 'scheduled'
  | 'deferred'
  | 'skipped'
  | 'blocked'
  | 'expired'
  | 'accepted'
  | 'delivered'
  | 'read'
  | 'unknown'
  | 'failed';

interface ExecutionStatusBadgeProps {
  status?: string | null;
  outcomeReason?: string | null;
  isHeld?: boolean;
  className?: string;
}

export function normalizeStatus(rawStatus?: string | null, outcomeReason?: string | null): NormalizedStatus {
  if (!rawStatus) return 'unknown';

  const s = rawStatus.toUpperCase();

  if (s === 'SCHEDULED') return 'scheduled';
  if (s === 'DEFERRED') return 'deferred';
  if (s === 'SKIPPED') return 'skipped';
  if (s === 'BLOCKED') return 'blocked';
  if (s === 'EXPIRED') return 'expired';
  if (s === 'PROVIDER_ACCEPTED' || s === 'ACCEPTED') return 'accepted';
  if (s === 'DELIVERED') return 'delivered';
  if (s === 'READ') return 'read';
  if (s === 'FAILED') return 'failed';

  // Check outcomeReason if state is ambiguous
  if (outcomeReason) {
    const r = outcomeReason.toUpperCase();
    if (r.startsWith('SKIPPED')) return 'skipped';
    if (r.startsWith('DEFERRED')) return 'deferred';
    if (r.startsWith('BLOCKED')) return 'blocked';
    if (r.includes('EXPIRE')) return 'expired';
    if (r.startsWith('FAILED')) return 'failed';
  }

  return 'unknown';
}

export function ExecutionStatusBadge({
  status,
  outcomeReason,
  isHeld,
  className = ''
}: ExecutionStatusBadgeProps) {
  const normalized = normalizeStatus(status, outcomeReason);

  // Return "Held for staff" indicator if reply hold is active
  if (isHeld || outcomeReason === 'SKIPPED_REPLY_HOLD' || status === 'HELD_REPLY') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5] shadow-2xs ${className}`}
        title="Automated dispatch held because customer replied; requires boutique staff attention."
      >
        <MessageSquare className="w-3 h-3 text-[#C99726]" />
        <span>Held for staff</span>
      </span>
    );
  }

  switch (normalized) {
    case 'scheduled':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] ${className}`}
        >
          <Clock className="w-3 h-3 text-[#1D4ED8]" />
          <span>Scheduled</span>
        </span>
      );

    case 'deferred':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5] ${className}`}
        >
          <Pause className="w-3 h-3 text-[#8F6910]" />
          <span>Deferred</span>
        </span>
      );

    case 'skipped':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F4EFE8] text-[#6B5E59] border border-[#EAE4DC] ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#6B5E59]" />
          <span>Skipped</span>
        </span>
      );

    case 'blocked':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FFF7E6] text-[#B26A00] border border-[#FFE2B3] ${className}`}
        >
          <AlertTriangle className="w-3 h-3 text-[#B26A00]" />
          <span>Blocked</span>
        </span>
      );

    case 'expired':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] ${className}`}
        >
          <Clock className="w-3 h-3 text-[#6D28D9]" />
          <span>Expired</span>
        </span>
      );

    case 'accepted':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#ECFEFF] text-[#0E7490] border border-[#A5F3FC] ${className}`}
        >
          <Check className="w-3 h-3 text-[#0E7490]" />
          <span>Accepted</span>
        </span>
      );

    case 'delivered':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#EBF7EE] text-[#1B7A43] border border-[#C3E8CB] ${className}`}
        >
          <CheckCircle2 className="w-3 h-3 text-[#1B7A43]" />
          <span>Delivered</span>
        </span>
      );

    case 'read':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F0F9FF] text-[#0369A1] border border-[#BAE6FD] ${className}`}
        >
          <Eye className="w-3 h-3 text-[#0369A1]" />
          <span>Read</span>
        </span>
      );

    case 'failed':
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF2F2] text-[#9E2A2B] border border-[#F8D7DA] ${className}`}
        >
          <XCircle className="w-3 h-3 text-[#9E2A2B]" />
          <span>Failed</span>
        </span>
      );

    case 'unknown':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7] ${className}`}
        >
          <HelpCircle className="w-3 h-3 text-[#71717A]" />
          <span>{status || 'Unknown'}</span>
        </span>
      );
  }
}
