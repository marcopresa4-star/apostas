"use client";

import { useEffect, useRef, useState } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

interface Toast {
  id: string;
  home: string;
  away: string;
}

const TOAST_MS = 12000;

// Watches every tracked game and pops a toast the moment one crosses into
// its live window. The first tick just records whichever games are already
// live (e.g. the page was opened mid-match) without notifying for them —
// only a false-to-true transition seen live, during this session, counts.
export default function GameStartNotifications({ tickets }: { tickets: Ticket[] }) {
  const now = useNow();
  const seenLiveRef = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function tick() {
      if (!now) return;

      if (seenLiveRef.current === null) {
        const initial = new Set<string>();
        for (const ticket of tickets) {
          if (isMatchLive(ticket.match_date, ticket.match_time, now)) initial.add(ticket.id);
        }
        seenLiveRef.current = initial;
        return;
      }

      const seen = seenLiveRef.current;
      for (const ticket of tickets) {
        if (seen.has(ticket.id)) continue;
        if (!isMatchLive(ticket.match_date, ticket.match_time, now)) continue;

        seen.add(ticket.id);
        const toast: Toast = {
          id: ticket.id,
          home: ticket.home_team?.name ?? "?",
          away: ticket.away_team?.name ?? "?",
        };
        setToasts((prev) => [...prev, toast]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toast.id));
        }, TOAST_MS);
      }
    }
    tick();
  }, [now, tickets]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-3 rounded-xl border border-red-600/50 bg-gradient-to-r from-red-950 to-neutral-900 px-4 py-3 shadow-xl shadow-red-900/30"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-500/20 text-lg"
          >
            ⚽
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-200">O jogo começou!</p>
            <p className="truncate text-xs text-red-300/80">
              {toast.home} <span className="text-red-400/60">vs</span> {toast.away}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            aria-label="Fechar notificação"
            className="shrink-0 rounded-lg p-1 text-red-400/60 transition hover:bg-red-500/10 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
