"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  WallpaperBucket,
  fetchWallpaperRecap,
} from "../../lib/api";
import { DonutChart } from "../_components/donut-chart";
import { StackedAreaChart } from "../_components/stacked-area-chart";
import { StackedBarChart } from "../_components/stacked-bar-chart";

const CATEGORY_COLORS = {
  executed: "#10b981",
  taken: "#3b82f6",
  pending: "#f59e0b",
  skipped: "#64748b",
} as const;

const POLL_INTERVAL_MS = 60_000;
const HOURS_WINDOW = 24;

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatLocalDateTime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hourLabel(bucketPeriod: string): string {
  const m = bucketPeriod.match(/(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?/);
  if (!m) return bucketPeriod;
  const hh = m[4] ?? "00";
  return `${hh}:00`;
}

function timeAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function WallpaperOverviewPage() {
  const [buckets, setBuckets] = useState<WallpaperBucket[]>([]);
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
      const to = new Date();
      const from = new Date(to.getTime() - HOURS_WINDOW * 60 * 60 * 1000);
      const res = await fetchWallpaperRecap(
        "hour",
        formatLocalDateTime(from),
        formatLocalDateTime(to),
        ctrl.signal,
      );
      setBuckets(res.data || []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof ApiError ? err.message : "Failed to load wallpaper data.";
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

  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => {
        acc.total += b.total;
        acc.executed += b.executed;
        acc.taken += b.taken;
        acc.pending += b.pending;
        acc.skipped += b.skipped;
        return acc;
      },
      { total: 0, executed: 0, taken: 0, pending: 0, skipped: 0 },
    );
  }, [buckets]);

  const stackedSeries = useMemo(
    () => [
      { label: "Executed", color: CATEGORY_COLORS.executed, values: buckets.map((b) => b.executed) },
      { label: "Taken", color: CATEGORY_COLORS.taken, values: buckets.map((b) => b.taken) },
      { label: "Pending", color: CATEGORY_COLORS.pending, values: buckets.map((b) => b.pending) },
      { label: "Skipped", color: CATEGORY_COLORS.skipped, values: buckets.map((b) => b.skipped) },
    ],
    [buckets],
  );

  const labels = useMemo(
    () => buckets.map((b, i) => (i % 3 === 0 || i === buckets.length - 1 ? hourLabel(b.period) : "")),
    [buckets],
  );

  const barData = useMemo(
    () =>
      buckets.slice(-8).map((b) => ({
        label: hourLabel(b.period),
        segments: [
          { label: "Executed", value: b.executed, color: CATEGORY_COLORS.executed },
          { label: "Taken", value: b.taken, color: CATEGORY_COLORS.taken },
          { label: "Pending", value: b.pending, color: CATEGORY_COLORS.pending },
          { label: "Skipped", value: b.skipped, color: CATEGORY_COLORS.skipped },
        ],
      })),
    [buckets],
  );

  const donutData = useMemo(() => {
    const sumCategories = totals.executed + totals.taken + totals.pending + totals.skipped;
    if (sumCategories === 0) {
      return [{ label: "No data yet", value: 1, color: "#e4e4e7" }];
    }
    return [
      { label: "Executed", value: totals.executed, color: CATEGORY_COLORS.executed },
      { label: "Taken", value: totals.taken, color: CATEGORY_COLORS.taken },
      { label: "Pending", value: totals.pending, color: CATEGORY_COLORS.pending },
      { label: "Skipped", value: totals.skipped, color: CATEGORY_COLORS.skipped },
    ];
  }, [totals]);

  const sinceLast = lastUpdated ? Math.floor((now.getTime() - lastUpdated.getTime()) / 1000) : 0;

  const peakBucket = useMemo(() => {
    if (buckets.length === 0) return null;
    return buckets.reduce((a, b) => (b.total > a.total ? b : a), buckets[0]);
  }, [buckets]);

  const stats = [
    { label: "Total wallpapers", value: totals.total, accent: "text-zinc-900" },
    { label: "Executed", value: totals.executed, accent: "text-emerald-600" },
    { label: "Taken", value: totals.taken, accent: "text-sky-600" },
    { label: "Pending", value: totals.pending, accent: "text-amber-600" },
    { label: "Skipped", value: totals.skipped, accent: "text-zinc-600" },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Wallpaper Activity</h2>
          <p className="text-sm text-zinc-500">
            Last {HOURS_WINDOW} hours · auto-refreshes every {POLL_INTERVAL_MS / 1000}s
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
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${s.accent}`}>
              {loading ? <Skeleton w={80} /> : s.value.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {totals.total > 0 && s.label !== "Total wallpapers"
                ? `${((s.value / totals.total) * 100).toFixed(1)}% of total`
                : "Last 24 hours"}
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium">Volume per hour</h3>
              <p className="text-xs text-zinc-500">
                {peakBucket
                  ? `Peak: ${peakBucket.total} at ${hourLabel(peakBucket.period)}`
                  : "Awaiting data…"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              live
            </span>
          </div>
          <div className="mt-4 min-h-[220px]">
            {loading ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-zinc-400">
                Loading…
              </div>
            ) : buckets.length === 0 ? (
              <EmptyState message="No wallpaper activity in this window." />
            ) : (
              <StackedAreaChart series={stackedSeries} labels={labels} className="w-full" />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="text-sm font-medium">Status breakdown</h3>
          <p className="text-xs text-zinc-500">Across the last 24 hours</p>
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
            <h3 className="text-sm font-medium">Recent hourly totals</h3>
            <p className="text-xs text-zinc-500">Last 8 hourly buckets</p>
          </div>
        </div>
        <div className="mt-4 min-h-[220px]">
          {loading ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-zinc-400">
              Loading…
            </div>
          ) : barData.length === 0 ? (
            <EmptyState message="No buckets to display." />
          ) : (
            <StackedBarChart data={barData} className="w-full" />
          )}
        </div>
      </section>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-200 text-sm text-zinc-400">
      {message}
    </div>
  );
}
