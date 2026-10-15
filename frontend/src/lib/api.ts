const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT || 'shop_padmavati_handlooms';

let cachedToken: string | null = null;

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

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tenant-id': DEFAULT_TENANT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {})
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
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

  updateDraft: async (id: string, draftData: any): Promise<{ success: boolean; campaign: any; draftVersion: any }> => {
    return request(`/campaigns/${id}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(draftData)
    });
  },

  runDryRun: async (id: string): Promise<{ success: boolean; dryRun: { draftFingerprint: string; summary: { totalEvaluated: number; eligibleCount: number; excludedCount: number } } }> => {
    return request(`/campaigns/${id}/dry-runs`, {
      method: 'POST'
    });
  },

  activateCampaign: async (id: string, reviewFingerprint: string): Promise<{ success: boolean; campaign: any }> => {
    return request(`/campaigns/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify({ reviewFingerprint })
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
  }
};
