'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, generateIdempotencyKey } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import {
  CheckCircle2,
  ShoppingBag,
  AlertCircle,
  Loader2,
  FileCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface MarkGoalDialogProps {
  enrollmentId: string;
  customerName?: string | null;
  maskedPhone?: string | null;
  campaignName?: string | null;
  occurrenceId?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function MarkGoalDialog({
  enrollmentId,
  customerName,
  maskedPhone,
  campaignName,
  occurrenceId,
  onClose,
  onSuccess
}: MarkGoalDialogProps) {
  const queryClient = useQueryClient();

  const [orderRef, setOrderRef] = useState('');
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const goalMutation = useMutation({
    mutationFn: async () => {
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        throw new Error('A staff reason/notes entry is mandatory for audit records.');
      }

      const idemp = generateIdempotencyKey('mark_goal');
      const orderRefToUse = orderRef.trim() || 'manual_staff_completion';
      return api.markGoal(enrollmentId, orderRefToUse, trimmedReason, idemp);
    },
    onSuccess: (data) => {
      toast.success('Occasion goal marked; pending sales follow-ups stopped');
      // Invalidate server queries (Server-confirmed; no optimistic update!)
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to mark goal completion');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!reason.trim()) {
      setValidationError('Please provide a staff note/reason explaining the purchase or completed goal.');
      return;
    }

    goalMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white border border-[#EAE4DC] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] border border-[#C3E8CB] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-[#1B7A43]" />
          </div>
          <div className="space-y-1">
            <h3 className="font-serif text-lg font-bold text-[#431217]">
              Mark Occasion Goal Reached
            </h3>
            <p className="text-xs text-[#6B5E59]">
              Record in-store saree purchase or conversion. Pending promotional follow-ups will halt immediately.
            </p>
          </div>
        </div>

        {/* Patron Context Box */}
        <div className="p-3 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[#988B86]">Patron:</span>
            <strong className="text-[#2A1D1A] font-serif">{customerName || 'Boutique Patron'}</strong>
          </div>
          {maskedPhone && (
            <div className="flex items-center justify-between">
              <span className="text-[#988B86]">Masked Phone:</span>
              <code className="font-mono text-[11px] text-[#5C1D24]">{maskedPhone}</code>
            </div>
          )}
          {campaignName && (
            <div className="flex items-center justify-between">
              <span className="text-[#988B86]">Campaign Track:</span>
              <span className="text-[#2A1D1A] font-medium">{campaignName}</span>
            </div>
          )}
          {occurrenceId && (
            <div className="flex items-center justify-between">
              <span className="text-[#988B86]">Occasion Reference:</span>
              <code className="font-mono text-[10px] text-[#6B5E59]">{occurrenceId}</code>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Order Reference Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#2A1D1A]">
              Store Order Reference (Optional)
            </label>
            <input
              type="text"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="e.g. ord_silk_104 or bill #4920 (defaults to manual_staff_completion)"
              className="w-full text-xs px-3 py-2 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden text-[#2A1D1A]"
            />
          </div>

          {/* Mandatory Reason/Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#2A1D1A]">
              Staff Notes / Purchase Reason <span className="text-[#9E2A2B]">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="e.g. Patron visited boutique and purchased Handloom Tussar Silk saree in person for birthday occasion."
              className="w-full text-xs p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] focus:bg-white focus:border-[#5C1D24] outline-hidden leading-relaxed text-[#2A1D1A]"
            />
            {validationError ? (
              <p className="text-[11px] text-[#9E2A2B] font-medium">{validationError}</p>
            ) : (
              <p className="text-[10px] text-[#988B86]">
                Audited in the store logs. Remaining steps in this occasion sequence will be recorded as SKIPPED_GOAL_REACHED.
              </p>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#EAE4DC]">
            <button
              type="button"
              onClick={onClose}
              disabled={goalMutation.isPending}
              className="px-4 py-2 text-xs text-[#6B5E59] hover:text-[#2A1D1A] cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={goalMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1B7A43] text-white text-xs font-semibold hover:bg-[#145C32] transition-all cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {goalMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing Goal...</span>
                </>
              ) : (
                <>
                  <FileCheck className="w-3.5 h-3.5 text-[#C3E8CB]" />
                  <span>Confirm Goal Reached</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
