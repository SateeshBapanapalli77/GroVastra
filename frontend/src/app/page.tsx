'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthToken } from '../lib/auth';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      router.replace('/campaigns');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[#5C1D24] text-[#F3E0B5] flex items-center justify-center font-serif font-bold text-sm animate-pulse">
          G
        </div>
        <p className="text-xs text-[#6B5E59] font-serif">Directing to boutique campaigns...</p>
      </div>
    </div>
  );
}
