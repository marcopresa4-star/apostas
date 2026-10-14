"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// In-site bot alert toasts: bottom-right on EVERY page (the layout mounts
// this once). The global BotsWatcher broadcasts fresh non-silent alerts;
// OS-level browser Notifications still fire separately when permitted.
interface Toast {
  id: string;
  bot: string;
  text: string;
  at: number;
  link?: string;
  sticky?: boolean;
}

const MAX = 4;
const TTL_MS = 15_000;
// Sticky (goal) toasts survive reloads: reloaded only if recent enough.
const STICKY_KEY = "apostas:stickyToasts";
const STICKY_MAX_AGE_MS = 24 * 3_600_000;

function loadSticky(): Toast[] {
  try {
    const raw = window.localStorage.getItem(STICKY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Toast[];
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.text === "string" &&
        typeof t.at === "number" &&
        now - t.at < STICKY_MAX_AGE_MS
    );
  } catch {
    return [];
  }
}

export default function BotToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());

  const push = (id: string, bot: string, text: string, link?: string, sticky?: boolean): void => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    const toast: Toast = { id, bot, text, at: Date.now(), link, sticky };
    setToasts((prev) => [toast, ...prev.filter((t) => t.id !== toast.id)].slice(0, MAX));
    // Goal toasts never expire on their own: only the ✕ takes them out.
    if (!sticky) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id || Date.now() - t.at < TTL_MS));
      }, TTL_MS + 500);
    }
  };

  useEffect(() => {
    // Embedded panels don't toast inside their frame.
    try {
      if (new URLSearchParams(window.location.search).get("embed") === "1") return;
    } catch {
      // No URL access: listen normally.
    }
    // Sticky toasts survive reloads (a code pull wipes in-memory state).
    const restored = loadSticky();
    if (restored.length > 0) {
      for (const t of restored) seen.current.add(t.id);
      setToasts((prev) => [...restored, ...prev].slice(0, MAX));
    }
    const onAlert = (e: Event): void => {
      const f = (e as CustomEvent<{ id?: unknown; bot_name?: unknown; text?: unknown; link?: unknown; sticky?: unknown }>).detail;
      if (!f || typeof f.id !== "string" || typeof f.text !== "string") return;
      push(
        f.id,
        typeof f.bot_name === "string" ? f.bot_name : "Bot",
        f.text,
        typeof f.link === "string" ? f.link : undefined,
        f.sticky === true
      );
    };
    window.addEventListener("apostas:bot-alert", onAlert);
    // Alerts another tab found (payload rides the ping): toast here too.
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== "apostas:bots-ping" || !e.newValue) return;
      try {
        const body = JSON.parse(e.newValue) as { alerts?: { id?: unknown; bot_name?: unknown; text?: unknown; link?: unknown; sticky?: unknown }[] };
        for (const f of body.alerts ?? []) {
          if (!f || typeof f.id !== "string" || typeof f.text !== "string") continue;
          push(
            f.id,
            typeof f.bot_name === "string" ? f.bot_name : "Bot",
            f.text,
            typeof f.link === "string" ? f.link : undefined,
            f.sticky === true
          );
        }
      } catch {
        // Malformed ping: the list refresh still runs on the Bots page.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("apostas:bot-alert", onAlert);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sticky toasts every change (dismissals included).
  useEffect(() => {
    try {
      window.localStorage.setItem(STICKY_KEY, JSON.stringify(toasts.filter((t) => t.sticky)));
    } catch {
      // Private mode: persistence just doesn't happen.
    }
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-emerald-500/40 bg-neutral-950/95 px-3 py-2.5 text-xs shadow-2xl backdrop-blur"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-emerald-300">🤖 {t.bot}</p>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 text-neutral-500 hover:text-neutral-200"
              title="Dispensar"
            >
              ✕
            </button>
          </div>
          <p className="mt-0.5 leading-snug text-neutral-200">{t.text}</p>
          {t.link && (
            <Link href={t.link} className="mt-1 inline-block font-medium text-emerald-400 hover:underline">
              Ver bots →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
