import type { RankRow } from "@/components/StatRanking";
import type { BetStatus, PickStage } from "@/lib/database.types";
import { greenWeight, redWeight } from "@/lib/betResult";

// Fractional on purpose: a half win / half loss counts as 0.5.
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

function bump(map: Map<string, Tally>, key: string, green: number, red: number) {
  const entry = map.get(key) ?? { green: 0, red: 0 };
  entry.green += green;
  entry.red += red;
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

    // Green, red and their half versions; pending and Devolvida never count.
    const resolvedPicks = activePicks.filter(
      (p) => greenWeight(p.status) > 0 || redWeight(p.status) > 0
    );
    if (resolvedPicks.length === 0) continue;

    const dayEntry = dayStats[ticket.match_date] ?? { green: 0, red: 0 };

    for (const pick of resolvedPicks) {
      const green = greenWeight(pick.status);
      const red = redWeight(pick.status);
      if (ticket.home_team?.name) bump(teamMap, ticket.home_team.name, green, red);
      if (ticket.away_team?.name) bump(teamMap, ticket.away_team.name, green, red);
      if (ticket.competition?.name) bump(competitionMap, ticket.competition.name, green, red);
      if (pick.category?.name) bump(categoryMap, pick.category.name, green, red);
      dayEntry.green += green;
      dayEntry.red += red;
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
