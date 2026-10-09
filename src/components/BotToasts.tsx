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
}

const MAX = 4;
const TTL_MS = 15_000;

export default function BotToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());

  const push = (id: string, bot: string, text: string): void => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    const toast: Toast = { id, bot, text, at: Date.now() };
    setToasts((prev) => [toast, ...prev.filter((t) => t.id !== toast.id)].slice(0, MAX));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id || Date.now() - t.at < TTL_MS));
    }, TTL_MS + 500);
  };

  useEffect(() => {
    const onAlert = (e: Event): void => {
      const f = (e as CustomEvent<{ id?: unknown; bot_name?: unknown; text?: unknown }>).detail;
      if (!f || typeof f.id !== "string" || typeof f.text !== "string") return;
      push(f.id, typeof f.bot_name === "string" ? f.bot_name : "Bot", f.text);
    };
    window.addEventListener("apostas:bot-alert", onAlert);
    // Alerts another tab found (payload rides the ping): toast here too.
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== "apostas:bots-ping" || !e.newValue) return;
      try {
        const body = JSON.parse(e.newValue) as { alerts?: { id?: unknown; bot_name?: unknown; text?: unknown }[] };
        for (const f of body.alerts ?? []) {
          if (!f || typeof f.id !== "string" || typeof f.text !== "string") continue;
          push(f.id, typeof f.bot_name === "string" ? f.bot_name : "Bot", f.text);
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
          <Link href="/bots" className="mt-1 inline-block font-medium text-emerald-400 hover:underline">
            Ver bots →
          </Link>
        </div>
      ))}
    </div>
  );
}
