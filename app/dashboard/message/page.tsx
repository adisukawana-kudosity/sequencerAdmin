"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, MessageQueueBucket, fetchMessageQueueToday } from "../../lib/api";
import { DonutChart } from "../_components/donut-chart";
import { Sparkline } from "../_components/sparkline";
import { StackedAreaChart } from "../_components/stacked-area-chart";

const POLL_INTERVAL_MS = 60_000;

const CATEGORY_COLORS = {
  inQueue: "#6366f1",
  filtered: "#94a3b8",
  sent: "#10b981",
  failed: "#ef4444",
  paused: "#f59e0b",
  softBounced: "#f97316",
  hardBounced: "#b91c1c",
  pending: "#8b5cf6",
  prepare: "#14b8a6",
  stopped: "#71717a",
  notSending: "#d4d4d8",
} as const;

type CategoryKey = keyof typeof CATEGORY_COLORS;

const CATEGORY_ORDER: { key: CategoryKey; label: string }[] = [
  { key: "inQueue", label: "In queue" },
  { key: "sent", label: "Sent" },
  { key: "pending", label: "Pending" },
  { key: "prepare", label: "Prepare" },
  { key: "paused", label: "Paused" },
  { key: "stopped", label: "Stopped" },
  { key: "filtered", label: "Filtered" },
  { key: "notSending", label: "Not sending" },
  { key: "softBounced", label: "Soft bounce" },
  { key: "hardBounced", label: "Hard bounce" },
  { key: "failed", label: "Failed" },
];

function hourLabel(bucketPeriod: string): string {
  // Hour buckets come back as "YYYY-MM-DD HH:00:00".
  const m = bucketPeriod.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);
  if (!m) return bucketPeriod;
  return `${m[4]}:00`;
}

function timeAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

type Totals = Record<CategoryKey, number> & { total: number };

const ZERO_TOTALS: Totals = {
  total: 0,
  inQueue: 0,
  filtered: 0,
  sent: 0,
  failed: 0,
  paused: 0,
  softBounced: 0,
  hardBounced: 0,
  pending: 0,
  prepare: 0,
  stopped: 0,
  notSending: 0,
};

