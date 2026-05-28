"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  UserRow,
  fetchLoginAsUser,
  fetchUserList,
} from "../../lib/api";

const PAGE_SIZE = 50;
// Where to drop the impersonation tokens. The staging frontend is expected to
// consume them from the URL query string and finalize the session client-side.
// Override via NEXT_PUBLIC_STAGING_URL in .env.local.
const STAGING_URL = process.env.NEXT_PUBLIC_STAGING_URL || "https://staging.sequencer.app";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  // Server returns UTC datetimes like "2026-05-27 18:42:11"; render as-is, no timezone math.
  return value.replace("T", " ").slice(0, 19);
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (off: number, q: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetchUserList({
        search: q || undefined,
        limit: PAGE_SIZE,
        offset: off,
        signal: ctrl.signal,
      });
      setRows(res.data || []);
      setTotal(res.total || 0);
      setOffset(res.offset || 0);
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0, "");
    return () => abortRef.current?.abort();
  }, [load]);

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAppliedQuery(query);
    load(0, query);
  }

  function goToPage(p: number) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const next = Math.max(1, Math.min(totalPages, p));
    load((next - 1) * PAGE_SIZE, appliedQuery);
  }

  async function handleEmailClick(e: React.MouseEvent<HTMLAnchorElement>, user: UserRow) {
    e.preventDefault();
    if (impersonatingId !== null) return;
    setImpersonatingId(user.id);
    try {
      // Direct call to apiserver2.loginAsUser_post — same endpoint
      // staging.sequencer.app's own login flow goes through.
      const res = await fetchLoginAsUser(user.id);
      const params = new URLSearchParams({
        token: res.token,
        tokenRefresh: res.tokenRefresh,
      });
      // Hand off to staging's /auto-login page. That page POSTs the tokens to
      // /api/login/handoff which sets the HTTP-only cookies and redirects to
      // /activity. The user gesture (click) is preserved, so popup blockers
      // won't intervene.
      window.open(`${STAGING_URL}/auto-login?${params.toString()}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start session.");
    } finally {
      setImpersonatingId(null);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-zinc-500">
            Click an email to open <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">staging.sequencer.app</code> already signed in as that user.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email or name…"
            className="h-9 w-72 rounded-md border border-zinc-300 bg-white px-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">First name</th>
              <th className="px-3 py-2.5 font-medium">Last name</th>
              <th className="px-3 py-2.5 font-medium">Last login</th>
              <th className="px-3 py-2.5 font-medium">Date joined ↓</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-zinc-400">
                  No users match.
                </td>
              </tr>
            ) : (
              rows.map((u) => {
                const isImpersonating = impersonatingId === u.id;
                // Only end users (non-admins) can be impersonated. Admins
                // render as plain text so you can't accidentally log in as
                // another admin from this list. We gate on an explicit
                // "yes" so missing/null isAdmin still allows the click —
                // the DB column defaults to "no" anyway.
                const canImpersonate = u.isAdmin !== "yes";
                return (
                  <tr key={u.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {canImpersonate ? (
                        <a
                          href={`${STAGING_URL}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => handleEmailClick(e, u)}
                          aria-disabled={isImpersonating}
                          className={`inline-flex items-center gap-1.5 font-medium text-indigo-600 underline-offset-2 hover:underline ${
                            isImpersonating ? "opacity-50" : ""
                          }`}
                        >
                          {u.email}
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 17 17 7" />
                            <path d="M7 7h10v10" />
                          </svg>
                          {isImpersonating && (
                            <span className="text-xs text-zinc-500">opening…</span>
                          )}
                        </a>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 text-zinc-700"
                          title="Admins cannot be opened in staging from here"
                        >
                          {u.email}
                          <span className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                            admin
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{u.firstName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{u.lastName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 tabular-nums">
                      {formatDateTime(u.last_login)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 tabular-nums">
                      {formatDateTime(u.dateJoin)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {u.active === "yes" ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          Inactive
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600">
        <span>
          {total > 0 ? (
            <>
              Showing {offset + 1}–{Math.min(offset + rows.length, total)} of {total.toLocaleString()}
            </>
          ) : (
            "0 users"
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            Previous
          </button>
          <span className="px-2 text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
