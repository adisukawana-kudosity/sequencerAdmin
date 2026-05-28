"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, WebhookItem, fetchWebhookList } from "../../../lib/api";

const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 350;
const PRESETS: Array<{ key: string; label: string; hours: number }> = [
  { key: "1h", label: "Last 1h", hours: 1 },
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d", label: "Last 7d", hours: 24 * 7 },
  { key: "30d", label: "Last 30d", hours: 24 * 30 },
];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toApiDateTime(localInput: string) {
  if (!localInput) return "";
  const d = new Date(localInput);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Decode base64 into a byte array. atob returns a binary string where each
// char maps to one byte, so we read charCode for the raw byte value.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Minimal PHP `unserialize` for the structural types we see in webhook payloads:
//   N;  b:0|1;  i:N;  d:N;  s:LEN:"…";  a:LEN:{…}  O:LEN:"…":LEN:{…}
// PHP encodes string length in BYTES (not chars), so we operate on a Uint8Array
// and decode each `s:` slice with TextDecoder.
function phpUnserialize(bytes: Uint8Array): unknown {
  let pos = 0;
  const td = new TextDecoder("utf-8");
  const chr = (i: number) => String.fromCharCode(bytes[i]);
  const expect = (ch: string) => {
    if (chr(pos) !== ch) throw new Error(`expected '${ch}' at ${pos}, got '${chr(pos)}'`);
    pos++;
  };
  const readUntil = (stop: string) => {
    let s = "";
    while (pos < bytes.length && chr(pos) !== stop) {
      s += chr(pos);
      pos++;
    }
    return s;
  };

  function parse(): unknown {
    const t = chr(pos);
    if (t === "N") {
      pos++;
      expect(";");
      return null;
    }
    if (t === "b") {
      pos += 2; // "b:"
      const v = chr(pos) === "1";
      pos++;
      expect(";");
      return v;
    }
    if (t === "i") {
      pos += 2;
      const n = readUntil(";");
      expect(";");
      return parseInt(n, 10);
    }
    if (t === "d") {
      pos += 2;
      const n = readUntil(";");
      expect(";");
      return parseFloat(n);
    }
    if (t === "s") {
      pos += 2;
      const lenStr = readUntil(":");
      const len = parseInt(lenStr, 10);
      pos++; // ":"
      expect('"');
      const slice = bytes.subarray(pos, pos + len);
      pos += len;
      expect('"');
      expect(";");
      return td.decode(slice);
    }
    if (t === "a") {
      pos += 2;
      const cnt = parseInt(readUntil(":"), 10);
      pos++; // ":"
      expect("{");
      const entries: Array<[string | number, unknown]> = [];
      for (let i = 0; i < cnt; i++) {
        const k = parse() as string | number;
        const v = parse();
        entries.push([k, v]);
      }
      expect("}");
      // Sequential 0..n-1 integer keys → JS array, otherwise object.
      const isArr = entries.every(([k], i) => typeof k === "number" && k === i);
      if (isArr) return entries.map(([, v]) => v);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of entries) obj[String(k)] = v;
      return obj;
    }
    if (t === "O") {
      pos += 2;
      readUntil(":");
      pos++; // ":"
      expect('"');
      let cls = "";
      while (chr(pos) !== '"') {
        cls += chr(pos);
        pos++;
      }
      pos++; // '"'
      expect(":");
      const cnt = parseInt(readUntil(":"), 10);
      pos++;
      expect("{");
      const obj: Record<string, unknown> = { __class__: cls };
      for (let i = 0; i < cnt; i++) {
        const k = parse() as string;
        const v = parse();
        obj[k] = v;
      }
      expect("}");
      return obj;
    }
    throw new Error(`unknown serialize type '${t}' at ${pos}`);
  }

  return parse();
}

function isLikelyBase64(s: string): boolean {
  // base64 chars + optional padding, length is a multiple of 4 after stripping
  // whitespace. We're permissive — actual decode failures fall through.
  const cleaned = s.replace(/\s+/g, "");
  if (cleaned.length < 4 || cleaned.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned);
}

// Best-effort decode of a webhook parameter blob. The canonical format used by
// the sequencer backend is `base64(serialize($array))`, so we try that first.
// We still fall back to JSON / URL-encoded / raw so legacy or external rows
// remain inspectable.
function decodeParameter(raw: string): {
  kind: "php" | "json" | "form" | "raw";
  value: unknown;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "raw", value: "" };

  // 1) base64-decoded PHP serialize.
  if (isLikelyBase64(trimmed)) {
    try {
      const bytes = base64ToBytes(trimmed.replace(/\s+/g, ""));
      // Quick header sanity check before running the parser.
      if (bytes.length > 0 && /[aiOsNbd]/.test(String.fromCharCode(bytes[0]))) {
        const value = phpUnserialize(bytes);
        return { kind: "php", value };
      }
    } catch {
      /* fall through */
    }
  }

  // 2) Pure JSON.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { kind: "json", value: JSON.parse(trimmed) };
    } catch {
      /* fall through */
    }
  }

  // 3) URL-encoded form (a=1&b=2).
  if (trimmed.includes("=") && (trimmed.includes("&") || /%[0-9A-Fa-f]{2}/.test(trimmed))) {
    try {
      const params = new URLSearchParams(trimmed);
      const out: Record<string, unknown> = {};
      params.forEach((v, k) => {
        let parsed: unknown = v;
        if (v && (v.startsWith("{") || v.startsWith("["))) {
          try {
            parsed = JSON.parse(v);
          } catch {
            /* keep as string */
          }
        }
        if (k in out) {
          const existing = out[k];
          out[k] = Array.isArray(existing) ? [...existing, parsed] : [existing, parsed];
        } else {
          out[k] = parsed;
        }
      });
      if (Object.keys(out).length > 0) {
        return { kind: "form", value: out };
      }
    } catch {
      /* fall through */
    }
  }

  // 4) Raw text — last resort.
  return { kind: "raw", value: trimmed };
}

