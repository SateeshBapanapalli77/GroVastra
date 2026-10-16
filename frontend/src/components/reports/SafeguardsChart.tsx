'use client';

import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { resolveReasonCode } from '../../lib/reasonCodes';
import { ShieldCheck } from 'lucide-react';

interface SafeguardsChartProps {
  reasonsSummary: Record<string, number>;
  scheduledCount: number;
  deferredCount: number;
  skippedCount: number;
  cancelledCount: number;
  expiredCount: number;
}

export const SafeguardsChart: React.FC<SafeguardsChartProps> = ({
  reasonsSummary,
  scheduledCount,
  deferredCount,
  skippedCount,
  cancelledCount,
  expiredCount
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Format reason codes into humanized entries with reasonCodes dictionary
  const reasonEntries = Object.entries(reasonsSummary || {}).map(([code, count]) => {
    const meta = resolveReasonCode(code);
    return {
      code,
      shortLabel: meta.sentence.length > 25 ? meta.sentence.slice(0, 23) + '…' : meta.sentence,
      sentence: meta.sentence,
      category: meta.category,
      fixOwner: meta.fixOwner,
      count
    };
  });

  // Sort descending by count
  reasonEntries.sort((a, b) => b.count - a.count);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'deferred':
        return '#C99726'; // Antique gold
      case 'skipped':
        return '#8F6910'; // Warm ochre
      case 'blocked':
        return '#9E2A2B'; // Reddish/burgundy
      case 'expired':
        return '#6B5E59'; // Slate
      default:
        return '#5C1D24'; // Burgundy
    }
  };

  return (
    <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-6">
      {/* Safeguard Philosophy Banner */}
      <div className="p-4 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#5C1D24] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-serif text-sm font-bold text-[#431217]">
            Business Outcomes &amp; Protective Safeguards (Not Errors)
          </h3>
          <p className="text-xs text-[#6B5E59] leading-relaxed">
            GroVastra intentionally skips or defers messages when protective rules fire. When a customer replies, automation pauses for human weavers. When a patron completes an order, promotional nudges automatically stop to prevent spam. These decisions represent sound boutique etiquette, not platform failures.
          </p>
        </div>
      </div>

      {/* Overview Stat Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 rounded-xl border border-[#EAE4DC] bg-white">
          <span className="text-[10px] font-bold text-[#6B5E59] uppercase tracking-wider">
            Scheduled Future
          </span>
          <div className="text-xl font-bold font-serif text-[#2A1D1A] mt-1">
            {scheduledCount}
          </div>
          <p className="text-[10px] text-[#988B86]">Pending next due time</p>
        </div>

        <div className="p-3 rounded-xl border border-[#F3E0B5] bg-[#FEF9EE]">
          <span className="text-[10px] font-bold text-[#8F6910] uppercase tracking-wider">
            Deferred (Quiet Hours)
          </span>
          <div className="text-xl font-bold font-serif text-[#8F6910] mt-1">
            {deferredCount}
          </div>
          <p className="text-[10px] text-[#8F6910]">Delayed to morning gate</p>
        </div>

        <div className="p-3 rounded-xl border border-[#EAE4DC] bg-white">
          <span className="text-[10px] font-bold text-[#6B5E59] uppercase tracking-wider">
            Skipped Safeguards
          </span>
          <div className="text-xl font-bold font-serif text-[#5C1D24] mt-1">
            {skippedCount}
          </div>
          <p className="text-[10px] text-[#988B86]">Caps, holds, or goals</p>
        </div>

        <div className="p-3 rounded-xl border border-[#EAE4DC] bg-white">
          <span className="text-[10px] font-bold text-[#6B5E59] uppercase tracking-wider">
            Paused / Cancelled
          </span>
          <div className="text-xl font-bold font-serif text-[#6B5E59] mt-1">
            {cancelledCount}
          </div>
          <p className="text-[10px] text-[#988B86]">Manual boutique stop</p>
        </div>

        <div className="p-3 rounded-xl border border-[#EAE4DC] bg-white">
          <span className="text-[10px] font-bold text-[#6B5E59] uppercase tracking-wider">
            Window Expired
          </span>
          <div className="text-xl font-bold font-serif text-[#988B86] mt-1">
            {expiredCount}
          </div>
          <p className="text-[10px] text-[#988B86]">Past valid send window</p>
        </div>
      </div>

      {/* Accessible Text Alternative Table for Assistive Tech */}
      <div className="sr-only">
        <table summary="Safeguards and reason codes distribution for skipped or deferred campaign executions">
          <caption>Safeguard Decision Breakdown</caption>
          <thead>
            <tr>
              <th scope="col">Reason Code</th>
              <th scope="col">Explanation</th>
              <th scope="col">Category</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {reasonEntries.map((row) => (
              <tr key={row.code}>
                <th scope="row">{row.code}</th>
                <td>{row.sentence}</td>
                <td>{row.category}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recharts Bar Chart of Safeguards */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-serif text-xs font-bold text-[#2A1D1A] uppercase tracking-wider">
            Safeguards &amp; Decision Precedence Distribution
          </h4>
          <span className="text-[11px] text-[#988B86]">Evaluated via Unified Reason Dictionary</span>
        </div>

        {reasonEntries.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#988B86] border border-dashed border-[#EAE4DC] rounded-xl">
            No skipped or deferred execution reasons recorded. All dispatches followed primary schedule.
          </div>
        ) : (
          <div className="h-64 w-full pt-2">
            {isMounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={reasonEntries}
                  layout="vertical"
                  margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
                  aria-label="Safeguards distribution horizontal bar chart"
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3EFE8" />
                  <XAxis
                    type="number"
                    tick={{ fill: '#6B5E59', fontSize: 11 }}
                    axisLine={{ stroke: '#EAE4DC' }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    tick={{ fill: '#6B5E59', fontSize: 11 }}
                    axisLine={{ stroke: '#EAE4DC' }}
                    tickLine={false}
                    width={160}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-white border border-[#EAE4DC] p-2.5 rounded-lg shadow-md text-xs space-y-1">
                            <div className="font-bold text-[#431217]">{item.sentence}</div>
                            <div className="font-mono text-[10px] text-[#8F6910]">{item.code}</div>
                            <div className="text-sm font-serif font-bold text-[#5C1D24]">
                              {item.count} executions
                            </div>
                            <div className="text-[10px] text-[#6B5E59]">
                              Category: <span className="capitalize">{item.category}</span> • Fix Owner: <span className="capitalize">{item.fixOwner}</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}>
                    {reasonEntries.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getCategoryColor(entry.category)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full bg-[#FAF8F5] rounded-xl animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* Reason Dictionary Cards */}
      {reasonEntries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
          {reasonEntries.map((item) => (
            <div
              key={item.code}
              className="p-3 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-white text-[#5C1D24] border-[#EAE4DC]">
                    {item.category}
                  </span>
                  <span className="text-xs font-serif font-bold text-[#5C1D24]">
                    {item.count}
                  </span>
                </div>
                <p className="text-xs font-semibold text-[#2A1D1A] leading-snug">
                  {item.sentence}
                </p>
              </div>

              <div className="mt-2 pt-2 border-t border-[#EAE4DC] flex items-center justify-between text-[10px] text-[#988B86]">
                <span className="font-mono">{item.code}</span>
                <span>Fix: {item.fixOwner}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
