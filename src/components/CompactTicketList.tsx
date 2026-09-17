"use client";

import { useTransition } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import { markTicketLiveEnded } from "@/app/(app)/actions";
import type { PickImageItem } from "./PickImages";
import type { BetStatus, BetType } from "@/lib/database.types";

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
  bet_type: BetType;
  odd: number | null;
  odd_min: number | null;
  sofascore_url: string | null;
  bookmaker_url: string | null;
}

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
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

export default function CompactTicketList({
  tickets,
  imagesByPick = {},
}: {
  tickets: Ticket[];
  imagesByPick?: Record<string, PickImageItem[]>;
}) {
  const now = useNow();
  const [isPending, startTransition] = useTransition();

  function handleMarkEnded(ticketId: string) {
    startTransition(async () => {
      await markTicketLiveEnded(ticketId);
    });
  }

  return (
    <div className="space-y-2">
      {tickets.map((ticket) => {
        const live =
          now && !ticket.live_ended ? isMatchLive(ticket.match_date, ticket.match_time, now) : false;
        return (
          <div
            key={ticket.id}
            className="relative rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-700 hover:shadow-lg hover:shadow-black/20 hover:z-20"
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
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleMarkEnded(ticket.id)}
                    title="Marcar jogo como terminado"
                    className="ml-0.5 rounded p-0.5 text-red-400/60 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  >
                    ✕
                  </button>
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
              {ticket.picks.map((pick) => {
                const images = imagesByPick[pick.id] ?? [];
                const hasLinks = Boolean(pick.sofascore_url) || Boolean(pick.bookmaker_url);
                const hasDetails = Boolean(pick.reason) || images.length > 0 || hasLinks;
                return (
                  <div key={pick.id} className="group/pick relative">
                    <div className="flex items-center gap-1.5 text-xs text-neutral-300">
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
                      {hasDetails && (
                        <span aria-hidden className="shrink-0 text-neutral-600">
                          ⓘ
                        </span>
                      )}
                    </div>
                    {hasDetails && (
                      <div className="invisible absolute left-0 top-full z-50 mt-1 w-64 max-w-[80vw] rounded-lg border border-neutral-700 bg-neutral-800 p-2.5 opacity-0 shadow-xl shadow-black/40 transition-all duration-150 group-hover/pick:visible group-hover/pick:opacity-100">
                        {pick.reason && (
                          <p className="mb-2 whitespace-pre-wrap text-xs text-neutral-300">
                            {pick.reason}
                          </p>
                        )}
                        {images.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {images.map((img) => (
                              <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt="Print da aposta"
                                  className="h-16 w-16 rounded-md border border-neutral-700 object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {hasLinks && (
                          <div className="flex flex-wrap gap-3">
                            {pick.sofascore_url && (
                              <a
                                href={pick.sofascore_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:underline"
                              >
                                📊 SofaScore
                              </a>
                            )}
                            {pick.bookmaker_url && (
                              <a
                                href={pick.bookmaker_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:underline"
                              >
                                🎰 Casa de apostas
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
