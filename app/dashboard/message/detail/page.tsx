"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  MessageQueueCategory,
  MessageQueueDetailRow,
  fetchMessageQueueList,
} from "../../../lib/api";

const PAGE_SIZE = 50;

const CATEGORY_LABEL: Record<MessageQueueCategory, string> = {
  total: "All",
  inQueue: "In queue",
  filtered: "Filter",
  sent: "Sent",
  failed: "Fail",
  paused: "Pause",
  softBounced: "Soft bounce",
  hardBounced: "Hard bounce",
  pending: "Pending",
  prepare: "Prepare",
  stopped: "Stop",
  notSending: "Not sending",
};

function isCategory(v: string | null): v is MessageQueueCategory {
  if (!v) return false;
  return v in CATEGORY_LABEL;
}

function MessageDetailInner() {
  const search = useSearchParams();
  const from = search.get("from") || "";
  const to = search.get("to") || "";
  const categoryParam = search.get("category");
  const category: MessageQueueCategory = isCategory(categoryParam) ? categoryParam : "total";
  const label = search.get("label") || `${CATEGORY_LABEL[category]} · ${from} → ${to}`;

  const [rows, setRows] = useState<MessageQueueDetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (off: number, q: string) => {
      if (!from || !to) {
        setError("Missing date range. Open this page from the table view.");
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetchMessageQueueList({
          from,
          to,
          category,
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
        setError(err instanceof ApiError ? err.message : "Failed to load detail.");
      } finally {
        setLoading(false);
      }
    },
    [from, to, category],
  );

  useEffect(() => {
    load(0, "");
    return () => abortRef.current?.abort();
  }, [load]);

  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAppliedQuery(query);
    load(0, query);
  }

  function goToPage(p: number) {
    const next = Math.max(1, Math.min(totalPages, p));
    load((next - 1) * PAGE_SIZE, appliedQuery);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/message/table"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to table
            </Link>
            <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">
              {CATEGORY_LABEL[category]}
            </span>
          </div>
          <h2 className="mt-2 text-base font-semibold tracking-tight">Message Queue · Detail</h2>
          <p className="text-sm text-zinc-500">{label}</p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mobile / name / email / keyword…"
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
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2.5 font-medium">User</th>
              <th className="px-3 py-2.5 font-medium">Schedule</th>
              <th className="px-3 py-2.5 font-medium">To</th>
              <th className="px-3 py-2.5 font-medium">First name</th>
              <th className="px-3 py-2.5 font-medium">Last name</th>
              <th className="px-3 py-2.5 font-medium">Sequence</th>
              <th className="px-3 py-2.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-400">
                  No matching messages.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                // Sequence falls back to keyword when sequenceName is empty.
                const seq = r.sequenceName && r.sequenceName.trim() !== "" ? r.sequenceName : r.keyword;
                return (
                  <tr key={r.id} className="align-top hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{r.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 tabular-nums">{r.scheduleGMT ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 tabular-nums">{r.mobile ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{r.firstname ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{r.lastname ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{seq ?? "—"}</td>
                    <td className="px-3 py-2.5 text-zinc-700">
                      <span className="block max-w-[480px] whitespace-pre-wrap break-words">{r.message || "—"}</span>
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
            "0 results"
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

export default function MessageDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center text-sm text-zinc-400">
          Loading…
        </div>
      }
    >
      <MessageDetailInner />
    </Suspense>
  );
}