function takenClass(value?: string | null) {
  const s = (value || "").toLowerCase();
  if (s === "yes") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (s === "no") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (s === "skip" || s === "skipped") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

export default function LogsPage() {
  const initialTo = useMemo(() => new Date(), []);
  const initialFrom = useMemo(() => new Date(initialTo.getTime() - 24 * 60 * 60 * 1000), [initialTo]);

  const [from, setFrom] = useState<string>(toLocalInput(initialFrom));
  const [to, setTo] = useState<string>(toLocalInput(initialTo));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<WebhookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalRow, setModalRow] = useState<WebhookItem | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Close the modal on Escape so keyboard users aren't trapped.
  useEffect(() => {
    if (!modalRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalRow]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [search, from, to, limit]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    try {
      const res = await fetchWebhookList({
        from: toApiDateTime(from),
        to: toApiDateTime(to),
        search: search || undefined,
        limit,
        offset,
        signal: ctrl.signal,
      });
      setItems(res.data || []);
      setTotal(res.total ?? (res.data?.length ?? 0));
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof ApiError ? err.message : "Failed to load webhook logs.";
      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [from, to, search, limit, offset]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  function applyPreset(hours: number) {
    const now = new Date();
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    setFrom(toLocalInput(start));
    setTo(toLocalInput(now));
  }

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const firstIndex = total === 0 ? 0 : offset + 1;
  const lastIndex = Math.min(total, offset + limit);

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setOffset((clamped - 1) * limit);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Webhook Logs</h2>
          <p className="text-sm text-zinc-500">
            Browse archived webhook events with date range, search and paging.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
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
            className={loading ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
            <path d="M21 21v-5h-5" />
          </svg>
          Refresh
        </button>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">From</label>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm focus:border-zinc-300 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">To</label>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm focus:border-zinc-300 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.hours)}
                className="h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Search</label>
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="mobile, list id…"
                className="h-9 w-72 rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none"
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 text-left">ID</th>
                <th className="px-4 py-2.5 text-left">List</th>
                <th className="px-4 py-2.5 text-left">Mobile</th>
                <th className="px-4 py-2.5 text-left">Parameter</th>
                <th className="px-4 py-2.5 text-left">Taken</th>
                <th className="px-4 py-2.5 text-left">Date (GMT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`s-${i}`} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <span className="inline-block h-3 w-24 rounded bg-zinc-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                    No webhook records match the current filters.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={String(row.id)} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">{formatCell(row.id)}</td>
                    <td className="px-4 py-2.5 text-zinc-600 tabular-nums">{formatCell(row.list_id)}</td>
                    <td className="px-4 py-2.5">{formatCell(row.mobile)}</td>
                    <td className="px-4 py-2.5">
                      {row.parameter == null || row.parameter === "" ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setModalRow(row)}
                          title="View decoded parameter"
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          View
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${takenClass(
                          row.hasTaken,
                        )}`}
                      >
                        {row.hasTaken || "unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 tabular-nums">{formatCell(row.dateAddedGMT)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-600">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-7 rounded border border-zinc-200 bg-white px-1.5 text-xs focus:border-zinc-300 focus:outline-none"
            >
              {LIMIT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="tabular-nums">
            {total === 0
              ? "0 of 0"
              : `${firstIndex.toLocaleString()}–${lastIndex.toLocaleString()} of ${total.toLocaleString()}`}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(1)}
              disabled={page <= 1 || loading}
              className="h-7 rounded border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || loading}
              className="h-7 rounded border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
            >
              ‹ Prev
            </button>
            <span className="px-2 tabular-nums">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || loading}
              className="h-7 rounded border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
            >
              Next ›
            </button>
            <button
              type="button"
              onClick={() => goToPage(totalPages)}
              disabled={page >= totalPages || loading}
              className="h-7 rounded border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
            >
              »
            </button>
          </div>
        </div>
      </section>

      {modalRow && (
        <ParameterModal row={modalRow} onClose={() => setModalRow(null)} />
      )}
    </div>
  );
}

function ParameterModal({
  row,
  onClose,
}: {
  row: WebhookItem;
  onClose: () => void;
}) {
  const raw = typeof row.parameter === "string" ? row.parameter : String(row.parameter ?? "");
  const decoded = useMemo(() => decodeParameter(raw), [raw]);
  const pretty = useMemo(() => {
    if (decoded.kind === "raw") return String(decoded.value ?? "");
    try {
      return JSON.stringify(decoded.value, null, 2);
    } catch {
      return String(decoded.value);
    }
  }, [decoded]);

  const kindBadge =
    decoded.kind === "php"
      ? "base64 + PHP serialize"
      : decoded.kind === "json"
        ? "JSON"
        : decoded.kind === "form"
          ? "URL-encoded"
          : "Raw text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
    } catch {
      /* ignore — clipboard may be unavailable */
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parameter-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-3">
          <div>
            <h3 id="parameter-modal-title" className="text-sm font-semibold text-zinc-900">
              Parameter
            </h3>
            <p className="text-xs text-zinc-500">
              Row #{row.id ?? "—"} · decoded as{" "}
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700">
                {kindBadge}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-all rounded-md bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800">
            {pretty || "(empty)"}
          </pre>

          {decoded.kind !== "raw" && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
                Show raw value
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-600">
                {raw}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
