'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ApiError, ConflictError, UnauthorizedError, ForbiddenError } from '../../lib/api';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof UnauthorizedError) {
              // 401 already redirects via auth handler
              return;
            }
            if (error instanceof ForbiddenError) {
              toast.error('Permission Denied', {
                description: error.message || 'You do not have access to perform this operation.'
              });
              return;
            }
            if (error instanceof ConflictError) {
              toast.error('Version Conflict', {
                description: error.message || 'Another user updated this record. Please reload.'
              });
              return;
            }
            if (error instanceof ApiError) {
              toast.error('API Error', {
                description: error.message
              });
              return;
            }
            toast.error('Unexpected Error', {
              description: (error as Error)?.message || 'Something went wrong.'
            });
          }
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (error instanceof UnauthorizedError) return;
            if (error instanceof ConflictError) {
              toast.error('Version Conflict (409)', {
                description: 'Record was updated by another user or session. Please reload the latest data.'
              });
              return;
            }
            if (error instanceof ForbiddenError) {
              toast.error('Forbidden', {
                description: 'Your current role does not permit this action.'
              });
              return;
            }
            if (error instanceof ApiError) {
              toast.error(error.code || 'Action Failed', {
                description: error.message
              });
              return;
            }
            toast.error('Operation Failed', {
              description: (error as Error)?.message || 'Unable to complete action.'
            });
          }
        }),
        defaultOptions: {
          queries: {
            staleTime: 1000 * 30, // 30 seconds
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (
                error instanceof UnauthorizedError ||
                error instanceof ForbiddenError ||
                error instanceof ConflictError ||
                (error instanceof ApiError && error.status === 404)
              ) {
                return false;
              }
              return failureCount < 2;
            }
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: '#FAF8F5',
            border: '1px solid #EAE4DC',
            color: '#2A1D1A',
            fontFamily: 'var(--font-sans)'
          }
        }}
      />
    </QueryClientProvider>
  );
}
