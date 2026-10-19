import { useState, useCallback } from 'react';
import type { AuthUser } from '../types';

// ⚠️ La clé porte une VERSION, à changer en même temps que le secret de signature des jetons
// (DASHBOARD_JWT_SECRET côté n8n). Un jeton signé avec l'ancien secret est refusé par TOUS les
// endpoints — mais ils répondent alors 200 à corps vide, pas 401 : l'écran afficherait des
// erreurs sans jamais proposer de se reconnecter. Changer la clé ignore l'ancien jeton et
// ramène chacun à l'écran de connexion. Rotation du 2026-10-19 : `amelie_dashboard_token` → `_v2`.
const STORAGE_KEY = 'amelie_dashboard_token_v2';
const ANCIENNES_CLES = ['amelie_dashboard_token'];
try { for (const k of ANCIENNES_CLES) localStorage.removeItem(k); } catch { /* stockage indisponible */ }

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
