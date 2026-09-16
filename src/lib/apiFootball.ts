const BASE_URL = "https://v3.football.api-sports.io";

export interface AFLeague {
  id: number;
  name: string;
  country: string;
  logo: string;
}

export interface AFTeam {
  id: number;
  name: string;
  country: string;
  logo: string;
}

export interface AFFixture {
  fixtureId: number;
  date: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  statusShort: string;
}

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

export interface AFStandingRow {
  rank: number;
  teamId: number;
  teamName: string;
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsDiff: number;
}

// The API-Football Free plan only allows querying these seasons (confirmed
// against a live account: newer seasons return a "plan" error). Update this
// list if the account is ever upgraded to a plan with current-season access.
export const AVAILABLE_SEASONS = [2024, 2023, 2022] as const;
export const DEFAULT_SEASON = AVAILABLE_SEASONS[0];

async function apiFootballFetch<T>(path: string, params: Record<string, string | number>) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY não está configurada.");
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
    next: { revalidate: 3600 },
  });

  if (res.status === 429) {
    throw new Error("Limite diário/por minuto da API-Football atingido. Tenta mais tarde.");
  }
  if (!res.ok) {
    throw new Error(`API-Football devolveu ${res.status}.`);
  }

  const json = (await res.json()) as { response: T; errors: unknown };
  if (json.errors && Array.isArray(json.errors) ? json.errors.length > 0 : Boolean(json.errors)) {
    throw new Error("API-Football devolveu um erro (verifica a chave ou o limite diário).");
  }

  return json.response;
}

export async function searchLeagues(query: string): Promise<AFLeague[]> {
  if (query.trim().length < 3) return [];
  type Raw = { league: { id: number; name: string; logo: string }; country: { name: string } };
  const data = await apiFootballFetch<Raw[]>("/leagues", { search: query.trim() });
  return data
    .filter((r) => r.league.id)
    .slice(0, 20)
    .map((r) => ({
      id: r.league.id,
      name: r.league.name,
      country: r.country?.name ?? "",
      logo: r.league.logo,
    }));
}

export async function searchTeams(query: string): Promise<AFTeam[]> {
  if (query.trim().length < 3) return [];
  type Raw = { team: { id: number; name: string; logo: string; country?: string } };
  const data = await apiFootballFetch<Raw[]>("/teams", { search: query.trim() });
  return data.slice(0, 20).map((r) => ({
    id: r.team.id,
    name: r.team.name,
    country: r.team.country ?? "",
    logo: r.team.logo,
  }));
}

type RawFixture = {
  fixture: { id: number; date: string; status: { short: string } };
  league: { name: string };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
};

function mapFixtures(data: RawFixture[]): AFFixture[] {
  return data.map((f) => ({
    fixtureId: f.fixture.id,
    date: f.fixture.date,
    leagueName: f.league.name,
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
    statusShort: f.fixture.status.short,
  }));
}

// The Free plan does not support the "last" query param on /fixtures or
// /fixtures/headtohead, so we always fetch the broader result set and take
// the most recent finished matches ourselves.
function mostRecentFinished(fixtures: AFFixture[], count: number): AFFixture[] {
  return fixtures
    .filter((f) => FINISHED_STATUSES.has(f.statusShort))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, count);
}

export async function getRecentForm(
  teamId: number,
  season: number,
  last = 5
): Promise<AFFixture[]> {
  const data = await apiFootballFetch<RawFixture[]>("/fixtures", {
    team: teamId,
    season,
  });
  return mostRecentFinished(mapFixtures(data), last);
}

export async function getHeadToHead(
  homeTeamId: number,
  awayTeamId: number,
  last = 5
): Promise<AFFixture[]> {
  const data = await apiFootballFetch<RawFixture[]>("/fixtures/headtohead", {
    h2h: `${homeTeamId}-${awayTeamId}`,
  });
  return mostRecentFinished(mapFixtures(data), last);
}

export async function getStandings(leagueId: number, season: number): Promise<AFStandingRow[]> {
  type Raw = {
    league: {
      standings: {
        rank: number;
        team: { id: number; name: string };
        points: number;
        all: { played: number; win: number; draw: number; lose: number };
        goalsDiff: number;
      }[][];
    };
  };
  const data = await apiFootballFetch<Raw[]>("/standings", { league: leagueId, season });
  const table = data[0]?.league?.standings?.[0] ?? [];
  return table.map((row) => ({
    rank: row.rank,
    teamId: row.team.id,
    teamName: row.team.name,
    points: row.points,
    played: row.all.played,
    win: row.all.win,
    draw: row.all.draw,
    lose: row.all.lose,
    goalsDiff: row.goalsDiff,
  }));
}
