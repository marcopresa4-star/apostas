"use client";

import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import type { BetStatus, BetType } from "@/lib/database.types";

interface Pick {
  id: string;
  selection: string;
  status: BetStatus;
  bet_type: BetType;
  odd: number | null;
  odd_min: number | null;
}

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  competition: { name: string } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: Pick[];
}

const DOT: Record<BetStatus, string> = {
  pending: "bg-neutral-500",
  green: "bg-emerald-400",
  red: "bg-red-400",
  void: "bg-amber-400",
};

export default function CompactTicketList({ tickets }: { tickets: Ticket[] }) {
  const now = useNow();

  return (
    <div className="space-y-2">
      {tickets.map((ticket) => {
        const live = now ? isMatchLive(ticket.match_date, ticket.match_time, now) : false;
        return (
          <div
            key={ticket.id}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-neutral-100">
                {ticket.home_team?.name} <span className="text-neutral-500">vs</span>{" "}
                {ticket.away_team?.name}
              </p>
              {live ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-400">
                  <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  Em direto
                </span>
              ) : (
                <span className="shrink-0 text-xs text-neutral-500">
                  {ticket.match_time?.slice(0, 5)}
                </span>
              )}
            </div>
            <p className="mb-1.5 truncate text-[11px] uppercase tracking-wide text-neutral-500">
              {ticket.competition?.name}
            </p>
            <div className="space-y-1">
              {ticket.picks.map((pick) => (
                <div key={pick.id} className="flex items-center gap-1.5 text-xs text-neutral-300">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[pick.status]}`}
                  />
                  {pick.bet_type === "live" && (
                    <span className="shrink-0 rounded bg-sky-950 px-1 text-[9px] font-semibold text-sky-300">
                      LIVE
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{pick.selection}</span>
                  {pick.odd !== null && (
                    <span className="shrink-0 text-neutral-500">@{pick.odd.toFixed(2)}</span>
                  )}
                  {pick.odd_min !== null && (
                    <span className="shrink-0 text-neutral-500">≥{pick.odd_min.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
