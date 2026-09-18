import type { RankRow } from "@/components/StatRanking";
import type { BetStatus, PickStage } from "@/lib/database.types";

interface Tally {
  green: number;
  red: number;
}

interface AnalysisTicket {
  match_date: string;
  competition: { name: string } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: {
    status: BetStatus;
    stage: PickStage;
    category: { name: string } | null;
  }[];
}

function bump(map: Map<string, Tally>, key: string, status: "green" | "red") {
  const entry = map.get(key) ?? { green: 0, red: 0 };
  entry[status]++;
  map.set(key, entry);
}

function toRankedRows(map: Map<string, Tally>, limit?: number): RankRow[] {
  const rows = Array.from(map.entries()).map(([label, v]) => ({ label, ...v }));
  rows.sort((a, b) => b.green - a.green || b.green + b.red - (a.green + a.red));
  return limit ? rows.slice(0, limit) : rows;
}

// Shared by the private Análise page and the Comunidade one, so both rank
// and colour the calendar the same way.
export function buildAnalysis<T extends AnalysisTicket>(tickets: T[]) {
  const teamMap = new Map<string, Tally>();
  const competitionMap = new Map<string, Tally>();
  const categoryMap = new Map<string, Tally>();
  const dayStats: Record<string, Tally> = {};
  const ticketsByDay: Record<string, T[]> = {};

  for (const ticket of tickets) {
    // Only picks you actually entered count as bets; watching ideas and
    // "não entrei" never reach the analysis.
    const activePicks = ticket.picks.filter((p) => p.stage === "active");
    if (activePicks.length === 0) continue;

    (ticketsByDay[ticket.match_date] ??= []).push({ ...ticket, picks: activePicks });

    const resolvedPicks = activePicks.filter(
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

  return {
    topTeams: toRankedRows(teamMap, 5),
    topCompetitions: toRankedRows(competitionMap, 5),
    topCategories: toRankedRows(categoryMap, 5),
    dayStats,
    ticketsByDay,
  };
}
