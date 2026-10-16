'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { Lock, User, AlertCircle, Sparkles } from 'lucide-react';

const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

type LoginFormData = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const { loginSuccess } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginFormData>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      username: '',
      password: ''
    }
  });

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);
    try {
      const res = await api.login(data.username, data.password);
      if (res.token && res.user) {
        loginSuccess(res.token, res.user);
      } else {
        setServerError('Authentication failed. No token received.');
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setServerError(err.message || 'Invalid username or password');
      } else {
        setServerError(err?.message || 'Unable to connect to authentication service');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex flex-col justify-center items-center p-4">
      {/* Brand Header */}
      <div className="w-full max-w-md text-center mb-8">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-[#5C1D24] text-[#F3E0B5] items-center justify-center font-serif text-2xl font-bold mb-3 shadow-md border border-[#C99726]/40">
          G
        </div>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-[#431217]">
          GroVastra Auto Campaigns
        </h1>
        <p className="text-xs text-[#8F6910] mt-1 font-sans tracking-wide uppercase font-semibold">
          Handloom Boutique Operating System
        </p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md bg-white border border-[#EAE4DC] rounded-2xl p-8 shadow-sm">
        <div className="mb-6">
          <h2 className="font-serif text-lg font-bold text-[#2A1D1A]">Boutique Sign In</h2>
          <p className="text-xs text-[#6B5E59] mt-0.5">
            Enter your credentials to manage boutique campaigns and customer communication.
          </p>
        </div>

        {serverError && (
          <div className="mb-5 p-3 rounded-xl bg-[#FDF2F2] border border-[#F8D7DA] text-xs text-[#9E2A2B] flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-semibold text-[#2A1D1A] mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#988B86] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                {...register('username')}
                id="username"
                type="text"
                autoComplete="username"
                placeholder="e.g. owner_padmavati"
                className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-[#FAF8F5] focus:bg-white transition-colors outline-hidden ${
                  errors.username
                    ? 'border-[#9E2A2B] focus:ring-1 focus:ring-[#9E2A2B]'
                    : 'border-[#EAE4DC] focus:border-[#5C1D24] focus:ring-1 focus:ring-[#5C1D24]'
                }`}
              />
            </div>
            {errors.username && (
              <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.username.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-[#2A1D1A] mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#988B86] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                {...register('password')}
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-[#FAF8F5] focus:bg-white transition-colors outline-hidden ${
                  errors.password
                    ? 'border-[#9E2A2B] focus:ring-1 focus:ring-[#9E2A2B]'
                    : 'border-[#EAE4DC] focus:border-[#5C1D24] focus:ring-1 focus:ring-[#5C1D24]'
                }`}
              />
            </div>
            {errors.password && (
              <p className="text-[11px] text-[#9E2A2B] mt-1">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[#5C1D24] text-white hover:bg-[#73232C] active:bg-[#431217] text-xs font-semibold tracking-wide transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#F3E0B5]" />
                <span>Enter Boutique OS</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#F3EFE8] text-center">
          <p className="text-[11px] text-[#988B86]">
            Tenant authorization strictly enforced per boutique workspace.
          </p>
        </div>
      </div>
    </div>
  );
}
