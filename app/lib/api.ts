"use client";

import { clearSession, getApiToken, getToken, isTokenExpired } from "./auth";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ApiOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
};

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, signal, auth = true } = opts;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    // Short-circuit if the local token is already known to be expired — no
    // point firing a request that will round-trip just to come back 401.
    if (isTokenExpired()) {
      clearSession();
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        window.location.href = "/";
      }
      throw new ApiError("Session expired. Please sign in again.", 401);
    }
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  // DEBUG RESPONSE
  console.log("API RESPONSE:", {
    url: path,
    status: res.status,
    payload,
  });
  if (!res.ok) {
    if (res.status === 401 && auth) {
      // Token rejected or expired — drop the session and bounce the user back
      // to the login page. Guarded so we don't loop on the login page itself.
      clearSession();
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
    const message =
      (payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : null) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

export type LoginResponse = {
  status: string;
  token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: number;
    email: string;
    name: string;
    isAdmin: string;
  };
  // apiserver2-format tokens for calling /apiserver2/* endpoints.
  apiToken: string;
  apiTokenRefresh: string;
};

export type RecapBucket = {
  period: string;
  total: number;
  newContact: number;
  pendingContact: number;
  updatedContact: number;
  existingContact: number;
};

export type RecapTotals = {
  total: number;
  newContact: number;
  pendingContact: number;
  updatedContact: number;
  existingContact: number;
};

export type RecapResponse = {
  status: string;
  period: string;
  from: string;
  to: string;
  totals: RecapTotals;
  data: RecapBucket[];
};

export type WebhookItem = {
  id: number | string;
  list_id?: number | string | null;
  mobile?: string | null;
  fingerPrint?: string | null;
  hasTaken?: string | null;
  dateAddedGMT?: string | null;
  parameter?: string | null;
  [key: string]: unknown;
};

export type WebhookListResponse = {
  status: string;
  total: number;
  limit: number | null;
  offset: number;
  page: number;
  total_pages: number;
  has_next: boolean;
  period: string | null;
  from: string;
  to: string;
  search: string | null;
  data: WebhookItem[];
};

export function login(email: string, password: string) {
  return apiFetch<LoginResponse>("/adminapi/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}

export function fetchRecap(
  period: "hour" | "day" | "week" | "month",
  from?: string,
  to?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ period });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiFetch<RecapResponse>(`/adminapi/webhookArchiveRecap?${params.toString()}`, {
    signal,
  });
}

export type MessageQueueBucket = {
  period: string;
  total: number;
  inQueue: number;
  filtered: number;
  sent: number;
  failed: number;
  paused: number;
  softBounced: number;
  hardBounced: number;
  pending: number;
  prepare: number;
  stopped: number;
  notSending: number;
};

export type MessageQueueTotals = Omit<MessageQueueBucket, "period">;

export type MessageQueueRecapResponse = {
  status: string;
  period: string;
  from: string;
  to: string;
  totals: MessageQueueTotals;
  data: MessageQueueBucket[];
};

export function fetchMessageQueueRecap(
  from?: string,
  to?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiFetch<MessageQueueRecapResponse>(
    `/adminapi/messageQueueRecap${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

export type MessageQueueTodayResponse = {
  status: string;
  from: string;
  to: string;
  totals: MessageQueueTotals;
  data: MessageQueueBucket[];
};

export function fetchMessageQueueToday(signal?: AbortSignal) {
  return apiFetch<MessageQueueTodayResponse>(`/adminapi/messageQueueTodayRecap`, {
    signal,
  });
}

export type UserRow = {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  last_login: string | null;
  dateJoin: string | null;
  active: string | null;
  isAdmin: string | null;
};

export type UserListResponse = {
  status: string;
  total: number;
  limit: number;
  offset: number;
  page: number;
  total_pages: number;
  has_next: boolean;
  search: string | null;
  data: UserRow[];
};

export type FetchUserListArgs = {
  search?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export function fetchUserList({
  search,
  limit = 50,
  offset = 0,
  signal,
}: FetchUserListArgs = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (search) params.set("search", search);
  return apiFetch<UserListResponse>(`/adminapi/listUsers?${params.toString()}`, {
    signal,
  });
}

// apiserver2/loginAsUser response (string status + the two JWTs the target user
// needs to be considered logged in on staging.sequencer.app).
export type LoginAsUserResponse = {
  status: string;
  token: string;
  tokenRefresh: string;
};

// Calls apiserver2.loginAsUser_post directly. This is intentionally NOT routed
// through apiFetch because it uses a different JWT (the apiserver2 one stored
// during admin login) — not the admin JWT that apiFetch attaches automatically.
export async function fetchLoginAsUser(
  userId: number,
  signal?: AbortSignal,
): Promise<LoginAsUserResponse> {
  const apiToken = getApiToken();
  if (!apiToken) {
    throw new ApiError("Missing apiserver2 token — please sign in again.", 401);
  }
  const res = await fetch("/apiserver2/loginAsUser", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ userId }),
    signal,
    cache: "no-store",
  });
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : null) || `loginAsUser failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  // apiserver2 returns 200 with body { status: "error", message: ... } on auth
  // failures, so check the status field explicitly.
  const p = payload as Partial<LoginAsUserResponse> & { message?: string };
  if (p?.status !== "success" || !p.token || !p.tokenRefresh) {
    throw new ApiError(p?.message || "loginAsUser did not return a token.", 401);
  }
  return p as LoginAsUserResponse;
}

export type MessageQueueCategory =
  | "total"
  | "inQueue"
  | "filtered"
  | "sent"
  | "failed"
  | "paused"
  | "softBounced"
  | "hardBounced"
  | "pending"
  | "prepare"
  | "stopped"
  | "notSending";

export type MessageQueueDetailRow = {
  id: number;
  email: string | null;
  scheduleGMT: string | null;
  mobile: string | null;
  firstname: string | null;
  lastname: string | null;
  sequenceName: string | null;
  keyword: string | null;
  message: string;
  sent: string | null;
  active: string | null;
};

export type MessageQueueListResponse = {
  status: string;
  total: number;
  limit: number;
  offset: number;
  page: number;
  total_pages: number;
  has_next: boolean;
  from: string;
  to: string;
  category: MessageQueueCategory;
  search: string | null;
  data: MessageQueueDetailRow[];
};

export type FetchMessageQueueListArgs = {
  from: string;
  to: string;
  category?: MessageQueueCategory;
  search?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export function fetchMessageQueueList({
  from,
  to,
  category = "total",
  search,
  limit = 50,
  offset = 0,
  signal,
}: FetchMessageQueueListArgs) {
  const params = new URLSearchParams({
    from,
    to,
    category,
    limit: String(limit),
    offset: String(offset),
  });
  if (search) params.set("search", search);
  return apiFetch<MessageQueueListResponse>(
    `/adminapi/messageQueueList?${params.toString()}`,
    { signal },
  );
}

export type FetchWebhookListArgs = {
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export function fetchWebhookList({
  from,
  to,
  search,
  limit = 20,
  offset = 0,
  signal,
}: FetchWebhookListArgs) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (search) params.set("search", search);
  return apiFetch<WebhookListResponse>(
    `/adminapi/webhookArchiveList?${params.toString()}`,
    { signal },
  );
}
