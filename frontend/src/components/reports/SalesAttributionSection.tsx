'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, Info } from 'lucide-react';
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

interface SalesAttributionProps {
  salesAttribution: {
    rule: string;
    attributedOrdersCount: number;
    attributedNetSalesPaise: number;
    unassignedOrdersCount: number;
    unassignedNetSalesPaise: number;
  };
}

export const SalesAttributionSection: React.FC<SalesAttributionProps> = ({
  salesAttribution
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const formatRupees = (paise = 0) => {
    const rupees = paise / 100;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(rupees);
  };

  const attributedRupees = salesAttribution.attributedNetSalesPaise / 100;
  const unassignedRupees = salesAttribution.unassignedNetSalesPaise / 100;
  const totalStoreRupees = attributedRupees + unassignedRupees;
  const attributionSharePercent =
    totalStoreRupees > 0 ? Math.round((attributedRupees / totalStoreRupees) * 100) : 0;

  const comparisonData = [
    {
      name: 'Campaign Attributed',
      orders: salesAttribution.attributedOrdersCount,
      revenueRupees: attributedRupees,
      fill: '#145C32',
      label: 'Qualifying Occasion Orders'
    },
    {
      name: 'Unassigned Store Sales',
      orders: salesAttribution.unassignedOrdersCount,
      revenueRupees: unassignedRupees,
      fill: '#6B5E59',
      label: 'Other Store Transactions'
    }
  ];

  return (
    <div className="bg-white border border-[#EAE4DC] rounded-2xl p-6 shadow-2xs space-y-6">
      {/* Title & Rule Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#EAE4DC]">
        <div>
          <h2 className="font-serif text-lg font-bold text-[#431217] flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#5C1D24]" />
            <span>Single-Attribution Net Sales &amp; Orders</span>
          </h2>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Conservative order matching under single-attribution precedence. Delivery receipts do not infer sales.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#988B86] uppercase tracking-wider font-semibold">
            Active Attribution Rule:
          </span>
          <span className="px-3 py-1 rounded-full bg-[#FEF9EE] text-[#8F6910] border border-[#F3E0B5] text-xs font-semibold">
            {salesAttribution.rule.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Accessible Text Alternative Table */}
      <div className="sr-only">
        <table summary="Single-attribution net sales comparison between campaign attributed orders and unassigned store sales">
          <caption>Sales Attribution Comparison</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Qualifying Orders</th>
              <th scope="col">Net Sales (INR)</th>
              <th scope="col">Attribution Note</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Campaign Attributed Orders</th>
              <td>{salesAttribution.attributedOrdersCount}</td>
              <td>{formatRupees(salesAttribution.attributedNetSalesPaise)}</td>
              <td>linked orders under the stated rule; refunds netted; unassigned orders shown separately</td>
            </tr>
            <tr>
              <th scope="row">Unassigned Store Sales</th>
              <td>{salesAttribution.unassignedOrdersCount}</td>
              <td>{formatRupees(salesAttribution.unassignedNetSalesPaise)}</td>
              <td>linked orders under the stated rule; refunds netted; unassigned orders shown separately</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sales Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Attributed Net Sales */}
        <div className="p-5 rounded-2xl border border-[#C3E8CB] bg-[#EBF7EE] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#145C32] uppercase tracking-wider">
              Attributed Net Sales
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#145C32] text-white">
              {attributionSharePercent}% of Store Total
            </span>
          </div>

          <div className="text-3xl font-bold font-serif text-[#145C32]">
            {formatRupees(salesAttribution.attributedNetSalesPaise)}
          </div>

          <p className="text-xs text-[#1B7A43] font-medium">
            Generated across <strong>{salesAttribution.attributedOrdersCount}</strong> verified occasion orders.
          </p>

          {/* Mandatory Attribution Note */}
          <div className="pt-2 border-t border-[#C3E8CB] text-[11px] text-[#145C32] italic">
            Note: linked orders under the stated rule; refunds netted; unassigned orders shown separately.
          </div>
        </div>

        {/* Unassigned Store Orders */}
        <div className="p-5 rounded-2xl border border-[#EAE4DC] bg-[#FAF8F5] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#6B5E59] uppercase tracking-wider">
              Unassigned Store Orders
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white border border-[#EAE4DC] text-[#6B5E59]">
              Outside Campaign Window
            </span>
          </div>

          <div className="text-3xl font-bold font-serif text-[#2A1D1A]">
            {formatRupees(salesAttribution.unassignedNetSalesPaise)}
          </div>

          <p className="text-xs text-[#6B5E59]">
            Recorded across <strong>{salesAttribution.unassignedOrdersCount}</strong> walk-in or unrelated purchases.
          </p>

          {/* Mandatory Attribution Note */}
          <div className="pt-2 border-t border-[#EAE4DC] text-[11px] text-[#6B5E59] italic">
            Note: linked orders under the stated rule; refunds netted; unassigned orders shown separately.
          </div>
        </div>
      </div>

      {/* Recharts Revenue Comparison Chart */}
      <div className="p-4 rounded-xl border border-[#EAE4DC] bg-white">
        <h3 className="font-serif text-xs font-bold text-[#2A1D1A] uppercase tracking-wider mb-2">
          Store Revenue Distribution (Net Sales in INR)
        </h3>
        <div className="h-44 w-full pt-1">
          {isMounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={comparisonData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                aria-label="Attributed versus unassigned store net sales comparison chart"
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3EFE8" />
                <XAxis
                  type="number"
                  tick={{ fill: '#6B5E59', fontSize: 11 }}
                  axisLine={{ stroke: '#EAE4DC' }}
                  tickLine={false}
                  tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#6B5E59', fontSize: 11 }}
                  axisLine={{ stroke: '#EAE4DC' }}
                  tickLine={false}
                  width={150}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white border border-[#EAE4DC] p-2.5 rounded-lg shadow-md text-xs space-y-1">
                          <div className="font-bold text-[#431217]">{data.name}</div>
                          <div className="text-sm font-serif font-bold text-[#145C32]">
                            {new Intl.NumberFormat('en-IN', {
                              style: 'currency',
                              currency: 'INR',
                              maximumFractionDigits: 0
                            }).format(data.revenueRupees)}
                          </div>
                          <div className="text-[10px] text-[#6B5E59]">
                            {data.orders} orders • {data.label}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="revenueRupees" radius={[0, 6, 6, 0]} barSize={26}>
                  {comparisonData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full bg-[#FAF8F5] rounded-xl animate-pulse" />
          )}
        </div>
      </div>

      {/* Mandatory Attribution Policy & Strict Non-Inferral Notice */}
      <div className="p-4 bg-[#FEF9EE] border border-[#F3E0B5] rounded-xl text-xs text-[#8F6910] space-y-2 leading-relaxed">
        <div className="flex items-center gap-2 font-bold text-[#5C1D24]">
          <Info className="w-4 h-4 text-[#C99726] shrink-0" />
          <span>Strict Non-Inferral Attribution Notice</span>
        </div>
        <p>
          <strong>Never infer sales from delivery: </strong>
          Delivery counts indicate that messages arrived at patron devices via WhatsApp, but do NOT imply transactions. To prevent double-counting or vanity attribution, GroVastra applies conservative single-attribution rules: orders are linked strictly if they carry a matching occasion token or occur within the verified purchase window of the latest delivered invitation. Cancelled or refunded orders are netted out to zero.
        </p>
      </div>
    </div>
  );
};
