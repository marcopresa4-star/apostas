// The games already added to the Dashboard, as choices for the live calculator:
// a game with at least one bet still open, or one game of a multiple still open,
// from yesterday on (a game is live for about two hours).

interface TeamRef {
  id: string;
  name: string;
  aliases?: string | null;
}

export interface TicketIn {
  id: string;
  match_date: string;
  match_time: string;
  competition: { name: string } | null;
  home_team: TeamRef | null;
  away_team: TeamRef | null;
  picks: { stage: string; status: string }[];
}

export interface LegIn {
  id: string;
  status: string;
  match_date: string;
  match_time: string;
  competition: { name: string } | null;
  home_team: TeamRef | null;
  away_team: TeamRef | null;
}

export interface MultipleIn {
  legs: LegIn[];
}

export interface DashboardGame {
  id: string; // "t:<ticket>" or "l:<leg of a multiple>"
  date: string;
  time: string;
  competition: string;
  home: string;
  away: string;
  // The name and the other names each club goes by ("Sporting CP | Sporting").
  homeNames: string[];
  awayNames: string[];
}

const names = (team: TeamRef): string[] => [
  team.name,
  ...(team.aliases ?? "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean),
];

const MAX_GAMES = 30;

// `since` is a date (YYYY-MM-DD); soonest kickoff first.
export function dashboardGames(tickets: TicketIn[], multiples: MultipleIn[], since: string): DashboardGame[] {
  const out: DashboardGame[] = [];
  const seen = new Set<string>();
  const add = (id: string, g: Omit<DashboardGame, "id" | "home" | "away" | "homeNames" | "awayNames"> & { home: TeamRef | null; away: TeamRef | null }) => {
    if (!g.home || !g.away) return;
    const key = `${g.home.id}|${g.away.id}|${g.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id,
      date: g.date,
      time: g.time,
      competition: g.competition,
      home: g.home.name,
      away: g.away.name,
      homeNames: names(g.home),
      awayNames: names(g.away),
    });
  };

  for (const t of tickets) {
    if (t.match_date < since) continue;
    if (!t.picks.some((p) => p.stage !== "skipped" && p.status === "pending")) continue;
    add(`t:${t.id}`, { date: t.match_date, time: t.match_time, competition: t.competition?.name ?? "", home: t.home_team, away: t.away_team });
  }
  for (const m of multiples) {
    for (const leg of m.legs) {
      if (leg.status !== "pending" || leg.match_date < since) continue;
      add(`l:${leg.id}`, { date: leg.match_date, time: leg.match_time, competition: leg.competition?.name ?? "", home: leg.home_team, away: leg.away_team });
    }
  }
  return out
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, MAX_GAMES);
}
