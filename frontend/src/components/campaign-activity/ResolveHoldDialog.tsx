'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, generateIdempotencyKey } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import {
  MessageSquare,
  UserCheck,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';

interface ResolveHoldDialogProps {
  enrollmentId: string;
  customerName?: string | null;
  maskedPhone?: string | null;
  heldAt?: string | Date | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ResolveHoldDialog({
  enrollmentId,
  customerName,
  maskedPhone,
  heldAt,
  onClose,
  onSuccess
}: ResolveHoldDialogProps) {
  const queryClient = useQueryClient();

  const [action, setAction] = useState<'RESUME' | 'CANCEL'>('RESUME');
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        throw new Error('A staff resolution reason is mandatory.');
      }

      const idemp = generateIdempotencyKey('resolve_hold');
      return api.resolveHold(enrollmentId, action, trimmedReason, idemp);
    },
    onSuccess: (data) => {
      toast.success(
        action === 'RESUME'
          ? 'Staff hold released; automated occasion sequence resumed'
          : 'Staff hold cancelled; further occasion messages halted'
      );
      // Invalidate server queries (Server-confirmed; no optimistic update!)
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to resolve hold');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!reason.trim()) {
      setValidationError('Please provide an audited resolution reason for the store records.');
      return;
    }

    resolveMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FEF9EE] border border-[#F3E0B5] flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-[#8F6910]" />
          </div>
          <div className="space-y-1">
            <h3 className="font-serif text-lg font-bold text-[#431217]">
              Resolve Staff Conversation Hold
            </h3>
            <p className="text-xs text-[#6B5E59]">
              Patron replied to WhatsApp campaign message. Review conversation and resolve the automated dispatch hold.
            </p>
          </div>
        </div>

        {/* Patron Context Box */}
        <div className="p-3 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[#988B86]">Target Patron:</span>
            <strong className="text-[#2A1D1A] font-serif">{customerName || 'Boutique Patron'}</strong>
          </div>
          {maskedPhone && (
            <div className="flex items-center justify-between">
              <span className="text-[#988B86]">Masked Phone:</span>
              <code className="font-mono text-[11px] text-[#5C1D24]">{maskedPhone}</code>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[#988B86]">Enrollment Reference:</span>
            <code className="font-mono text-[10px] text-[#6B5E59]">{enrollmentId}</code>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Action Choice Radio */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#2A1D1A]">
              Resolution Action
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition-all ${
                  action === 'RESUME'
                    ? 'border-[#5C1D24] bg-[#FAF8F5] ring-1 ring-[#5C1D24]'
                    : 'border-[#EAE4DC] hover:border-[#C99726]'
                }`}
              >
                <input
                  type="radio"
                  name="action"
                  value="RESUME"
                  checked={action === 'RESUME'}
                  onChange={() => setAction('RESUME')}
                  className="mt-0.5 text-[#5C1D24] focus:ring-[#5C1D24]"
                />
                <div className="text-xs space-y-0.5">
                  <strong className="text-[#431217] block">Resume Automation</strong>
                  <span className="text-[11px] text-[#6B5E59]">
                    Patron enquiry handled; resume scheduled follow-up steps.
                  </span>
                </div>
              </label>

              <label
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition-all ${
                  action === 'CANCEL'
                    ? 'border-[#9E2A2B] bg-[#FDF2F2] ring-1 ring-[#9E2A2B]'
                    : 'border-[#EAE4DC] hover:border-[#C99726]'
                }`}
              >
                <input
                  type="radio"
                  name="action"
                  value="CANCEL"
                  checked={action === 'CANCEL'}
                  onChange={() => setAction('CANCEL')}
                  className="mt-0.5 text-[#9E2A2B] focus:ring-[#9E2A2B]"
                />
                <div className="text-xs space-y-0.5">
                  <strong className="text-[#9E2A2B] block">Cancel Follow-ups</strong>
                  <span className="text-[11px] text-[#6B5E59]">
                    Patron requested pause or handling entirely via personal chat.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Mandatory Reason Textarea */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#2A1D1A]">
              Staff Resolution Reason <span className="text-[#9E2A2B]">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="e.g. Patron replied requesting bridal Kanchipuram catalogue; answered via personal boutique WhatsApp and patron confirmed visiting on Saturday."
              className="w-full text-xs p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden leading-relaxed text-[#2A1D1A]"
            />
            {validationError ? (
              <p className="text-[11px] text-[#9E2A2B] font-medium">{validationError}</p>
            ) : (
              <p className="text-[10px] text-[#988B86]">
                This reason is permanently recorded in the append-only boutique audit trail.
              </p>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#EAE4DC]">
            <button
              type="button"
              onClick={onClose}
              disabled={resolveMutation.isPending}
              className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={resolveMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#73232C] transition-all cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {resolveMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing &amp; Saving...</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-3.5 h-3.5 text-[#F3E0B5]" />
                  <span>Confirm Hold Resolution</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
