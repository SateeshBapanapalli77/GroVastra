import { z } from 'zod';
import { getAuthToken, handleUnauthorized } from './auth';
import {
  LoginResponseSchema,
  MeResponseSchema,
  IntegrationReadinessSchema,
  TenantSettingsResponseSchema,
  CampaignsListResponseSchema,
  CampaignDetailResponseSchema,
  CampaignActivityResponseSchema,
  CampaignActivityItemSchema,
  OwnerOverviewReportResponseSchema,
  ApprovedTemplateCatalogueResponseSchema,
  CampaignPresetsResponseSchema,
  CustomersResponseSchema,
  DryRunResponseSchema,
  MonitoringAlertsResponseSchema,
  CampaignEnrollmentsResponseSchema,
  CampaignHistoryResponseSchema,
  CustomerTimelineResponseSchema,
  ErrorResponseSchema
} from './schemas';

export * from './auth';
export type ActivityItem = z.infer<typeof CampaignActivityItemSchema>;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

// Custom Error Classes (Phase 0, Non-negotiable 3 & Item 4)
export class ApiError extends Error {
  status: number;
  code: string;
  fieldPath?: string;
  data?: any;

  constructor(message: string, status: number, code: string, fieldPath?: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldPath = fieldPath;
    this.data = data;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED', data?: any) {
    super(message, 401, code, undefined, data);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden for current role', code = 'FORBIDDEN_ROLE', data?: any) {
    super(message, 403, code, undefined, data);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND', data?: any) {
    super(message, 404, code, undefined, data);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  currentVersion?: number;

  constructor(
    message = 'Concurrent modification conflict detected. Please reload latest.',
    code = 'CONFLICT_DETECTED',
    currentVersion?: number,
    data?: any
  ) {
    super(message, 409, code, 'expectedVersion', data);
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation failed', code = 'INVALID_REQUEST', fieldPath?: string, data?: any) {
    super(message, 422, code, fieldPath, data);
    this.name = 'ValidationError';
  }
}

/**
 * Generates a stable Idempotency-Key for a specific user intent.
 * Reuse this key on retry so the backend safely deduplicates requests.
 */
export function generateIdempotencyKey(intent = 'intent'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `idemp_${intent}_${timestamp}_${random}`;
}

export interface ApiRequestOptions extends RequestInit {
  idempotencyKey?: string;
  expectedVersion?: number;
}

/**
 * Universal HTTP request wrapper parsing through Zod boundary schemas
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
  schema?: z.ZodType<T>
): Promise<T> {
  const token = getAuthToken();
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

  const existingHeaders = (options.headers as Record<string, string>) || {};

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...existingHeaders
  };

  // Attach idempotency key to all mutations if provided or generated
  if (isMutation) {
    const key =
      options.idempotencyKey ||
      existingHeaders['Idempotency-Key'] ||
      existingHeaders['idempotency-key'] ||
      generateIdempotencyKey(endpoint.replace(/[^a-zA-Z0-9]/g, '_'));
    headers['Idempotency-Key'] = key;
  }

  // Handle expectedVersion in body or header if requested
  let body = options.body;
  if (options.expectedVersion !== undefined && isMutation && typeof body === 'string') {
    try {
      const parsedBody = JSON.parse(body);
      if (typeof parsedBody === 'object' && parsedBody !== null) {
        parsedBody.expectedVersion = options.expectedVersion;
        body = JSON.stringify(parsedBody);
      }
    } catch {
      // Body not JSON
    }
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    body
  });

  let rawJson: any;
  try {
    rawJson = await response.json();
  } catch {
    rawJson = null;
  }

  if (!response.ok) {
    const errorParsed = ErrorResponseSchema.safeParse(rawJson);
    const errorMessage = errorParsed.success ? errorParsed.data.error : rawJson?.error || `Request failed (${response.status})`;
    const errorCode = errorParsed.success ? errorParsed.data.code : rawJson?.code || 'API_ERROR';
    const fieldPath = errorParsed.success ? errorParsed.data.fieldPath : rawJson?.fieldPath;

    if (response.status === 401) {
      handleUnauthorized();
      throw new UnauthorizedError(errorMessage, errorCode, rawJson);
    }
    if (response.status === 403) {
      throw new ForbiddenError(errorMessage, errorCode, rawJson);
    }
    if (response.status === 404) {
      throw new NotFoundError(errorMessage, errorCode, rawJson);
    }
    if (response.status === 409) {
      const currentVersion = rawJson?.currentVersion;
      throw new ConflictError(errorMessage, errorCode, currentVersion, rawJson);
    }
    if (response.status === 400 || response.status === 422) {
      throw new ValidationError(errorMessage, errorCode, fieldPath, rawJson);
    }

    throw new ApiError(errorMessage, response.status, errorCode, fieldPath, rawJson);
  }

  if (schema) {
    const parseResult = schema.safeParse(rawJson);
    if (!parseResult.success) {
      console.error(`Boundary validation error for ${endpoint}:`, parseResult.error);
      throw new ApiError(
        `Response schema validation failed for ${endpoint}`,
        500,
        'RESPONSE_PARSE_ERROR',
        undefined,
        parseResult.error
      );
    }
    return parseResult.data;
  }

  return rawJson as T;
}

/**
 * Concrete Typed API Service Methods
 */
export const api = {
  // Auth
  login: async (username: string, password: string) => {
    return apiRequest(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password })
      },
      LoginResponseSchema
    );
  },

  getCurrentUser: async () => {
    return apiRequest('/auth/me', { method: 'GET' }, MeResponseSchema);
  },

  // Integration Readiness
  getIntegrationReadiness: async () => {
    return apiRequest('/integration-readiness', { method: 'GET' }, IntegrationReadinessSchema);
  },

  // Tenant Campaign Settings
  getCampaignSettings: async () => {
    return apiRequest('/campaign-settings', { method: 'GET' }, TenantSettingsResponseSchema);
  },

  updateCampaignSettings: async (settings: any, expectedVersion: number, idempotencyKey?: string) => {
    return apiRequest(
      '/campaign-settings',
      {
        method: 'PATCH',
        idempotencyKey,
        expectedVersion,
        body: JSON.stringify({ ...settings, expectedVersion })
      },
      TenantSettingsResponseSchema
    );
  },

  // Campaigns
  getCampaigns: async () => {
    return apiRequest('/campaigns', { method: 'GET' }, CampaignsListResponseSchema);
  },

  getCampaignDetail: async (id: string) => {
    return apiRequest(`/campaigns/${id}`, { method: 'GET' }, CampaignDetailResponseSchema);
  },

  createCampaign: async (presetId?: string, name?: string, idempotencyKey?: string) => {
    return apiRequest<{ success: boolean; campaign: any; draftVersion: any }>(
      '/campaigns',
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ presetId, name })
      }
    );
  },

  validateCampaign: async (id: string, expectedVersion?: number, idempotencyKey?: string) => {
    return apiRequest<{
      success: boolean;
      valid: boolean;
      errors: Array<{ fieldPath: string; message: string; resolutionOwner: string }>;
      warnings: Array<{ fieldPath: string; message: string; resolutionOwner: string }>;
      campaign: any;
      versionId: string;
      draftVersion: number;
      reviewFingerprint: string | null;
      validatedSteps: number;
    }>(
      `/campaigns/${id}/validate`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify(expectedVersion !== undefined ? { expectedVersion } : {})
      }
    );
  },

  saveDraftRevision: async (
    id: string,
    draftData: any,
    expectedVersion: number,
    idempotencyKey?: string
  ) => {
    return apiRequest(
      `/campaigns/${id}/draft`,
      {
        method: 'PATCH',
        idempotencyKey,
        expectedVersion,
        body: JSON.stringify({ ...draftData, expectedVersion })
      }
    );
  },

  activateCampaign: async (
    id: string,
    reviewFingerprint: string,
    expectedVersion: number,
    idempotencyKey?: string
  ) => {
    return apiRequest<{
      success: boolean;
      campaign: any;
      activeVersion: any;
      planningResult?: any;
    }>(
      `/campaigns/${id}/activate`,
      {
        method: 'POST',
        idempotencyKey,
        expectedVersion,
        body: JSON.stringify({ reviewFingerprint, expectedVersion })
      }
    );
  },

  pauseCampaign: async (id: string, idempotencyKey?: string) => {
    return apiRequest<{ success: boolean; campaign: any }>(
      `/campaigns/${id}/pause`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({})
      }
    );
  },

  resumeCampaign: async (id: string, idempotencyKey?: string) => {
    return apiRequest<{ success: boolean; campaign: any }>(
      `/campaigns/${id}/resume`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({})
      }
    );
  },

  archiveCampaign: async (id: string, idempotencyKey?: string) => {
    return apiRequest<{ success: boolean; message: string; campaign: any; cancelledExecutionsCount: number }>(
      `/campaigns/${id}/archive`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({})
      }
    );
  },

  publishRevision: async (
    id: string,
    expectedVersion: number,
    reviewFingerprint: string,
    revisionData?: { steps?: any[]; trigger?: any; audience?: any; priority?: number; timezone?: string },
    idempotencyKey?: string
  ) => {
    return apiRequest<{
      success: boolean;
      message: string;
      campaign: any;
      activeVersion: any;
    }>(
      `/campaigns/${id}/publish-revision`,
      {
        method: 'POST',
        idempotencyKey,
        expectedVersion,
        body: JSON.stringify({ expectedVersion, reviewFingerprint, ...(revisionData || {}) })
      }
    );
  },

  runDryRun: async (id: string, idempotencyKey?: string) => {
    return apiRequest(
      `/campaigns/${id}/dry-runs`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({})
      },
      DryRunResponseSchema
    );
  },

  // Activity Stream & Holds
  getCampaignActivity: async () => {
    return apiRequest('/campaign-activity', { method: 'GET' }, CampaignActivityResponseSchema);
  },

  resolveHold: async (enrollmentId: string, action: 'RESUME' | 'CANCEL', notes?: string, idempotencyKey?: string) => {
    return apiRequest(
      `/enrollments/${enrollmentId}/resolve-hold`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ action, notes })
      }
    );
  },

  // Catalogue & CRM
  getPresets: async () => {
    return apiRequest('/campaign-presets', { method: 'GET' }, CampaignPresetsResponseSchema);
  },

  getApprovedTemplates: async () => {
    return apiRequest('/approved-template-catalogue', { method: 'GET' }, ApprovedTemplateCatalogueResponseSchema);
  },

  getCustomers: async () => {
    return apiRequest('/customers', { method: 'GET' }, CustomersResponseSchema);
  },

  // Reporting
  getOwnerOverviewReport: async () => {
    return apiRequest('/campaigns/reports/owner-overview', { method: 'GET' }, OwnerOverviewReportResponseSchema);
  },

  getEnrollments: async (campaignId: string, page = 1, limit = 20) => {
    return apiRequest(
      `/campaigns/${campaignId}/enrollments?page=${page}&limit=${limit}`,
      { method: 'GET' },
      CampaignEnrollmentsResponseSchema
    );
  },

  getHistory: async (campaignId: string, page = 1, limit = 20) => {
    return apiRequest(
      `/campaigns/${campaignId}/history?page=${page}&limit=${limit}`,
      { method: 'GET' },
      CampaignHistoryResponseSchema
    );
  },

  getCustomerTimeline: async (customerId: string) => {
    return apiRequest(
      `/campaigns/reports/customer-timeline/${customerId}`,
      { method: 'GET' },
      CustomerTimelineResponseSchema
    );
  },

  markGoal: async (
    enrollmentId: string,
    orderRef?: string,
    notes?: string,
    idempotencyKey?: string
  ) => {
    return apiRequest<{ success: boolean; message: string; enrollment: any }>(
      `/enrollments/${enrollmentId}/mark-goal`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({
          orderRef: orderRef || 'manual_staff_completion',
          notes: notes || undefined
        })
      }
    );
  },

  getMonitoringAlerts: async () => {
    return apiRequest('/campaigns/monitoring/alerts', { method: 'GET' }, MonitoringAlertsResponseSchema);
  },

  // Backward compatible helper aliases
  getCampaign: async (id: string) => api.getCampaignDetail(id),
  getSettings: async () => api.getCampaignSettings(),
  updateSettings: async (settings: any) =>
    api.updateCampaignSettings(settings, settings.expectedVersion || 1),
  getTemplates: async () => api.getApprovedTemplates(),
  getActivityStream: async () => api.getCampaignActivity(),
  logout: () => {
    handleUnauthorized();
  },
  updateDraft: async (id: string, data: any, expectedVersion = 1, idempotencyKey?: string) => {
    return api.saveDraftRevision(id, data, expectedVersion, idempotencyKey);
  }
};
