"use client";

const TOKEN_KEY = "sequencer.adminToken";
const USER_KEY = "sequencer.adminUser";
// Separate JWT used to call apiserver2 endpoints (e.g. loginAsUser_post). It's
// minted by adminapi.login_post alongside the admin token and uses the same
// secret/issuer as apiserver2.login_post.
const API_TOKEN_KEY = "sequencer.apiToken";
const API_REFRESH_KEY = "sequencer.apiTokenRefresh";

export type AdminUser = {
  id: number;
  email: string;
  name: string;
  isAdmin: string;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AdminUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}

export function setSession(
  token: string,
  user: AdminUser,
  apiToken?: string,
  apiTokenRefresh?: string,
) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (apiToken) window.localStorage.setItem(API_TOKEN_KEY, apiToken);
  if (apiTokenRefresh) window.localStorage.setItem(API_REFRESH_KEY, apiTokenRefresh);
}

export function getApiToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(API_TOKEN_KEY);
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(API_TOKEN_KEY);
  window.localStorage.removeItem(API_REFRESH_KEY);
}

// Decode the payload portion of an HS256 JWT (`header.payload.signature`).
// We don't verify the signature here — the backend does that on every call.
// This is only used to read the `exp` claim so the client can self-evict
// without waiting for the next 401.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Returns unix seconds (token exp claim) or null if the token has no exp.
export function getTokenExpiry(): number | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const exp = payload.exp;
  return typeof exp === "number" ? exp : null;
}

export function isTokenExpired(skewSeconds = 5): boolean {
  const exp = getTokenExpiry();
  if (exp == null) return false; // can't tell — treat as not expired
  return Date.now() / 1000 >= exp - skewSeconds;
}

export function isAuthenticated(): boolean {
  if (getToken() === null) return false;
  // A token whose exp is in the past is no longer authenticated. Drop it so
  // callers don't bother making a request that we already know will 401.
  if (isTokenExpired()) {
    clearSession();
    return false;
  }
  return true;
}
