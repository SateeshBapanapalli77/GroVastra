'use client';

import React, { useState } from 'react';
import { Download, AlertCircle, X } from 'lucide-react';

export const ExportCsvButton: React.FC = () => {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#EAE4DC] bg-white text-xs font-semibold text-[#6B5E59] hover:text-[#5C1D24] hover:bg-[#FAF8F5] transition-all cursor-pointer shadow-2xs"
        title="Export CSV report data"
      >
        <Download className="w-3.5 h-3.5 text-[#8F6910]" />
        <span>Export CSV</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-[#EAE4DC] shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4DC]">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[#8F6910]" />
                <h3 className="font-serif text-base font-bold text-[#431217]">
                  CSV Export Unavailable
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[#988B86] hover:text-[#2A1D1A]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#6B5E59] leading-relaxed">
              <p>
                The campaign reporting backend API currently provides live JSON endpoints for executive metrics, but does not provide a dedicated streaming CSV export endpoint (`GET /campaigns/reports/export.csv`).
              </p>
              <div className="p-3 bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl text-[#8F6910]">
                <strong>Backend Gap Logged: </strong>
                This requirement has been documented under <em>Gap 8: Dedicated CSV Export Endpoint</em> in the engineering gap audit. Client-side fake synthesis was intentionally avoided per non-negotiables.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-[#5C1D24] text-white text-xs font-semibold hover:bg-[#431217]"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
