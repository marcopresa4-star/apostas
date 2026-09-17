"use client";

import { useState } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive, getElapsedMinutes } from "@/lib/matchStatus";
import type { BetStatus } from "@/lib/database.types";

const STORAGE_KEY = "apostas:dismissedAlerts";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage failures (private mode, quota, etc.) — dismissal just
    // won't survive a reload in that case.
  }
}

interface Pick {
  id: string;
  selection: string;
  status: BetStatus;
  alert_minute: number | null;
}

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: Pick[];
}

export default function LiveAlerts({ tickets }: { tickets: Ticket[] }) {
  const now = useNow();
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadDismissed()
  );

  if (!now) return null;

  const alerts: { ticket: Ticket; pick: Pick; elapsed: number }[] = [];
  for (const ticket of tickets) {
    if (ticket.live_ended || !isMatchLive(ticket.match_date, ticket.match_time, now)) continue;
    const elapsed = getElapsedMinutes(ticket.match_date, ticket.match_time, now);
    if (elapsed === null) continue;
    for (const pick of ticket.picks) {
      if (pick.status !== "pending" || pick.alert_minute === null) continue;
      if (dismissed.has(pick.id)) continue;
      if (elapsed >= pick.alert_minute) alerts.push({ ticket, pick, elapsed });
    }
  }

  if (alerts.length === 0) return null;

  function dismiss(pickId: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(pickId);
      saveDismissed(next);
      return next;
    });
  }

  return (
    <div className="mb-6 space-y-2">
      {alerts.map(({ ticket, pick, elapsed }) => (
        <div
          key={pick.id}
          className="flex items-center gap-3 rounded-xl border border-amber-600/50 bg-gradient-to-r from-amber-950 to-neutral-900 px-4 py-3 shadow-lg shadow-amber-900/20"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-500/20 text-lg"
          >
            🔔
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-amber-200">
              {ticket.home_team?.name} <span className="text-amber-400/70">vs</span>{" "}
              {ticket.away_team?.name} · {elapsed}&apos;
            </p>
            <p className="truncate text-xs text-amber-300/80">
              {pick.selection} — chegou ao minuto {pick.alert_minute}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(pick.id)}
            aria-label="Dispensar notificação"
            title="Já vi, dispensar"
            className="shrink-0 rounded-lg p-1.5 text-amber-400/70 transition hover:bg-amber-500/10 hover:text-amber-200"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
