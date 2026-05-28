"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  MessageQueueBucket,
  MessageQueueCategory,
  MessageQueueTotals,
  fetchMessageQueueRecap,
} from "../../../lib/api";

// Backend caps message-queue queries at 5 days. Keep this in sync with
// MESSAGE_QUEUE_MAX_DAYS in adminapi.php.
const MAX_RANGE_DAYS = 5;

type ColumnKey = keyof MessageQueueBucket;

// Total is intentionally last so the running total reads at the end of the row.
const COLUMNS: { key: ColumnKey; label: string; category?: MessageQueueCategory }[] = [
  { key: "period", label: "Date" },
  { key: "sent", label: "Sent", category: "sent" },
  { key: "inQueue", label: "In queue", category: "inQueue" },
  { key: "pending", label: "Pending", category: "pending" },
  { key: "prepare", label: "Prepare", category: "prepare" },
  { key: "filtered", label: "Filter", category: "filtered" },
  { key: "paused", label: "Pause", category: "paused" },
  { key: "failed", label: "Fail", category: "failed" },
  { key: "softBounced", label: "Soft bounce", category: "softBounced" },
  { key: "hardBounced", label: "Hard bounce", category: "hardBounced" },
  { key: "stopped", label: "Stop", category: "stopped" },
  { key: "notSending", label: "Not sending", category: "notSending" },
  { key: "total", label: "Total", category: "total" },
];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  // Default window matches the 5-day cap so the page loads usefully without
  // bumping into the server-side guard.
  const from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function daysBetween(fromIso: string, toIso: string): number {
  const f = Date.parse(`${fromIso}T00:00:00`);
  const t = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(f) || Number.isNaN(t)) return NaN;
  return Math.round((t - f) / (24 * 60 * 60 * 1000)) + 1;
}

function formatPeriod(value: string): string {
  // Buckets come back from the backend as "YYYY-MM-DD" (day grouping only).
  return value;
}

// Translate a "YYYY-MM-DD" bucket label into the SQL datetime range that day
// covers, so the detail page can narrow to exactly the rows the user clicked on.
function bucketRange(value: string): { from: string; to: string } {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return { from: `${y}-${mo}-${d} 00:00:00`, to: `${y}-${mo}-${d} 23:59:59` };
  }
  // Fallback: return the literal value as both sides.
  return { from: `${value} 00:00:00`, to: `${value} 23:59:59` };
}

function detailHref(opts: {
  from: string;
  to: string;
  category: MessageQueueCategory;
  label?: string;
}) {
  const p = new URLSearchParams({ from: opts.from, to: opts.to, category: opts.category });
  if (opts.label) p.set("label", opts.label);
  return `/dashboard/message/detail?${p.toString()}`;
}

function downloadCsv(rows: MessageQueueBucket[]) {
  const header = COLUMNS.map((c) => c.label).join(",");
  const lines = rows.map((r) =>
    COLUMNS.map((c) => {
      if (c.key === "period") return `"${formatPeriod(r.period)}"`;
      return String(r[c.key] ?? 0);
    }).join(","),
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `message-queue-day-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function MessageTablePage() {
  const initial = defaultRange();
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [rows, setRows] = useState<MessageQueueBucket[]>([]);
  const [totals, setTotals] = useState<MessageQueueTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const fromStr = `${f} 00:00:00`;
      const toStr = `${t} 23:59:59`;
      const res = await fetchMessageQueueRecap(fromStr, toStr, ctrl.signal);
      setRows(res.data || []);
      setTotals(res.totals || null);
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof ApiError ? err.message : "Failed to load message queue data.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
    return () => abortRef.current?.abort();
    // initial load only; subsequent loads are triggered by Apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromIsValid = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(from), [from]);
  const toIsValid = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(to), [to]);
  const rangeDays = useMemo(() => daysBetween(from, to), [from, to]);
  const rangeTooLong = Number.isFinite(rangeDays) && rangeDays > MAX_RANGE_DAYS;
  const rangeValid = fromIsValid && toIsValid && from <= to && !rangeTooLong;

  function handleApply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rangeValid) return;
    load(from, to);
  }

  function handlePresetRange(days: number) {
    const t = new Date();
    const f = new Date(t.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    setFrom(toIsoDate(f));
    setTo(toIsoDate(t));
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Message Queue · Table</h2>
          <p className="text-sm text-zinc-500">Daily status counts over the selected window.</p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(rows)}
          disabled={rows.length === 0}
          className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Export CSV
        </button>
      </div>

      <form
        onSubmit={handleApply}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Start date</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            max={to || undefined}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">End date</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            min={from || undefined}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-1 items-end justify-end gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => handlePresetRange(1)}
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handlePresetRange(3)}
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              3d
            </button>
            <button
              type="button"
              onClick={() => handlePresetRange(MAX_RANGE_DAYS)}
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {MAX_RANGE_DAYS}d
            </button>
          </div>
          <button
            type="submit"
            disabled={!rangeValid || loading}
            className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </form>

      {rangeTooLong && (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Range exceeds the {MAX_RANGE_DAYS}-day cap (selected {rangeDays} days).
          Pick a shorter window before applying.
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-zinc-400">
                  No data in the selected window.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const range = bucketRange(r.period);
                return (
                  <tr key={r.period} className="hover:bg-zinc-50">
                    {COLUMNS.map((c) => {
                      if (c.key === "period") {
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900">
                            {formatPeriod(r.period)}
                          </td>
                        );
                      }
                      const v = Number(r[c.key] ?? 0);
                      if (!c.category) {
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2.5 tabular-nums text-zinc-700">
                            {v.toLocaleString()}
                          </td>
                        );
                      }
                      const label = `${c.label} · ${formatPeriod(r.period)}`;
                      return (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                          {v > 0 ? (
                            <Link
                              href={detailHref({
                                from: range.from,
                                to: range.to,
                                category: c.category,
                                label,
                              })}
                              className="rounded px-1.5 py-0.5 text-zinc-700 underline-offset-2 hover:bg-zinc-100 hover:text-zinc-900 hover:underline"
                            >
                              {v.toLocaleString()}
                            </Link>
                          ) : (
                            <span className="text-zinc-400">0</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="border-t border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                {COLUMNS.map((c) => {
                  if (c.key === "period") {
                    return (
                      <td key={c.key} className="px-3 py-2.5 font-semibold text-zinc-900">
                        Total
                      </td>
                    );
                  }
                  const v = Number((totals as unknown as Record<string, number>)[c.key] ?? 0);
                  // Footer cells link to the whole selected window for that category.
                  const fullRange = { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
                  return (
                    <td key={c.key} className="px-3 py-2.5 font-semibold tabular-nums text-zinc-900">
                      {c.category && v > 0 ? (
                        <Link
                          href={detailHref({
                            from: fullRange.from,
                            to: fullRange.to,
                            category: c.category,
                            label: `${c.label} · ${from} → ${to}`,
                          })}
                          className="rounded px-1.5 py-0.5 underline-offset-2 hover:bg-zinc-200 hover:underline"
                        >
                          {v.toLocaleString()}
                        </Link>
                      ) : (
                        v.toLocaleString()
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
