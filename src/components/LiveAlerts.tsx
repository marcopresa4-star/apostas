"use client";

import { useState } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive, getElapsedMinutes } from "@/lib/matchStatus";
import { useSportscoreLive } from "@/lib/useSportscoreLive";
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

  // Heuristic gate only (kickoff-time window): decides which picks are
  // worth checking at all. The actual alert-minute comparison, using real
  // sportscore.com data when available, happens inside AlertCard.
  const candidates: { ticket: Ticket; pick: Pick }[] = [];
  for (const ticket of tickets) {
    if (!isMatchLive(ticket.match_date, ticket.match_time, now)) continue;
    for (const pick of ticket.picks) {
      if (pick.status !== "pending" || pick.alert_minute === null) continue;
      if (dismissed.has(pick.id)) continue;
      candidates.push({ ticket, pick });
    }
  }

  if (candidates.length === 0) return null;

  function dismiss(pickId: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(pickId);
      saveDismissed(next);
      return next;
    });
  }

  return (
    <div className="mb-6 space-y-2">
      {candidates.map(({ ticket, pick }) => (
        <AlertCard key={pick.id} ticket={ticket} pick={pick} onDismiss={() => dismiss(pick.id)} />
      ))}
    </div>
  );
}

function AlertCard({
  ticket,
  pick,
  onDismiss,
}: {
  ticket: Ticket;
  pick: Pick;
  onDismiss: () => void;
}) {
  const now = useNow();
  const liveData = useSportscoreLive(ticket.home_team?.name ?? null, ticket.away_team?.name ?? null);

  if (!now) return null;

  let elapsed: number | null;
  let liveScore: string | null = null;
  if (liveData) {
    elapsed =
      liveData.isLive && liveData.minuteLabel && /^\d+$/.test(liveData.minuteLabel)
        ? Number(liveData.minuteLabel)
        : liveData.isLive
          ? 45 // live but non-numeric label (e.g. half-time) — treat as reached
          : null;
    if (liveData.homeScore !== null && liveData.awayScore !== null) {
      liveScore = `${liveData.homeScore}-${liveData.awayScore}`;
    }
  } else {
    elapsed = getElapsedMinutes(ticket.match_date, ticket.match_time, now);
  }

  if (elapsed === null || pick.alert_minute === null || elapsed < pick.alert_minute) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-600/50 bg-gradient-to-r from-amber-950 to-neutral-900 px-4 py-3 shadow-lg shadow-amber-900/20">
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
          {liveScore && <span className="text-amber-300/70"> · {liveScore}</span>}
        </p>
        <p className="truncate text-xs text-amber-300/80">
          {pick.selection} — chegou ao minuto {pick.alert_minute}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dispensar notificação"
        title="Já vi, dispensar"
        className="shrink-0 rounded-lg p-1.5 text-amber-400/70 transition hover:bg-amber-500/10 hover:text-amber-200"
      >
        ✕
      </button>
    </div>
  );
}
