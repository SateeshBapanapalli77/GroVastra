'use client';

import React from 'react';
import { Users, Calendar, Tag, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

export const CustomersView: React.FC = () => {
  const patrons = [
    {
      id: 'cus_lakshmi_01',
      name: 'Lakshmi Devi',
      phone: '+91 98765 43210',
      birthday: '28 October',
      anniversary: '15 December',
      optedIn: true,
      weaves: ['Kanjeevaram', 'Silk'],
      tags: ['VIP', 'Bridal']
    },
    {
      id: 'cus_ananya_02',
      name: 'Ananya Rao',
      phone: '+91 98765 43211',
      birthday: '21 October',
      anniversary: '10 May',
      optedIn: true,
      weaves: ['Banarasi', 'Chanderi'],
      tags: ['Occasionwear']
    },
    {
      id: 'cus_meera_03',
      name: 'Meera Sundaram',
      phone: '+91 98765 43212',
      birthday: '05 November',
      anniversary: '25 October',
      optedIn: true,
      weaves: ['Silk', 'Tussar'],
      tags: ['Repeat Client']
    },
    {
      id: 'cus_pooja_04',
      name: 'Pooja Sharma',
      phone: '+91 98765 43213',
      birthday: '28 October',
      anniversary: 'None recorded',
      optedIn: false,
      weaves: ['Kanjeevaram'],
      tags: ['Opted Out (Protected)']
    }
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="border-b border-[#EAE4DC] pb-5">
        <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
          Boutique Client Base
        </div>
        <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
          Patrons &amp; Occasion Registry
        </h1>
        <p className="text-xs text-[#6B5E59] mt-0.5">
          Actual registered customers used by the auto campaign discovery planner to evaluate eligibility
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#EAE4DC] shadow-xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#FAF8F5] border-b border-[#EAE4DC] text-[#6B5E59] uppercase font-bold text-[10px]">
            <tr>
              <th className="p-4">Customer Name</th>
              <th className="p-4">Upcoming Birthday</th>
              <th className="p-4">Anniversary</th>
              <th className="p-4">Weave Preferences</th>
              <th className="p-4">Marketing Consent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#FAF8F5]">
            {patrons.map((p) => (
              <tr key={p.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                <td className="p-4">
                  <div className="font-bold text-[#271E1B]">{p.name}</div>
                  <div className="text-[10px] text-[#988B86]">{p.phone}</div>
                </td>
                <td className="p-4 font-medium text-[#431217]">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#C99726]" />
                    <span>{p.birthday}</span>
                  </div>
                </td>
                <td className="p-4 text-[#6B5E59]">{p.anniversary}</td>
                <td className="p-4">
                  <div className="flex flex-wrap gap-1">
                    {p.weaves.map((w) => (
                      <span
                        key={w}
                        className="px-2 py-0.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded text-[10px] text-[#5C1D24] font-medium"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-4">
                  {p.optedIn ? (
                    <span className="inline-flex items-center gap-1 bg-[#E8F8EE] text-[#1B7A43] font-bold px-2 py-0.5 rounded-full text-[10px]">
                      <CheckCircle2 className="w-3 h-3 text-[#25D366]" /> Opted In
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-[#FAF8F5] text-[#5C1D24] font-bold px-2 py-0.5 rounded-full text-[10px] border border-[#F0DADC]">
                      <XCircle className="w-3 h-3 text-[#5C1D24]" /> Suppressed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
