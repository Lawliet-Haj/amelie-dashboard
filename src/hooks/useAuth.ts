import { useState, useCallback } from 'react';
import type { AuthUser } from '../types';

const STORAGE_KEY = 'amelie_dashboard_token';

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    // base64url → base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function loadStoredUser(): AuthUser | null {
  const token = localStorage.getItem(STORAGE_KEY);
  if (!token) return null;
  const p = decodePayload(token);
  if (!p) return null;
  if (typeof p.exp === 'number' && p.exp < Date.now() / 1000) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return {
    token,
    username: String(p.sub ?? ''),
    nom:      String(p.nom ?? p.sub ?? ''),
    role:     (p.role as AuthUser['role']) ?? 'conseillere',
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());

  const login = useCallback((token: string): boolean => {
    const p = decodePayload(token);
    if (!p) return false;
    const authUser: AuthUser = {
      token,
      username: String(p.sub ?? ''),
      nom:      String(p.nom ?? p.sub ?? ''),
      role:     (p.role as AuthUser['role']) ?? 'conseillere',
    };
    localStorage.setItem(STORAGE_KEY, token);
    setUser(authUser);
    return true;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return { user, login, logout };
}
