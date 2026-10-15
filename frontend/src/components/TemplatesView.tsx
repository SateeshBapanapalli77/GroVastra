'use client';

import React from 'react';
import { FileText, CheckCircle2, Lock, Tag } from 'lucide-react';

import { api } from '../lib/api';

export const TemplatesView: React.FC = () => {
  const [templates, setTemplates] = React.useState<any[]>([
    {
      id: 'tpl_birthday_invite',
      name: 'Birthday Boutique Invitation',
      category: 'MARKETING',
      revision: 3,
      body: 'Dear {{name}}, celebrate your special month with us at {{shop}}! Enjoy an exclusive birthday treat on our handcrafted silk collection.',
      variables: ['name', 'shop']
    },
    {
      id: 'tpl_birthday_followup',
      name: 'Birthday Reminder',
      category: 'MARKETING',
      revision: 1,
      body: 'Hi {{name}}, just a reminder that your birthday boutique gift voucher is waiting for you this week.',
      variables: ['name']
    },
    {
      id: 'tpl_birthday_greeting',
      name: 'Birthday Day-of Greeting',
      category: 'MARKETING',
      revision: 1,
      body: 'Wishing you a very Happy Birthday, {{name}}! May your year be filled with elegance and joy.',
      variables: ['name']
    },
    {
      id: 'tpl_anniversary_invite',
      name: 'Anniversary Celebration',
      category: 'MARKETING',
      revision: 2,
      body: 'Dear {{name}}, Happy Anniversary! To make your celebration memorable, enjoy a personalized styling session and private preview at {{shop}}.',
      variables: ['name', 'shop']
    }
  ]);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await api.getTemplates();
        if (res && res.templates && res.templates.length > 0) {
          const mapped = res.templates.map((t: any) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            revision: t.revision,
            body: t.body,
            variables: t.variableSchema || []
          }));
          setTemplates(mapped);
        }
      } catch (err: any) {
        console.warn('Using seeded template fallback', err.message);
      }
    }
    load();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="border-b border-[#EAE4DC] pb-5">
        <div className="text-[10px] tracking-widest uppercase font-bold text-[#988B86]">
          Meta Approved Catalog
        </div>
        <h1 className="font-serif text-3xl font-bold text-[#431217] mt-0.5">
          Approved WhatsApp Templates (Read-Only)
        </h1>
        <p className="text-xs text-[#6B5E59] mt-0.5">
          Authoritative templates available for autonomous campaign steps. Custom free-text is prohibited by Meta policies.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="p-5 bg-white rounded-2xl border border-[#EAE4DC] shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#5C1D24]" />
                <span className="font-bold text-xs text-[#271E1B]">{tpl.name}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] bg-[#E8F8EE] text-[#1B7A43] font-bold px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3 text-[#25D366]" /> Approved (Rev {tpl.revision})
              </span>
            </div>

            <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#EAE4DC] text-xs font-mono text-[#431217] leading-relaxed">
              {tpl.body}
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#6B5E59] pt-1">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-[#988B86]" />
                <span>Variables: {tpl.variables.map((v: string) => `{{${v}}}`).join(', ')}</span>
              </div>
              <span className="text-[10px] text-[#988B86] uppercase font-bold">
                {tpl.category}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
