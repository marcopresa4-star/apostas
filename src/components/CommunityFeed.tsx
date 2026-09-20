"use client";

import { useNow } from "@/lib/useNow";
import { isMatchOver } from "@/lib/matchStatus";
import { isMultipleOver, type MultipleRow } from "@/lib/multiples";
import CommunityTicket from "./CommunityTicket";
import MultipleCard from "./MultipleCard";
import LiveAlerts from "./LiveAlerts";
import GameStartNotifications from "./GameStartNotifications";
import type { PickImageItem } from "./PickImages";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";

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
  stage: PickStage;
  odd: number | null;
  odd_min: number | null;
  entry_odd: number | null;
  entry_minute: number | null;
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

const EMPTY_BOX =
  "rounded-2xl border border-dashed border-neutral-800 px-4 py-10 text-center text-neutral-500";

export default function CommunityFeed({
  tickets,
  multiples,
  imagesByPick,
}: {
  tickets: TicketRow[];
  multiples: MultipleRow[];
  imagesByPick: Record<string, PickImageItem[]>;
}) {
  // Checked with the browser clock, like the "Em direto" badge, so a game
  // leaves the feed at the same moment that badge would switch off.
  const now = useNow(30_000);
  if (!now) return null;

  // Finished games leave the feed but stay published: the Análise da
  // Comunidade reads every published pick, so their results keep counting.
  const running = tickets.filter(
    (t) => !isMatchOver(t.match_date, t.match_time, t.live_ended, now)
  );

  // A ticket can hold picks of several kinds, so each section keeps only
  // its own picks. "Não entrei" picks are unpublished when marked, but the
  // filter below is a second safety net so they can never show up here.
  function ticketsWith(match: (p: Pick) => boolean) {
    return running
      .map((t) => ({ ...t, picks: t.picks.filter((p) => p.stage !== "skipped" && match(p)) }))
      .filter((t) => t.picks.length > 0);
  }

  // A multiple stays until its last game is over. A live one is only ever
  // shared once entered, so it belongs with the active live bets.
  const runningMultiples = multiples.filter((m) => !isMultipleOver(m.legs, now));
  const preJogoMultiples = runningMultiples.filter((m) => m.bet_type === "pre_jogo");
  const liveMultiples = runningMultiples.filter((m) => m.bet_type === "live");

  const preJogoTickets = ticketsWith((p) => p.bet_type === "pre_jogo");
  const activeLiveTickets = ticketsWith((p) => p.bet_type === "live" && p.stage === "active");
  const watchingTickets = ticketsWith((p) => p.bet_type === "live" && p.stage === "watching");

  return (
    <>
      {/* "O jogo começou!" for every shared game still in the feed, sitting
          above the orange new-bet toast so the two never overlap. */}
      <GameStartNotifications tickets={running} positionClass="bottom-24" />

      {/* "Chegou ao minuto X" for the published games being watched, the same
          banner the admin gets on the Dashboard. */}
      <LiveAlerts tickets={watchingTickets} />

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-emerald-400">🎟️ Apostas</h2>
        {preJogoTickets.length === 0 && preJogoMultiples.length === 0 ? (
          <p className={EMPTY_BOX}>Sem apostas partilhadas de jogos por acabar.</p>
        ) : (
          <div className="space-y-3">
            {preJogoMultiples.map((multiple) => (
              <MultipleCard key={multiple.id} multiple={multiple} readOnly />
            ))}
            {preJogoTickets.map((ticket) => (
              <CommunityTicket key={ticket.id} ticket={ticket} imagesByPick={imagesByPick} />
            ))}
          </div>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-emerald-400">🔥 Ativas em live</h2>
        {activeLiveTickets.length === 0 && liveMultiples.length === 0 ? (
          <p className={EMPTY_BOX}>Sem apostas live ativas partilhadas.</p>
        ) : (
          <div className="space-y-3">
            {liveMultiples.map((multiple) => (
              <MultipleCard key={multiple.id} multiple={multiple} readOnly />
            ))}
            {activeLiveTickets.map((ticket) => (
              <CommunityTicket key={ticket.id} ticket={ticket} imagesByPick={imagesByPick} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-sky-400">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          A vigiar em live
        </h2>
        {watchingTickets.length === 0 ? (
          <p className={EMPTY_BOX}>Sem jogos a vigiar partilhados.</p>
        ) : (
          <div className="space-y-3">
            {watchingTickets.map((ticket) => (
              <CommunityTicket key={ticket.id} ticket={ticket} imagesByPick={imagesByPick} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
