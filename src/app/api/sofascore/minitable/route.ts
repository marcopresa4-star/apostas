import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { seasonStandingsTables } from "@/lib/sofaHistory";
import { sofaRaw, ScraperOffline } from "@/lib/sofaRaw";

// Mini standings for a live game (pinned-card "Tabela" tab): resolves the
// event's tournament + season, then serves the official table (cached 12h
// underneath). Team matching happens client-side: names never fully agree.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    const raw = await fetch(`${SCRAPER}/event?id=${id}&light=1`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (raw.status === 404) return Response.json({ error: "notfound" }, { status: 404 });
    if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
    body = await raw.json();
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  const root = (body ?? {}) as Json;
  const event = obj(root.event ?? root) ?? {};
  const tournament = obj(event.tournament) ?? {};
  const unique = obj(tournament.uniqueTournament) ?? {};
  const uniqueId = typeof unique.id === "number" ? unique.id : null;
  const season = obj(event.season) ?? {};
  const seasonId = typeof season.id === "number" ? season.id : null;
  if (uniqueId === null || seasonId === null) return Response.json({ error: "unparseable" }, { status: 502 });
  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const league = maps.find((m) => m.sofascore_id === uniqueId);
  let tables;
  try {
    tables = await seasonStandingsTables(supabase, user.id, uniqueId, seasonId, true);
  } catch (err) {
    if (err instanceof ScraperOffline) return Response.json({ error: "scraper-offline" }, { status: 503 });
    return Response.json({ error: "upstream" }, { status: 502 });
  }
  const rows = tables.flatMap((t) =>
    t.rows.map((r) => ({
      table: t.name,
      position: r.position,
      team: r.team,
      played: r.played,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      points: r.points,
    }))
  );
  return Response.json(
    { league: league?.name_key ?? null, leagueLabel: tournament?.name ?? null, rows },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
