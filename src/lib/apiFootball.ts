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
      country: r.country?.name ?? "World",
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
    country: r.team.country ?? "World",
    logo: r.team.logo,
  }));
}
