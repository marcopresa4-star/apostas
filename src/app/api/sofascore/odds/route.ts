// Real bookmaker odds of one event (1X2, BTTS, over/under lines...), from
// SofaScore's odds feed via the local scraper. 404 (game not priced: too far
// out, or a league the bookmakers skip) -> { markets: [] }, so the UI falls
// back to typing the odd by hand.
import { createClient } from "@/lib/supabase/server";
import { eventOdds } from "@/lib/sofaOdds";
import { ScraperOffline } from "@/lib/sofaRaw";

const MINUTE_MS = 60_000;

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
  let parsed;
  try {
    parsed = await eventOdds(supabase, user.id, id, MINUTE_MS);
  } catch (err) {
    if (err instanceof ScraperOffline) {
      return Response.json({ error: "scraper-offline" }, { status: 503 });
    }
    return Response.json({ error: "upstream" }, { status: 502 });
  }
  // Null means the game has no prices (too far out, uncovered league): an
  // empty list, not an outage — the UI falls back to typing the odd by hand.
  if (!parsed) return Response.json({ eventId: id, live: false, markets: [] });
  return Response.json(parsed, { headers: { "Cache-Control": "private, max-age=60" } });
}
