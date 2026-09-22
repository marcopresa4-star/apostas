import {
  leagueRates,
  resultFor,
  seasonOf,
  strengthOf,
  type Fixture,
  type LeagueRates,
  type PlayedMatch,
} from "./footballModel";

// One of a team's last games, for the form chips: what it was and how it went.
export interface FormGame {
  result: "V" | "E" | "D";
  date: string;
  opponent: string;
  home: boolean; // whether the team was at home
  gf: number;
  ga: number;
}

export interface StandingRow {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  // The last five games, most recent first.
  form: FormGame[];
}

// The league table of the season from its played games (3 points for a win, 1
// for a draw). Ties go by goal difference, then goals scored, then name, which
// is not every league's rule but is close enough to read the season.
export function buildStandings(fixtures: Fixture[]): StandingRow[] {
  const teams = [...new Set(fixtures.flatMap((f) => [f.team1, f.team2]))];
  const rows = teams.map((team): StandingRow => {
    const played = seasonOf(fixtures, team).filter((f) => f.ft);
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let gf = 0;
    let ga = 0;
    const results: FormGame[] = [];
    for (const f of played) {
      const home = f.team1 === team;
      const scored = home ? f.ft![0] : f.ft![1];
      const conceded = home ? f.ft![1] : f.ft![0];
      gf += scored;
      ga += conceded;
      const r = resultFor(f, team)!;
      results.push({ result: r, date: f.date, opponent: home ? f.team2 : f.team1, home, gf: scored, ga: conceded });
      if (r === "V") wins++;
      else if (r === "E") draws++;
      else losses++;
    }
    return {
      team,
      played: played.length,
      wins,
      draws,
      losses,
      gf,
      ga,
      gd: gf - ga,
      points: wins * 3 + draws,
      form: results.slice(-5).reverse(),
    };
  });
  return rows.sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)
  );
}

export interface Rating {
  team: string;
  attack: number; // 1 = league average, above 1 scores more
  defense: number; // 1 = league average, below 1 concedes less
  // Expected goals scored minus conceded per game against an average side.
  goalDiff: number;
  games: number; // games behind the figures, over all the seasons in the data
}

// How strong each team is at scoring and defending, from the same figures the
// probabilities use (recent games weigh more, and few games pull a team
// towards the average).
export function ratings(
  matches: PlayedMatch[],
  teams: string[],
  now: Date
): { rates: LeagueRates; rows: Rating[] } {
  const rates = leagueRates(matches, now);
  const rows = teams.map((team): Rating => {
    const s = strengthOf(matches, team, rates, now);
    return {
      team,
      attack: s.attack,
      defense: s.defense,
      goalDiff: rates.perTeam * (s.attack - s.defense),
      games: s.games,
    };
  });
  return { rates, rows };
}
