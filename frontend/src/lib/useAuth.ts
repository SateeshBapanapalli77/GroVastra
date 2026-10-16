'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import {
  UserProfile,
  getAuthToken,
  getStoredUser,
  setStoredUser,
  setAuthToken,
  clearAuth,
  subscribeAuth
} from './auth';
import { api } from './api';
import { queryKeys } from './queryKeys';

export function useAuth(options: { requireAuth?: boolean; redirectTo?: string } = {}) {
  const { requireAuth = false, redirectTo = '/login' } = options;
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [localUser, setLocalUser] = useState<UserProfile | null>(() => getStoredUser());

  // Listen to cross-module auth changes
  useEffect(() => {
    const unsubscribe = subscribeAuth((user, tok) => {
      setLocalUser(user);
      setToken(tok);
    });
    return unsubscribe;
  }, []);

  // Fetch current user from /auth/me if token exists
  const {
    data: meData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => {
      const res = await api.getCurrentUser();
      if (res?.user) {
        setStoredUser(res.user);
      }
      return res.user;
    },
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000
  });

  const currentUser = meData || localUser;

  // Route guard
  useEffect(() => {
    if (!requireAuth) return;
    if (isLoading) return;

    if (!token || !currentUser) {
      if (pathname !== redirectTo) {
        router.push(redirectTo);
      }
    }
  }, [requireAuth, token, currentUser, isLoading, pathname, redirectTo, router]);

  const logout = () => {
    clearAuth();
    queryClient.clear();
    router.push('/login');
  };

  const loginSuccess = (authToken: string, user: UserProfile) => {
    setAuthToken(authToken);
    setStoredUser(user);
    queryClient.setQueryData(queryKeys.auth.me, user);
    router.push('/campaigns');
  };

  return {
    user: currentUser,
    token,
    isLoading: Boolean(token) && isLoading && !currentUser,
    isAuthenticated: Boolean(token && currentUser),
    logout,
    loginSuccess,
    refetchUser: refetch,
    isError,
    error
  };
}
