"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { oddsKeyFor } from "@/lib/oddsParse";

interface WatchBet {
  id: string;
  home_team: string;
  away_team: string;
  market_key: string;
  market_label: string;
  odd: number | null;
  sofascore_id: number | null;
  kickoff: string | null;
  target_odd: number | null;
  target_minute: number | null;
}

interface Toast {
  betId: string;
  title: string;
  body: string;
  href: string;
}

function beep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t);
      osc.stop(t + 0.16);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 900);
  } catch {
    // Silent: the on-screen toast still shows.
  }
}

// Global watcher for "watched" bets: every minute, for each one with a game
// link, check the live minute and the live price against its entry
// conditions. Fires once per bet per session: an on-screen toast (always
// works) plus sound, and a best-effort browser pop-up.
export default function WatchWatcher() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fired = useRef<Set<string>>(new Set());
  // Last seen minute per bet: alerts fire when the minute CROSSES the target
  // (below -> at/above), never when a bet is first seen already past it, and
  // never on a single glitchy reading.
  const lastMinute = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let stop = false;
    // While the scraper is down, back off instead of timing out against it
    // every minute (a pile of 30s hangs is what turns a hiccup into a stall).
    let fails = 0;
    let lastFail = 0;
    const check = async () => {
      if (fails >= 2 && Date.now() - lastFail < 5 * 60_000) return;
      let bets: WatchBet[] = [];
      try {
        const res = await fetch("/api/bets/watch", { cache: "no-store" });
        if (!res.ok) return;
        bets = ((await res.json()) as { bets?: WatchBet[] }).bets ?? [];
      } catch {
        return;
      }
      for (const bet of bets) {
        if (stop || !bet.sofascore_id || fired.current.has(bet.id)) continue;
        const reasons: string[] = [];
        let minute: number | null = null;
        let ok = false;
        try {
          const res = await fetch(`/api/sofascore/event?id=${bet.sofascore_id}&light=1`, {
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) continue;
          const state = ((await res.json()) as { state?: Record<string, unknown> }).state;
          if (!state || (state.phase !== "live" && state.phase !== "halftime")) continue;
          minute = typeof state.minute === "number" ? state.minute : null;
          ok = true;
        } catch {
          continue;
        } finally {
          if (ok) {
            fails = 0;
          } else {
            fails += 1;
            lastFail = Date.now();
          }
        }
        if (bet.target_minute !== null && minute !== null) {
          const prev = lastMinute.current.get(bet.id);
          lastMinute.current.set(bet.id, minute);
          if (prev !== undefined && prev < bet.target_minute && minute >= bet.target_minute) {
            reasons.push(`chegou aos ${minute}' (alvo: ${bet.target_minute}')`);
          }
        }
        if (bet.target_odd !== null) {
          try {
            const res = await fetch(`/api/sofascore/odds?id=${bet.sofascore_id}`, {
              cache: "no-store",
              signal: AbortSignal.timeout(20_000),
            });
            if (res.ok) {
              const body = (await res.json()) as {
                markets?: { choices?: { key?: unknown; odd?: unknown }[] }[];
              };
              const byKey: Record<string, number> = {};
              for (const m of body.markets ?? []) {
                for (const c of m.choices ?? []) {
                  if (typeof c.key === "string" && typeof c.odd === "number") byKey[c.key] = c.odd;
                }
              }
              const key = oddsKeyFor(bet.market_key, bet.home_team, bet.away_team);
              const current = key ? byKey[key] : undefined;
              if (current !== undefined && current >= bet.target_odd) {
                reasons.push(`odd a ${current.toFixed(2).replace(".", ",")} (alvo: ${bet.target_odd})`);
              }
            }
          } catch {
            // No price: the minute alone can still fire.
          }
        }
        if (reasons.length === 0 || stop) continue;
        fired.current.add(bet.id);
        const title = `👀 ${bet.home_team} vs ${bet.away_team}: ${bet.market_label}`;
        const body = `Condições de entrada: ${reasons.join(" · ")}`;
        setToasts((prev) =>
          prev.some((t) => t.betId === bet.id)
            ? prev
            : [...prev.slice(-2), { betId: bet.id, title, body, href: "/apostas" }]
        );
        beep();
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body });
          }
        } catch {
          // Blocked: toast + sound already fired.
        }
      }
    };
    void check();
    const id = setInterval(() => void check(), 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.betId}
          className="pointer-events-auto rounded-xl border border-amber-700/60 bg-neutral-900 p-3 shadow-2xl"
        >
          <p className="text-xs font-semibold text-neutral-100">{t.title}</p>
          <p className="mt-0.5 text-[11px] text-neutral-400">{t.body}</p>
          <div className="mt-2 flex gap-2">
            <Link
              href={t.href}
              className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
            >
              Ver aposta
            </Link>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.betId !== t.betId))}
              className="rounded-lg px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200"
            >
              Fechar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
