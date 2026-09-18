"use client";

import { useNow } from "@/lib/useNow";
import { isMatchLive, getCountdownClock } from "@/lib/matchStatus";
import type { PickImageItem } from "./PickImages";
import type { BetStatus, BetType } from "@/lib/database.types";

interface PickImageRow {
  id: string;
  image_path: string;
}

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
  bet_type: BetType;
  odd: number | null;
  odd_min: number | null;
  alert_minute: number | null;
  category: { name: string } | null;
  pick_images: PickImageRow[];
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  competition: { name: string; country: { name: string } | null } | null;
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

export default function CommunityTicket({
  ticket,
  imagesByPick,
}: {
  ticket: TicketRow;
  imagesByPick: Record<string, PickImageItem[]>;
}) {
  const now = useNow();
  const live =
    now && !ticket.live_ended ? isMatchLive(ticket.match_date, ticket.match_time, now) : false;
  const countdown = now && !live ? getCountdownClock(ticket.match_date, ticket.match_time, now) : null;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
      <p className="truncate text-xs uppercase tracking-wide text-neutral-500">
        {ticket.competition?.name}
        {ticket.competition?.country?.name ? ` · ${ticket.competition.country.name}` : ""}
      </p>
      <p className="mb-1 break-words text-base font-medium text-neutral-100">
        {ticket.home_team?.name} <span className="text-neutral-500">vs</span> {ticket.away_team?.name}
      </p>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
        <span>
          {new Date(`${ticket.match_date}T00:00:00`).toLocaleDateString("pt-PT")} · às{" "}
          {ticket.match_time?.slice(0, 5)}
        </span>
        {live && (
          <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Em direto
          </span>
        )}
        {countdown && (
          <span className="flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-red-400">
            <span aria-hidden>⏱</span> {countdown}
          </span>
        )}
      </p>
      <div className="space-y-2">
        {ticket.picks.map((pick) => {
          const images = imagesByPick[pick.id] ?? [];
          return (
            <div key={pick.id} className="rounded-lg bg-neutral-950 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[pick.status]}`} />
                {pick.bet_type === "live" && (
                  <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                    LIVE
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                  {pick.selection}
                </span>
                {pick.bet_type === "pre_jogo" && pick.odd !== null && (
                  <span className="shrink-0 text-xs text-neutral-500">@ {pick.odd.toFixed(2)}</span>
                )}
                {pick.bet_type === "live" && pick.odd_min !== null && (
                  <span className="shrink-0 text-xs text-neutral-500">
                    entra a partir de {pick.odd_min.toFixed(2)}
                  </span>
                )}
                {pick.bet_type === "live" && pick.alert_minute !== null && (
                  <span className="shrink-0 text-xs text-amber-400">🔔 min {pick.alert_minute}</span>
                )}
              </div>
              {pick.reason && <p className="mb-2 text-sm text-neutral-300">{pick.reason}</p>}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt="Print da aposta"
                        className="h-20 w-20 rounded-md border border-neutral-700 object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