export default function MessagePage() {
  const [totals, setTotals] = useState<Totals>(ZERO_TOTALS);
  const [buckets, setBuckets] = useState<MessageQueueBucket[]>([]);
  const [windowFrom, setWindowFrom] = useState<string>("");
  const [windowTo, setWindowTo] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (mode === "initial") setLoading(true);
    else setRefreshing(true);

    try {
      // Today-only — backend pins the window to today's GMT day and returns
      // up to 24 hourly buckets plus pre-summed totals.
      const res = await fetchMessageQueueToday(ctrl.signal);
      setTotals({ ...ZERO_TOTALS, ...res.totals });
      setBuckets(res.data || []);
      setWindowFrom(res.from);
      setWindowTo(res.to);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof ApiError ? err.message : "Failed to load message queue data.";
      setError(msg);
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load("initial");
    const id = setInterval(() => load("refresh"), POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const stackedSeries = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        label: c.label,
        color: CATEGORY_COLORS[c.key],
        values: buckets.map((b) => b[c.key]),
      })),
    [buckets],
  );

  const hourLabels = useMemo(
    // Hour buckets come back ordered ascending. Up to 24 of them — label every
    // 2nd point to keep the axis readable without overlap.
    () => buckets.map((b, i) => (i % 2 === 0 || i === buckets.length - 1 ? hourLabel(b.period) : "")),
    [buckets],
  );

  const peakBucket = useMemo(() => {
    if (buckets.length === 0) return null;
    return buckets.reduce((a, b) => (b.total > a.total ? b : a), buckets[0]);
  }, [buckets]);

  // Insights derived from the hourly buckets. All hour math is local to the
  // request — no extra DB hit. "Delivery rate" denominator is sent+failed+
  // bounces (delivery attempts that actually resolved), not raw total, so
  // queued/pending rows don't drag the percentage down.
  const insights = useMemo(() => {
    const attempts = totals.sent + totals.failed + totals.softBounced + totals.hardBounced;
    const deliveryRate = attempts > 0 ? (totals.sent / attempts) * 100 : null;
    const nonEmptyHours = buckets.filter((b) => b.total > 0);
    const avgPerHour = nonEmptyHours.length > 0
      ? Math.round(nonEmptyHours.reduce((a, b) => a + b.total, 0) / nonEmptyHours.length)
      : 0;
    const last6 = buckets.slice(-6).map((b) => b.total);
    let trend: "up" | "down" | "flat" = "flat";
    if (last6.length >= 4) {
      const half = Math.floor(last6.length / 2);
      const earlier = last6.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const later = last6.slice(half).reduce((a, b) => a + b, 0) / (last6.length - half);
      if (later > earlier * 1.1) trend = "up";
      else if (later < earlier * 0.9) trend = "down";
    }
    const bounceTotal = totals.softBounced + totals.hardBounced;
    return { deliveryRate, avgPerHour, last6, trend, attempts, bounceTotal };
  }, [buckets, totals]);

  const donutData = useMemo(() => {
    const sum = CATEGORY_ORDER.reduce((acc, c) => acc + totals[c.key], 0);
    if (sum === 0) {
      return [{ label: "No data yet", value: 1, color: "#e4e4e7" }];
    }
    return CATEGORY_ORDER.filter((c) => totals[c.key] > 0).map((c) => ({
      label: c.label,
      value: totals[c.key],
      color: CATEGORY_COLORS[c.key],
    }));
  }, [totals]);

  const sinceLast = lastUpdated ? Math.floor((now.getTime() - lastUpdated.getTime()) / 1000) : 0;

  const headlineStats = [
    { label: "Total", value: totals.total, accent: "text-zinc-900" },
    { label: "In queue", value: totals.inQueue, accent: "text-indigo-600" },
    { label: "Sent", value: totals.sent, accent: "text-emerald-600" },
    { label: "Pending", value: totals.pending, accent: "text-violet-600" },
    { label: "Failed", value: totals.failed, accent: "text-rose-600" },
  ];

  const secondaryStats = [
    { label: "Prepare", value: totals.prepare, color: CATEGORY_COLORS.prepare },
    { label: "Paused", value: totals.paused, color: CATEGORY_COLORS.paused },
    { label: "Stopped", value: totals.stopped, color: CATEGORY_COLORS.stopped },
    { label: "Filtered", value: totals.filtered, color: CATEGORY_COLORS.filtered },
    { label: "Not sending", value: totals.notSending, color: CATEGORY_COLORS.notSending },
    { label: "Soft bounce", value: totals.softBounced, color: CATEGORY_COLORS.softBounced },
    { label: "Hard bounce", value: totals.hardBounced, color: CATEGORY_COLORS.hardBounced },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Message Queue</h2>
          <p className="text-sm text-zinc-500">
            Today (GMT){windowFrom && windowTo ? ` · ${windowFrom.slice(0, 10)}` : ""} · auto-refreshes every {POLL_INTERVAL_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <LiveDot active={!error} />
            {error ? "Disconnected" : lastUpdated ? `Updated ${timeAgo(sinceLast)}` : "Connecting…"}
          </span>
          <button
            type="button"
            onClick={() => load("refresh")}
            disabled={refreshing}
            className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
              <path d="M21 21v-5h-5" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {headlineStats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${s.accent}`}>
              {loading ? <Skeleton w={80} /> : s.value.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {totals.total > 0 && s.label !== "Total"
                ? `${((s.value / totals.total) * 100).toFixed(1)}% of total`
                : "Today (GMT)"}
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {secondaryStats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-200 bg-white p-3"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">
              {loading ? <Skeleton w={48} /> : s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium">Activity per hour</h3>
              <p className="text-xs text-zinc-500">
                {peakBucket
                  ? `Peak: ${peakBucket.total} at ${hourLabel(peakBucket.period)} GMT`
                  : "Awaiting data…"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              live
            </span>
          </div>
          <div className="mt-4 min-h-[260px]">
            {loading ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-zinc-400">
                Loading…
              </div>
            ) : buckets.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-zinc-200 text-sm text-zinc-400">
                No activity yet today.
              </div>
            ) : (
              <StackedAreaChart series={stackedSeries} labels={hourLabels} className="w-full" />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="text-sm font-medium">Status breakdown</h3>
          <p className="text-xs text-zinc-500">Today (GMT)</p>
          <div className="mt-6 flex items-center justify-center">
            {loading ? (
              <Skeleton w={180} h={180} circle />
            ) : (
              <DonutChart data={donutData} />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium">Today&apos;s insights</h3>
            <p className="text-xs text-zinc-500">Derived from this hour&apos;s data — no extra DB hit.</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InsightCard
            label="Peak hour"
            primary={
              loading ? "…" : peakBucket && peakBucket.total > 0
                ? `${hourLabel(peakBucket.period)} GMT`
                : "—"
            }
            secondary={
              loading ? "" : peakBucket && peakBucket.total > 0
                ? `${peakBucket.total.toLocaleString()} messages`
                : "No activity yet"
            }
          />
          <InsightCard
            label="Delivery rate"
            primary={
              loading
                ? "…"
                : insights.deliveryRate === null
                  ? "—"
                  : `${insights.deliveryRate.toFixed(1)}%`
            }
            secondary={
              loading
                ? ""
                : insights.attempts > 0
                  ? `${totals.sent.toLocaleString()} of ${insights.attempts.toLocaleString()} attempts`
                  : "Awaiting attempts"
            }
          />
          <InsightCard
            label="Average per hour"
            primary={loading ? "…" : insights.avgPerHour.toLocaleString()}
            secondary={
              loading
                ? ""
                : `Across ${buckets.filter((b) => b.total > 0).length || 0} active hour(s)`
            }
          />
          <InsightCard
            label="Last 6 hours"
            primary={
              loading ? (
                "…"
              ) : insights.last6.length > 1 ? (
                <Sparkline
                  data={insights.last6}
                  trend={insights.trend === "down" ? "down" : "up"}
                  width={104}
                  height={28}
                />
              ) : (
                "—"
              )
            }
            secondary={
              loading
                ? ""
                : insights.trend === "up"
                  ? "Trending up"
                  : insights.trend === "down"
                    ? "Trending down"
                    : "Flat"
            }
          />
        </div>

        <p className="mt-4 text-xs text-zinc-600">
          {loading
            ? "Loading today's summary…"
            : totals.total === 0
              ? "No messages scheduled for today yet."
              : `${totals.sent.toLocaleString()} sent · ${totals.failed.toLocaleString()} failed · ${insights.bounceTotal.toLocaleString()} bounced · ${totals.pending.toLocaleString()} pending · ${totals.inQueue.toLocaleString()} still queued.`}
        </p>
      </section>
    </div>
  );
}

function InsightCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">{primary}</div>
      <p className="mt-0.5 text-[11px] text-zinc-500">{secondary}</p>
    </div>
  );
}

function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          active ? "bg-emerald-500" : "bg-rose-500"
        }`}
      />
    </span>
  );
}

function Skeleton({ w, h = 28, circle = false }: { w: number; h?: number; circle?: boolean }) {
  return (
    <span
      className={`inline-block animate-pulse bg-zinc-200 ${circle ? "rounded-full" : "rounded-md"}`}
      style={{ width: w, height: h }}
    />
  );
}

