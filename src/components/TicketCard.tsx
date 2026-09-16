import Link from "next/link";
import PickCard from "./PickCard";
import AddPickForm from "./AddPickForm";
import DeleteTicketButton from "./DeleteTicketButton";
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
}

interface TicketInfo {
  id: string;
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
}: {
  ticket: TicketInfo;
  picks: Pick[];
  imagesByPick: Map<string, PickImageItem[]>;
  addPickBetType: BetType;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm transition-colors hover:border-neutral-700">
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
          <p className="text-sm text-neutral-400">às {ticket.match_time?.slice(0, 5)}</p>
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
          <PickCard key={pick.id} pick={pick} images={imagesByPick.get(pick.id) ?? []} />
        ))}
      </div>

      <div className="mt-3">
        <AddPickForm ticketId={ticket.id} betType={addPickBetType} />
      </div>
    </div>
  );
}
