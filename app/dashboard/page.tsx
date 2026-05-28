"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminUser, getUser } from "../lib/auth";
import {
  ApiError,
  MessageQueueTotals,
  UserRow,
  fetchMessageQueueToday,
  fetchUserList,
} from "../lib/api";

type QuickLink = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

const quickLinks: QuickLink[] = [
  {
    href: "/dashboard/message",
    label: "Message Overview",
    description: "Today's queue activity, hourly trend and status breakdown.",
    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  },
  {
    href: "/dashboard/message/table",
    label: "Message Table",
    description: "Day-by-day status counts with drill-down to detail rows.",
    icon: "M4 6h16M4 12h16M4 18h10",
  },
  {
    href: "/dashboard/triggerlist",
    label: "Triggerlist",
    description: "Webhook activity by category, area chart and recent buckets.",
    icon: "M3 12 12 4l9 8M5 10v10h14V10",
  },
  {
    href: "/dashboard/users",
    label: "Users",
    description: "Browse users and open staging.sequencer.app as them with one click.",
    icon: "M16 14a4 4 0 1 0-8 0M3 21v-1a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v1",
  },
];

const ZERO_TOTALS: MessageQueueTotals = {
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

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

export default function DashboardHomePage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [totals, setTotals] = useState<MessageQueueTotals>(ZERO_TOTALS);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [recentUsers, setRecentUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      // Fire both requests in parallel — they don't depend on each other.
      const [today, users] = await Promise.all([
        fetchMessageQueueToday(ctrl.signal),
        fetchUserList({ limit: 5, offset: 0, signal: ctrl.signal }),
      ]);
      setTotals({ ...ZERO_TOTALS, ...today.totals });
      setUserCount(users.total);
      setRecentUsers(users.data || []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const displayName = user?.name || user?.email?.split("@")[0] || "there";

  const stats = [
    {
      label: "Sent today",
      value: totals.sent,
      accent: "text-emerald-600",
      hint: "Messages delivered / accepted today (GMT)",
    },
    {
      label: "In queue",
      value: totals.inQueue,
      accent: "text-indigo-600",
      hint: "Future-scheduled, active and not yet sent",
    },
    {
      label: "Failed / bounced",
      value: totals.failed + totals.softBounced + totals.hardBounced,
      accent: "text-rose-600",
      hint: "Failures + soft + hard bounces today",
    },
    {
      label: "Total users",
      value: userCount ?? 0,
      accent: "text-zinc-900",
      hint: "All admin users in the system",
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-6 text-white">
        <p className="text-xs uppercase tracking-wide text-zinc-400">Dashboard</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {greeting}, {displayName}.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-300">
          Quick snapshot of today's message queue and the system as a whole. Dive into a
          workspace below for the full view.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-white/10 px-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live data
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-60"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
              <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
              <path d="M21 21v-5h-5" />
            </svg>
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${s.accent}`}>
              {loading ? <Skeleton w={80} /> : s.value.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{s.hint}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h3 className="text-sm font-medium">Quick links</h3>
            <p className="text-xs text-zinc-500">Jump to a workspace.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 group-hover:bg-zinc-900 group-hover:text-white">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={q.icon} />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium">{q.label}</p>
              <p className="mt-1 text-xs text-zinc-500">{q.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium">Newest users</h3>
            <p className="text-xs text-zinc-500">5 most recently joined accounts.</p>
          </div>
          <Link href="/dashboard/users" className="text-xs font-medium text-indigo-600 hover:underline">
            View all →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-zinc-100">
          {loading ? (
            <li className="py-6 text-center text-sm text-zinc-400">Loading…</li>
          ) : recentUsers.length === 0 ? (
            <li className="py-6 text-center text-sm text-zinc-400">No users.</li>
          ) : (
            recentUsers.map((u) => {
              const initial = (u.firstName || u.email || "?").trim().charAt(0).toUpperCase();
              return (
                <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                    {initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-900">
                      {u.firstName || u.lastName
                        ? `${u.firstName} ${u.lastName}`.trim()
                        : u.email}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{u.email}</p>
                  </div>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {formatDateTime(u.dateJoin)}
                  </span>
                  {u.active === "yes" ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                      Inactive
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}

function Skeleton({ w, h = 28 }: { w: number; h?: number }) {
  return (
    <span
      className="inline-block animate-pulse rounded-md bg-zinc-200"
      style={{ width: w, height: h }}
    />
  );
}
