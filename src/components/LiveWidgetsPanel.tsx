"use client";

import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import SportscoreWidget from "./SportscoreWidget";

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

// Computes "which matches are live" on the client, ticking every second —
// mirrors the same heuristic CompactTicketList uses for its "Em direto"
// badges, so this panel never drifts out of sync with them (a server-only
// snapshot would go stale the moment a match crosses into its live window
// without a full page reload).
export default function LiveWidgetsPanel({ tickets }: { tickets: Ticket[] }) {
  const now = useNow();
  if (!now) return null;

  const live = tickets.filter((t) => isMatchLive(t.match_date, t.match_time, now)).slice(0, 3);
  if (live.length === 0) return null;

  return (
    <aside className="hidden w-80 shrink-0 space-y-4 xl:sticky xl:top-6 xl:block">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-sky-400">
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        Ao vivo agora
      </h2>
      {live.map((ticket) => (
        <SportscoreWidget
          key={ticket.id}
          homeTeam={ticket.home_team?.name ?? ""}
          awayTeam={ticket.away_team?.name ?? ""}
        />
      ))}
    </aside>
  );
}
