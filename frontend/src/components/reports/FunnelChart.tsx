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

interface FunnelChartProps {
  eligibleCustomers: number;
  totalEnrollments: number;
  accepted: number;
  delivered: number;
  read: number;
  goalsCompleted: number;
}

export const FunnelChart: React.FC<FunnelChartProps> = ({
  eligibleCustomers,
  totalEnrollments,
  accepted,
  delivered,
  read,
  goalsCompleted
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const chartData = [
    {
      stage: 'Eligible Audience',
      count: eligibleCustomers,
      fill: '#6B5E59',
      description: 'Active patrons opted into marketing'
    },
    {
      stage: 'Enrolled Patrons',
      count: totalEnrollments,
      fill: '#5C1D24',
      description: 'Occasion-matched campaign journeys'
    },
    {
      stage: 'Accepted (API)',
      count: accepted,
      fill: '#C99726',
      description: 'Acknowledged by WhatsApp provider'
    },
    {
      stage: 'Delivered (Device)',
      count: delivered,
      fill: '#1B7A43',
      description: 'Verified double-check delivery receipts'
    },
    {
      stage: 'Read Receipts',
      count: read,
      fill: '#0F766E',
      description: 'Confirmed blue-tick reads where enabled'
    },
    {
      stage: 'Goals Converted',
      count: goalsCompleted,
      fill: '#8F6910',
      description: 'Attributed occasion purchase completions'
    }
  ];

  return (
    <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#EAE4DC]">
        <div>
          <h2 className="font-serif text-base font-bold text-[#431217]">
            Campaign Execution &amp; Engagement Funnel
          </h2>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Verified step dispatch receipts, device delivery, and goal conversions.
          </p>
        </div>
        <div className="text-[11px] font-semibold text-[#8F6910] bg-[#FEF9EE] px-2.5 py-1 rounded-md border border-[#F3E0B5]">
          Separate Non-Imputed Counts
        </div>
      </div>

      {/* Accessible Text Alternative for Assistive Technology & WCAG AA */}
      <div className="sr-only">
        <table summary="Campaign lifecycle conversion funnel counts from eligible audience to goal completion">
          <caption>Lifecycle Engagement Funnel Metrics</caption>
          <thead>
            <tr>
              <th scope="col">Funnel Stage</th>
              <th scope="col">Count</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((row) => (
              <tr key={row.stage}>
                <th scope="row">{row.stage}</th>
                <td>{row.count}</td>
                <td>{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recharts Visual Bar Chart */}
      <div className="h-72 w-full pt-2">
        {isMounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 10, bottom: 25 }}
              aria-label="Campaign engagement funnel bar chart"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3EFE8" />
              <XAxis
                dataKey="stage"
                tick={{ fill: '#6B5E59', fontSize: 11 }}
                axisLine={{ stroke: '#EAE4DC' }}
                tickLine={false}
                interval={0}
                angle={-15}
                textAnchor="end"
              />
              <YAxis
                tick={{ fill: '#6B5E59', fontSize: 11 }}
                axisLine={{ stroke: '#EAE4DC' }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border border-[#EAE4DC] p-2.5 rounded-lg shadow-md text-xs space-y-1">
                        <div className="font-bold text-[#431217]">{data.stage}</div>
                        <div className="text-sm font-serif font-bold text-[#5C1D24]">
                          {data.count.toLocaleString('en-IN')} patrons
                        </div>
                        <div className="text-[10px] text-[#988B86]">{data.description}</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={38}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full bg-[#FAF8F5] rounded-xl animate-pulse" />
        )}
      </div>

      {/* Accessible Key Takeaways Table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2">
        {chartData.map((stage) => (
          <div
            key={stage.stage}
            className="p-2.5 rounded-xl border border-[#EAE4DC] bg-[#FAF8F5] text-center"
          >
            <div className="text-[10px] font-semibold text-[#6B5E59] truncate" title={stage.stage}>
              {stage.stage}
            </div>
            <div className="text-base font-bold font-serif text-[#2A1D1A] mt-0.5">
              {stage.count.toLocaleString('en-IN')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
