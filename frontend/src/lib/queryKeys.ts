/**
 * Central Query Key Factory for TanStack Query v5 (Phase 0, Item 5 & Non-negotiable 10)
 */

export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const
  },
  readiness: {
    all: ['integration-readiness'] as const
  },
  settings: {
    all: ['campaign-settings'] as const
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: () => ['campaigns', 'list'] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
    validate: (id: string) => ['campaigns', 'validate', id] as const,
    dryRun: (id: string) => ['campaigns', 'dry-run', id] as const,
    enrollments: (id: string, page = 1, limit = 20) => ['campaigns', 'detail', id, 'enrollments', { page, limit }] as const,
    history: (id: string, page = 1, limit = 20) => ['campaigns', 'detail', id, 'history', { page, limit }] as const
  },
  presets: {
    all: ['campaign-presets'] as const
  },
  templates: {
    all: ['approved-templates'] as const
  },
  activity: {
    all: ['campaign-activity'] as const
  },
  customers: {
    all: ['customers'] as const,
    timeline: (customerId: string) => ['customers', customerId, 'timeline'] as const
  },
  reports: {
    overview: ['reports', 'owner-overview'] as const,
    alerts: ['reports', 'monitoring-alerts'] as const
  }
};
