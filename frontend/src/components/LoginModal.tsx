'use client';

import React, { useState } from 'react';
import { api, UserProfile } from '../lib/api';
import { Lock, User, Sparkles, Shield, AlertCircle } from 'lucide-react';

interface LoginModalProps {
  onSuccess: (user: UserProfile) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('owner@padmavati.com');
  const [password, setPassword] = useState('HeritageOwner2026!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRole = (role: 'owner' | 'staff') => {
    if (role === 'owner') {
      setUsername('owner@padmavati.com');
      setPassword('HeritageOwner2026!');
    } else {
      setUsername('staff@padmavati.com');
      setPassword('HeritageStaff2026!');
    }
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#FAF8F5] border border-[#EAE4DC] rounded-2xl shadow-2xl max-w-md w-full p-6 text-[#271E1B]">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#5C1D24] text-[#F3E0B5] flex items-center justify-center font-serif text-2xl font-bold shadow-md mx-auto mb-3">
            G
          </div>
          <h2 className="font-serif text-xl font-bold text-[#431217]">GroVastra Boutique OS</h2>
          <p className="text-xs text-[#6B5E59] mt-1">Sign in with verified boutique credentials</p>
        </div>

        {/* Quick Role Selection Buttons for Dev/Demo */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => handleSelectRole('owner')}
            className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 ${
              username === 'owner@padmavati.com'
                ? 'bg-[#5C1D24] text-white border-[#5C1D24] shadow-xs'
                : 'bg-white text-[#431217] border-[#EAE4DC] hover:border-[#D4AF37]'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-[#F3E0B5]" />
            Owner (Full Access)
          </button>
          <button
            type="button"
            onClick={() => handleSelectRole('staff')}
            className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 ${
              username === 'staff@padmavati.com'
                ? 'bg-[#5C1D24] text-white border-[#5C1D24] shadow-xs'
                : 'bg-white text-[#431217] border-[#EAE4DC] hover:border-[#D4AF37]'
            }`}
          >
            <User className="w-3.5 h-3.5 text-[#D4AF37]" />
            Staff (Holds &amp; Activity)
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6B5E59] mb-1">Username / Email</label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-white border border-[#EAE4DC] rounded-xl px-3 py-2 text-xs text-[#271E1B] focus:outline-hidden focus:border-[#5C1D24] shadow-xs"
                placeholder="owner@padmavati.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B5E59] mb-1">Password</label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-white border border-[#EAE4DC] rounded-xl px-3 py-2 text-xs text-[#271E1B] focus:outline-hidden focus:border-[#5C1D24] shadow-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 px-4 bg-[#5C1D24] hover:bg-[#431217] text-[#F3E0B5] font-semibold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In to Boutique OS'}
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-[#EAE4DC] text-center text-[10px] text-[#988B86]">
          Multi-Tenant Isolation • Tenant derived exclusively from verified JWT
        </div>
      </div>
    </div>
  );
};
