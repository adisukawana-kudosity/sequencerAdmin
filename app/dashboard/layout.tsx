"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminUser, clearSession, getTokenExpiry, getUser, isAuthenticated, isTokenExpired } from "../lib/auth";

type NavChild = { href: string; label: string };

type NavItem = {
  key: string;
  label: string;
  icon: string;
  href?: string;
  children?: NavChild[];
};

const navItems: NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "M3 12 12 4l9 8M5 10v10h14V10",
  },
  {
    key: "triggerlist",
    label: "Triggerlist",
    icon: "M4 6h16M4 12h16M4 18h10",
    children: [
      { href: "/dashboard/triggerlist", label: "Overview" },
      { href: "/dashboard/triggerlist/logs", label: "Logs" },
    ],
  },
  {
    key: "message",
    label: "Message",
    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    children: [
      { href: "/dashboard/message", label: "Overview" },
      { href: "/dashboard/message/table", label: "Table" },
    ],
  },
  {
    key: "wallpaper",
    label: "Wallpaper",
    icon: "M4 4h16v16H4zM4 14l4-4 4 4 4-4 4 4M9 9a1 1 0 1 0 0-.001Z",
    children: [
      { href: "/dashboard/wallpaper", label: "Overview" },
      { href: "/dashboard/wallpaper/logs", label: "Logs" },
    ],
  },
  {
    key: "users",
    label: "Users",
    href: "/dashboard/users",
    icon: "M16 14a4 4 0 1 0-8 0M3 21v-1a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v1",
  },
];

function isChildActive(children: NavChild[] | undefined, pathname: string) {
  if (!children) return false;
  return children.some((c) => c.href === pathname);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    triggerlist: true,
  }));

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/");
      return;
    }
    setUser(getUser());
    setReady(true);
  }, [router]);

  // Auto-logout when the JWT expires. Three signals trigger it:
  //   1. Periodic tick (30s) — handles an idle tab with no user input.
  //   2. localStorage `storage` event — handles logout in another tab.
  //   3. window `focus` — handles the case where the tab was backgrounded past
  //      expiry and the timer was throttled.
  useEffect(() => {
    const evict = () => {
      clearSession();
      router.replace("/");
    };
    const check = () => {
      if (isTokenExpired()) evict();
    };

    const intervalId = window.setInterval(check, 30_000);

    const onStorage = (e: StorageEvent) => {
      // Token key cleared in another tab → log this tab out too.
      if (e.key === "sequencer.adminToken" && e.newValue === null) evict();
    };
    const onFocus = () => check();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    // Also schedule a one-shot timer exactly at the expiry boundary so users
    // get logged out the instant the token dies, not up to 30s later.
    const exp = getTokenExpiry();
    let expiryTimeoutId: number | undefined;
    if (exp != null) {
      const msUntilExpiry = exp * 1000 - Date.now();
      if (msUntilExpiry > 0) {
        // Clamp to setTimeout's max safe range (~24.8 days).
        expiryTimeoutId = window.setTimeout(check, Math.min(msUntilExpiry + 500, 2 ** 31 - 1));
      }
    }

    return () => {
      window.clearInterval(intervalId);
      if (expiryTimeoutId !== undefined) window.clearTimeout(expiryTimeoutId);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const item of navItems) {
        if (item.children && isChildActive(item.children, pathname)) {
          next[item.key] = true;
        }
      }
      return next;
    });
  }, [pathname]);

  const headerTitle = useMemo(() => {
    for (const item of navItems) {
      if (item.href === pathname) return item.label;
      const child = item.children?.find((c) => c.href === pathname);
      if (child) return `${item.label} · ${child.label}`;
    }
    return "Dashboard";
  }, [pathname]);

  function handleLogout() {
    clearSession();
    router.replace("/");
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
      </div>
    );
  }

  const initial = (user?.name || user?.email || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-1 bg-zinc-50 text-zinc-900">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-6 md:flex">
        <div className="flex items-center gap-2 px-2 pb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/kudosity-brand.jpg"
            alt="Kudosity"
            className="h-7 w-auto"
          />
        </div>

        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            if (item.children) {
              const open = !!openGroups[item.key];
              const groupActive = isChildActive(item.children, pathname);
              return (
                <div key={item.key} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.key)}
                    aria-expanded={open}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      groupActive
                        ? "text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                    }`}
                  >
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
                      <path d={item.icon} />
                    </svg>
                    <span className="flex-1 text-left">{item.label}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>

                  {open && (
                    <div className="mt-0.5 ml-7 flex flex-col gap-0.5 border-l border-zinc-200 pl-3">
                      {item.children.map((child) => {
                        const active = child.href === pathname;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                              active
                                ? "bg-zinc-100 font-medium text-zinc-900"
                                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                            }`}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const active = item.href === pathname;
            return (
              <Link
                key={item.key}
                href={item.href ?? "#"}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-zinc-100 font-medium text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
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
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-xs font-semibold text-white">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name || "Admin"}</p>
            <p className="truncate text-xs text-zinc-500">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white/70 px-6 backdrop-blur">
          <div>
            <h1 className="text-sm font-medium">{headerTitle}</h1>
            <p className="text-xs text-zinc-500">Welcome back{user?.name ? `, ${user.name}` : ""}.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="hidden h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 sm:flex md:hidden"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
