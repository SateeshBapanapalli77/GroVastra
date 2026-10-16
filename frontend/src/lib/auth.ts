/**
 * Single Authoritative Auth Module for GroVastra Auto Campaigns (Phase 0)
 * Handles token storage, user context, login, /auth/me synchronization, and 401 logouts.
 */

export type UserRole = 'BOUTIQUE_OWNER' | 'STORE_MANAGER' | 'STAFF' | 'SYSTEM';

export interface UserProfile {
  id: string;
  username: string;
  name?: string;
  role: UserRole;
  tenantId: string;
  shopName: string;
}

const TOKEN_KEY = 'grovastra_auth_token';
const USER_KEY = 'grovastra_auth_user';

let inMemoryToken: string | null = null;
let inMemoryUser: UserProfile | null = null;

type AuthChangeListener = (user: UserProfile | null, token: string | null) => void;
const listeners = new Set<AuthChangeListener>();

export function subscribeAuth(listener: AuthChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  const token = getAuthToken();
  const user = getStoredUser();
  listeners.forEach((listener) => {
    try {
      listener(user, token);
    } catch (err) {
      console.error('Error in auth listener:', err);
    }
  });
}

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window !== 'undefined') {
    const val = localStorage.getItem(TOKEN_KEY);
    inMemoryToken = val;
    return val;
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  notifyListeners();
}

export function getStoredUser(): UserProfile | null {
  if (inMemoryUser) return inMemoryUser;
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      try {
        inMemoryUser = JSON.parse(raw);
        return inMemoryUser;
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }
  }
  return null;
}

export function setStoredUser(user: UserProfile | null): void {
  inMemoryUser = user;
  if (typeof window !== 'undefined') {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }
  notifyListeners();
}

export function clearAuth(): void {
  inMemoryToken = null;
  inMemoryUser = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  notifyListeners();
}

export function handleUnauthorized(): void {
  clearAuth();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}
