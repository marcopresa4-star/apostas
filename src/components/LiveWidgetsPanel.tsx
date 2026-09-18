"use client";

import { useState, useTransition } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import { addWatchedMatch, removeWatchedMatch } from "@/app/(app)/actions";
import SportscoreWidget from "./SportscoreWidget";

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

interface WatchedMatch {
  id: string;
  home_team: string;
  away_team: string;
}

// Computes "which matches are live" on the client, ticking every second —
// mirrors the same heuristic CompactTicketList uses for its "Em direto"
// badges, so this panel never drifts out of sync with them (a server-only
// snapshot would go stale the moment a match crosses into its live window
// without a full page reload).
export default function LiveWidgetsPanel({
  tickets,
  watched,
}: {
  tickets: Ticket[];
  watched: WatchedMatch[];
}) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!now) return null;

  const liveTickets = tickets.filter(
    (t) => !t.live_ended && isMatchLive(t.match_date, t.match_time, now)
  );
  const hasAny = liveTickets.length > 0 || watched.length > 0;

  function handleAdd() {
    setError(null);
    if (!homeTeam.trim() || !awayTeam.trim()) {
      setError("Indica as duas equipas.");
      return;
    }
    startTransition(async () => {
      try {
        await addWatchedMatch(homeTeam, awayTeam);
        setHomeTeam("");
        setAwayTeam("");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível adicionar.");
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      await removeWatchedMatch(id);
    });
  }

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-sky-400">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Ao vivo agora
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-sky-400 hover:underline"
        >
          {open ? "Cancelar" : "+ Adicionar jogo"}
        </button>
      </div>

      {open && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-neutral-400">Equipa da casa</label>
            <input
              type="text"
              value={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
              placeholder="Ex: Real Madrid"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-neutral-400">Equipa de fora</label>
            <input
              type="text"
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              placeholder="Ex: Barcelona"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleAdd}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
          >
            {isPending ? "A adicionar..." : "Adicionar"}
          </button>
          {error && <p className="text-xs text-red-400 sm:w-full">{error}</p>}
        </div>
      )}

      {hasAny && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {liveTickets.map((ticket) => (
            <SportscoreWidget
              key={ticket.id}
              homeTeam={ticket.home_team?.name ?? ""}
              awayTeam={ticket.away_team?.name ?? ""}
            />
          ))}
          {watched.map((w) => (
            <div key={w.id} className="relative">
              <SportscoreWidget homeTeam={w.home_team} awayTeam={w.away_team} />
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRemove(w.id)}
                title="Remover"
                className="absolute right-2 top-2 rounded-full bg-neutral-900/80 p-1.5 text-neutral-400 backdrop-blur transition hover:bg-red-950 hover:text-red-300 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
