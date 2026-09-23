// Pre-match expectation for one event, so dashboard widgets can run the live
// model on any game: resolves the event's league, predicts with the model and
// returns each side's expected goals. Unmapped leagues (or unknown teams) get
// typical figures, flagged as such.
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { leagueRates, predict } from "@/lib/footballModel";
import { sofaRaw } from "@/lib/sofaRaw";

const TYPICAL = { home: 1.4, away: 1.1, firstHalfShare: 0.44, avgGoals: null as number | null };

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
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
    body = await sofaRaw<unknown>(`/event/${id}`);
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  const root = (body ?? {}) as Record<string, unknown>;
  const event = (root.event ?? root) as Record<string, unknown>;
  const homeSofa = ((event.homeTeam ?? {}) as Record<string, unknown>).name;
  const awaySofa = ((event.awayTeam ?? {}) as Record<string, unknown>).name;
  const unique = (((event.tournament ?? {}) as Record<string, unknown>).uniqueTournament ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof homeSofa !== "string" || typeof awaySofa !== "string") {
    return Response.json({ error: "unparseable" }, { status: 502 });
  }
  const tournaments = await loadMaps(supabase, user.id, "tournament");
  const code = typeof unique.id === "number" ? (tournaments.find((m) => m.sofascore_id === unique.id)?.name_key ?? null) : null;
  if (!code) return Response.json({ ...TYPICAL, fromModel: false, league: null });
  const loaded = await loadSofaLeague(supabase, user.id, code).catch(() => null);
  if (!loaded) return Response.json({ ...TYPICAL, fromModel: false, league: null });
  const teams = await loadMaps(supabase, user.id, "team");
  const toLocal = new Map(teams.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const casa = toLocal.get(homeSofa) ?? homeSofa;
  const fora = toLocal.get(awaySofa) ?? awaySofa;
  if (!loaded.data.teams.includes(casa) || !loaded.data.teams.includes(fora)) {
    return Response.json({ ...TYPICAL, fromModel: false, league: null });
  }
  const now = new Date();
  const prediction = predict(loaded.data.matches, casa, fora, now);
  const rates = leagueRates(loaded.data.matches, now);
  return Response.json(
    {
      home: prediction.lambdaHome,
      away: prediction.lambdaAway,
      firstHalfShare: rates.firstHalfShare,
      avgGoals: Math.round(rates.perTeam * 2 * 100) / 100,
      fromModel: true,
      league: code,
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
