"use client";

import Link from "next/link";
import PickCard from "./PickCard";
import AddPickForm from "./AddPickForm";
import DeleteTicketButton from "./DeleteTicketButton";
import type { PickImageItem } from "./PickImages";
import type { TagItem } from "./CategoryCombobox";
import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import { useSportscoreLive } from "@/lib/useSportscoreLive";
import type { BetStatus, BetType } from "@/lib/database.types";

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
  bet_type: BetType;
  odd: number | null;
  odd_min: number | null;
  alert_minute: number | null;
  sofascore_url: string | null;
  bookmaker_url: string | null;
  category: { id: string; name: string } | null;
}

interface TicketInfo {
  id: string;
  match_date: string;
  match_time: string;
  competition: { name: string; country: { name: string } | null } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

export default function TicketCard({
  ticket,
  picks,
  imagesByPick,
  addPickBetType,
  initialCategories,
}: {
  ticket: TicketInfo;
  picks: Pick[];
  imagesByPick: Record<string, PickImageItem[]>;
  addPickBetType: BetType;
  initialCategories: TagItem[];
}) {
  const now = useNow();
  const heuristicLive = now ? isMatchLive(ticket.match_date, ticket.match_time, now) : false;
  const liveData = useSportscoreLive(
    heuristicLive ? (ticket.home_team?.name ?? null) : null,
    heuristicLive ? (ticket.away_team?.name ?? null) : null
  );
  const live = liveData ? liveData.isLive : heuristicLive;
  const liveScore =
    liveData?.isLive && liveData.homeScore !== null && liveData.awayScore !== null
      ? `${liveData.homeScore}-${liveData.awayScore}`
      : null;

  return (
    <div className="relative rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-700 hover:shadow-lg hover:shadow-black/20 hover:z-20">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wide text-neutral-500">
            {ticket.competition?.name}
            {ticket.competition?.country?.name ? ` · ${ticket.competition.country.name}` : ""}
          </p>
          <p className="break-words text-base font-medium text-neutral-100">
            {ticket.home_team?.name} <span className="text-neutral-500">vs</span>{" "}
            {ticket.away_team?.name}
          </p>
          <p className="flex items-center gap-2 text-sm text-neutral-400">
            <span>às {ticket.match_time?.slice(0, 5)}</span>
            {live && (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {liveData?.isLive && liveData.minuteLabel
                  ? /^\d+$/.test(liveData.minuteLabel)
                    ? `${liveData.minuteLabel}'`
                    : liveData.minuteLabel
                  : "Em direto"}
                {liveScore && <span className="text-neutral-300">· {liveScore}</span>}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/apostas/${ticket.id}/editar`}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-300"
          >
            Editar jogo
          </Link>
          <DeleteTicketButton ticketId={ticket.id} />
        </div>
      </div>

      <div className="space-y-2">
        {picks.map((pick) => (
          <PickCard
            key={pick.id}
            pick={pick}
            images={imagesByPick[pick.id] ?? []}
            initialCategories={initialCategories}
          />
        ))}
      </div>

      <div className="mt-3">
        <AddPickForm
          ticketId={ticket.id}
          betType={addPickBetType}
          initialCategories={initialCategories}
        />
      </div>
    </div>
  );
}
