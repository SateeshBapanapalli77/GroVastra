'use client';

import React from 'react';
import { ApprovedTemplateItem } from '../../lib/schemas';
import { CheckCheck, Phone, Video, MoreVertical, Paperclip, Smile, Mic, ShieldCheck } from 'lucide-react';

interface WhatsAppSimulatorProps {
  template?: ApprovedTemplateItem | null;
  bindings?: Record<string, string>;
  storeDisplayName?: string;
}

export function WhatsAppSimulator({
  template,
  bindings = {},
  storeDisplayName = 'Padmavati Silks'
}: WhatsAppSimulatorProps) {
  // Sample fallback dictionary for known binding sources
  const sampleValues: Record<string, string> = {
    'customer.firstName': 'Lakshmi',
    'customer.lastName': 'Devi',
    'customer.fullName': 'Lakshmi Devi',
    'shop.displayName': storeDisplayName || 'Padmavati Silks',
    'shop.name': storeDisplayName || 'Padmavati Silks',
    'store.displayName': storeDisplayName || 'Padmavati Silks',
    'shop': storeDisplayName || 'Padmavati Silks',
    'store': storeDisplayName || 'Padmavati Silks',
    'order.itemTitle': 'Kanchipuram Bridal Silk Saree',
    'product.title': 'Royal Banarasi Brocade Saree',
    'product.price': '₹24,500',
    'order.id': 'ORD-8942',
    'order.amount': '₹32,000',
    'event.date': '28 October',
    'offer.code': 'BDAY15',
    'offer': 'BDAY15'
  };

  // Replace template {{variables}} with sample values based on bound expressions
  const renderRenderedMessage = () => {
    if (!template?.bodyTemplate) {
      return 'Select an approved template from the catalogue to preview how your message will appear to patrons on WhatsApp.';
    }

    let text = template.bodyTemplate;

    // Find all {{variable}} occurrences
    const varKeys = template.variableKeys || [];
    for (const key of varKeys) {
      const boundExpr = bindings[key];
      let val = '';
      if (boundExpr) {
        if (boundExpr.startsWith('literal:')) {
          val = boundExpr.slice(8);
        } else if (sampleValues[boundExpr]) {
          val = sampleValues[boundExpr];
        } else {
          val = `[${boundExpr}]`;
        }
      } else if (key === 'name') {
        val = 'Lakshmi';
      } else if (key === 'shop' || key === 'store') {
        val = storeDisplayName || 'Padmavati Silks';
      } else if (key === 'item' || key === 'outfit') {
        val = 'Kanchipuram Silk Saree';
      } else {
        val = `{{${key}}}`;
      }

      text = text.replace(new RegExp(`{{${key}}}`, 'g'), val);
    }

    return text;
  };

  return (
    <div className="w-full max-w-sm mx-auto rounded-3xl overflow-hidden border-4 border-[#2A1D1A] shadow-xl bg-[#111B21] text-[#E9EDEF] font-sans">
      {/* Device Status Bar */}
      <div className="bg-[#1F2C34] px-4 py-1.5 flex items-center justify-between text-[11px] text-[#8696A0]">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <span>5G</span>
          <span>100%</span>
        </div>
      </div>

      {/* WhatsApp Header */}
      <div className="bg-[#202C33] px-3 py-2.5 flex items-center justify-between border-b border-[#2A3942]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#5C1D24] text-[#F3E0B5] font-serif font-bold text-xs flex items-center justify-center shrink-0 border border-[#C99726]/40">
            {storeDisplayName.charAt(0) || 'P'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-[#E9EDEF] truncate">
                {storeDisplayName}
              </span>
              <span title="Official WhatsApp Verified Business">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
              </span>
            </div>
            <p className="text-[10px] text-[#8696A0] truncate">Verified Business Account</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[#AEBAC1]">
          <Video className="w-4 h-4 opacity-70" />
          <Phone className="w-3.5 h-3.5 opacity-70" />
          <MoreVertical className="w-4 h-4 opacity-70" />
        </div>
      </div>

      {/* Chat Area */}
      <div
        className="p-3.5 min-h-[300px] flex flex-col justify-end space-y-2 relative"
        style={{
          backgroundColor: '#0B141A',
          backgroundImage:
            'radial-gradient(#182229 0.75px, transparent 0.75px), radial-gradient(#182229 0.75px, #0B141A 0.75px)',
          backgroundSize: '30px 30px',
          backgroundPosition: '0 0, 15px 15px'
        }}
      >
        {/* Date Pill */}
        <div className="self-center bg-[#182229] text-[#8696A0] text-[10px] font-medium px-2.5 py-0.5 rounded-md shadow-xs mb-2">
          TODAY
        </div>

        {/* Message Bubble */}
        <div className="self-start max-w-[90%] bg-[#202C33] text-[#E9EDEF] rounded-xl rounded-tl-xs p-3 shadow-md border border-[#2A3942]/40 relative space-y-2">
          {/* Template Category Tag */}
          {template && (
            <div className="flex items-center justify-between gap-2 border-b border-[#2A3942]/60 pb-1.5 text-[9px]">
              <span className="font-bold uppercase tracking-wider text-[#00A884]">
                {template.category}
              </span>
              <span className="text-[#8696A0]">
                Template: {template.id} (rev {template.revision})
              </span>
            </div>
          )}

          {/* Rendered Text Body */}
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-[#D1D7DB]">
            {renderRenderedMessage()}
          </p>

          {/* Timestamp & Read Checkmarks */}
          <div className="flex items-center justify-end gap-1 text-[10px] text-[#8696A0] pt-1">
            <span>10:00 AM</span>
            <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
          </div>

          {/* Interactive Button Placeholder */}
          <div className="pt-2 border-t border-[#2A3942]/60">
            <div className="w-full py-1.5 px-3 rounded-lg bg-[#111B21] text-[#00A884] text-[11px] font-semibold text-center hover:bg-[#182229] transition-colors border border-[#2A3942]">
              Explore Collection
            </div>
          </div>
        </div>
      </div>

      {/* WhatsApp Input Bar */}
      <div className="bg-[#202C33] px-3 py-2 flex items-center gap-2 border-t border-[#2A3942]">
        <Smile className="w-4 h-4 text-[#8696A0]" />
        <Paperclip className="w-4 h-4 text-[#8696A0]" />
        <div className="flex-1 bg-[#2A3942] rounded-full px-3 py-1 text-xs text-[#8696A0]">
          Type a message
        </div>
        <div className="w-7 h-7 rounded-full bg-[#00A884] flex items-center justify-center text-[#111B21]">
          <Mic className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Simulator Caption */}
      <div className="bg-[#182229] px-3 py-1.5 text-center text-[10px] text-[#8696A0] border-t border-[#222E35]">
        Meta WhatsApp Cloud API Live Preview (Sample Projection)
      </div>
    </div>
  );
}
