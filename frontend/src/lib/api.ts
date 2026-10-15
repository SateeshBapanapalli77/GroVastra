const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

let cachedToken: string | null = null;
let cachedUser: UserProfile | null = null;

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  role: 'BOUTIQUE_OWNER' | 'STORE_MANAGER' | 'STAFF' | 'SYSTEM';
  tenantId: string;
  shopName: string;
}

export function setAuthToken(token: string) {
  cachedToken = token;
  if (typeof window !== 'undefined') {
    localStorage.setItem('grovastra_auth_token', token);
  }
}

export function getAuthToken(): string | null {
  if (cachedToken) return cachedToken;
  if (typeof window !== 'undefined') {
    return localStorage.getItem('grovastra_auth_token');
  }
  return null;
}

export function setStoredUser(user: UserProfile) {
  cachedUser = user;
  if (typeof window !== 'undefined') {
    localStorage.setItem('grovastra_auth_user', JSON.stringify(user));
  }
}

export function getStoredUser(): UserProfile | null {
  if (cachedUser) return cachedUser;
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem('grovastra_auth_user');
    if (raw) {
      try {
        cachedUser = JSON.parse(raw);
        return cachedUser;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearAuth() {
  cachedToken = null;
  cachedUser = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('grovastra_auth_token');
    localStorage.removeItem('grovastra_auth_user');
  }
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

  const existingHeaders = (options.headers as Record<string, string>) || {};
  const hasIdempotency = Boolean(
    existingHeaders['Idempotency-Key'] ||
    existingHeaders['idempotency-key'] ||
    existingHeaders['x-idempotency-key']
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isMutation && !hasIdempotency
      ? { 'Idempotency-Key': `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` }
      : {}),
    ...existingHeaders
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await res.json();
  if (!res.ok) {
    const error: any = new Error(data.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.statusCode = res.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

export interface CampaignSummary {
  id: string;
  name: string;
  industry: string;
  purpose: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  activeVersionId: string | null;
  draftVersion: number;
  pauseGeneration: number;
  enrolledCount?: number;
  activeVersion?: any;
}

export interface ActivityItem {
  id: string;
  campaignName: string;
  stepId: string;
  customerId: string;
  occurrenceId: string;
  state: 'SCHEDULED' | 'PROVIDER_ACCEPTED' | 'SKIPPED' | 'DEFERRED' | 'HELD';
  outcomeReason?: string;
  explanation: string;
  dueAt?: string;
  updatedAt?: string;
  timestamp?: string;
  enrollmentId: string;
  replyHoldAt?: string | null;
  goalReachedAt?: string | null;
}

export const api = {
  // Authentication
  login: async (username: string, password: string): Promise<{ success: boolean; token: string; user: UserProfile }> => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (res.token) {
      setAuthToken(res.token);
      setStoredUser(res.user);
    }
    return res;
  },

  getMe: async (): Promise<{ success: boolean; user: UserProfile }> => {
    const res = await request('/auth/me');
    if (res.user) {
      setStoredUser(res.user);
    }
    return res;
  },

  logout: () => {
    clearAuth();
  },

  // Campaigns
  getCampaigns: async (): Promise<{ success: boolean; campaigns: CampaignSummary[] }> => {
    return request('/campaigns');
  },

  getCampaign: async (id: string): Promise<any> => {
    return request(`/campaigns/${id}`);
  },

  createCampaign: async (presetId: string, name?: string): Promise<{ success: boolean; campaign: { id: string; name: string } }> => {
    return request('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ presetId, name })
    });
  },

  updateDraft: async (id: string, draftData: any, expectedVersion?: number): Promise<{ success: boolean; campaign: any; draftVersion: any }> => {
    return request(`/campaigns/${id}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(expectedVersion !== undefined ? { ...draftData, expectedVersion } : draftData)
    });
  },

  runDryRun: async (id: string): Promise<{ success: boolean; dryRun: { draftFingerprint: string; summary: { totalEvaluated: number; eligibleCount: number; excludedCount: number } } }> => {
    return request(`/campaigns/${id}/dry-runs`, {
      method: 'POST'
    });
  },

  activateCampaign: async (id: string, reviewFingerprint: string, expectedVersion: number = 1): Promise<{ success: boolean; campaign: any }> => {
    return request(`/campaigns/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify({ reviewFingerprint, expectedVersion })
    });
  },

  publishRevision: async (id: string, expectedVersion: number, reviewFingerprint: string, steps?: any[]): Promise<{ success: boolean }> => {
    return request(`/campaigns/${id}/publish-revision`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion, reviewFingerprint, steps })
    });
  },

  pauseCampaign: async (id: string): Promise<{ success: boolean }> => {
    return request(`/campaigns/${id}/pause`, {
      method: 'POST'
    });
  },

  resumeCampaign: async (id: string): Promise<{ success: boolean }> => {
    return request(`/campaigns/${id}/resume`, {
      method: 'POST'
    });
  },

  // Activity & Explainability Log
  getActivityStream: async (): Promise<{ success: boolean; activity: ActivityItem[] }> => {
    return request('/campaign-activity');
  },

  resolveHold: async (enrollmentId: string): Promise<{ success: boolean }> => {
    return request(`/enrollments/${enrollmentId}/resolve-hold`, {
      method: 'POST'
    });
  },

  markGoal: async (enrollmentId: string, orderRef?: string): Promise<{ success: boolean }> => {
    return request(`/enrollments/${enrollmentId}/mark-goal`, {
      method: 'POST',
      body: JSON.stringify({ orderRef })
    });
  },

  // CRM Patrons & Approved Templates
  getCustomers: async (): Promise<{ success: boolean; customers: any[] }> => {
    return request('/customers');
  },

  getTemplates: async (): Promise<{ success: boolean; templates: any[] }> => {
    return request('/templates');
  },

  // Tenant Settings (P2.j)
  getSettings: async (): Promise<{ success: boolean; settings: any }> => {
    return request('/campaign-settings');
  },

  updateSettings: async (settingsData: any): Promise<{ success: boolean; settings: any }> => {
    return request('/campaign-settings', {
      method: 'PATCH',
      body: JSON.stringify(settingsData)
    });
  },

  // Enrollments and History (P2.j)
  getCampaignEnrollments: async (campaignId: string, page: number = 1, limit: number = 50): Promise<{ success: boolean; enrollments: any[]; total: number }> => {
    return request(`/campaigns/${campaignId}/enrollments?page=${page}&limit=${limit}`);
  },

  getCampaignHistory: async (campaignId: string, page: number = 1, limit: number = 50): Promise<{ success: boolean; history: any[]; total: number }> => {
    return request(`/campaigns/${campaignId}/history?page=${page}&limit=${limit}`);
  }
};
