import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CompactTicketList from "@/components/CompactTicketList";
import StatRanking, { type RankRow } from "@/components/StatRanking";
import PerformanceCalendar from "@/components/PerformanceCalendar";
import LiveClock from "@/components/LiveClock";
import type { BetStatus, BetType } from "@/lib/database.types";

interface Pick {
  id: string;
  selection: string;
  status: BetStatus;
  bet_type: BetType;
  odd: number | null;
  odd_min: number | null;
  category: { id: string; name: string } | null;
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  competition: { id: string; name: string; country: { name: string } | null } | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  picks: Pick[];
}

function todayISODate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function bump(map: Map<string, { green: number; red: number }>, key: string, status: "green" | "red") {
  const entry = map.get(key) ?? { green: 0, red: 0 };
  entry[status]++;
  map.set(key, entry);
}

function toRankedRows(
  map: Map<string, { green: number; red: number }>,
  limit?: number
): RankRow[] {
  const rows = Array.from(map.entries()).map(([label, v]) => ({ label, ...v }));
  rows.sort((a, b) => b.green - a.green || b.green + b.red - (a.green + a.red));
  return limit ? rows.slice(0, limit) : rows;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time,
       competition:competitions(id, name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(id, name),
       away_team:teams!tickets_away_team_id_fkey(id, name),
       picks(id, selection, status, bet_type, odd, odd_min, category:bet_categories(id, name))`
    )
    .order("match_date", { ascending: true })
    .order("match_time", { ascending: true })
    .returns<TicketRow[]>();

  const todayISO = todayISODate();
  const all = tickets ?? [];

  const allPicks = all.flatMap((t) => t.picks);
  const stats = {
    total: allPicks.length,
    green: allPicks.filter((p) => p.status === "green").length,
    red: allPicks.filter((p) => p.status === "red").length,
    pending: allPicks.filter((p) => p.status === "pending").length,
  };

  const todayTickets = all
    .filter((t) => t.match_date === todayISO)
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "pre_jogo") }))
    .filter((t) => t.picks.length > 0);

  const liveTickets = all
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "live") }))
    .filter((t) => t.picks.length > 0);

  const teamMap = new Map<string, { green: number; red: number }>();
  const competitionMap = new Map<string, { green: number; red: number }>();
  const categoryMap = new Map<string, { green: number; red: number }>();
  const dayStats: Record<string, { green: number; red: number }> = {};
  const ticketsByDay: Record<string, typeof todayTickets> = {};

  for (const ticket of all) {
    if (ticket.picks.length === 0) continue;

    (ticketsByDay[ticket.match_date] ??= []).push({ ...ticket, picks: ticket.picks });

    const resolvedPicks = ticket.picks.filter(
      (p) => p.status === "green" || p.status === "red"
    );
    if (resolvedPicks.length === 0) continue;

    const dayEntry = dayStats[ticket.match_date] ?? { green: 0, red: 0 };

    for (const pick of resolvedPicks) {
      const status = pick.status as "green" | "red";
      if (ticket.home_team?.name) bump(teamMap, ticket.home_team.name, status);
      if (ticket.away_team?.name) bump(teamMap, ticket.away_team.name, status);
      if (ticket.competition?.name) bump(competitionMap, ticket.competition.name, status);
      if (pick.category?.name) bump(categoryMap, pick.category.name, status);
      dayEntry[status]++;
    }

    dayStats[ticket.match_date] = dayEntry;
  }

  const topTeams = toRankedRows(teamMap, 5);
  const topCompetitions = toRankedRows(competitionMap, 5);
  const topCategories = toRankedRows(categoryMap, 5);
  const hasPerformanceData = topTeams.length > 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <LiveClock />
        <div className="flex gap-2">
          <Link
            href="/apostas/nova"
            className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
          >
            + Nova aposta
          </Link>
          <Link
            href="/live/nova"
            className="whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500"
          >
            + Vigiar jogo
          </Link>
        </div>
      </div>

      {error && (
        <p className="mb-5 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar dados: {error.message}
        </p>
      )}

      {stats.total > 0 && (
        <div className="mb-6 grid grid-cols-4 gap-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-neutral-100">{stats.total}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Total</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-emerald-400">{stats.green}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Green</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-red-400">{stats.red}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Red</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-neutral-300">{stats.pending}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Pendentes</p>
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">Jogos de hoje</h2>
            <Link href="/apostas" className="text-xs font-medium text-emerald-400 hover:underline">
              Ver todas →
            </Link>
          </div>
          {todayTickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
              Sem apostas pré-jogo registadas para hoje.
            </p>
          ) : (
            <CompactTicketList tickets={todayTickets} />
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-sky-400">🔴 A vigiar em live</h2>
            <Link href="/live" className="text-xs font-medium text-sky-400 hover:underline">
              Ver todas →
            </Link>
          </div>
          {liveTickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
              Sem jogos a vigiar para live.
            </p>
          ) : (
            <CompactTicketList tickets={liveTickets} />
          )}
        </div>
      </div>

      {hasPerformanceData && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">📊 Desempenho</h2>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatRanking title="Equipas" rows={topTeams} />
            <StatRanking title="Competições" rows={topCompetitions} />
            <StatRanking title="Tipos de aposta" rows={topCategories} />
          </div>
          <PerformanceCalendar dayStats={dayStats} ticketsByDay={ticketsByDay} />
        </div>
      )}
    </div>
  );
}
