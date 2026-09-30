// Anytime-scorer prices for one event's probable starters, from each
// player's own season rate (xG first, goals when the feed carries no xG).
// 404 (no lineups: too far out, uncovered game) -> empty sides, so the UI
// hides the section.
import { createClient } from "@/lib/supabase/server";
import { scorersFor } from "@/lib/sofaScorers";
import { ScraperOffline } from "@/lib/sofaRaw";

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
  let out;
  try {
    out = await scorersFor(supabase, user.id, id);
  } catch (err) {
    if (err instanceof ScraperOffline) {
      return Response.json({ error: "scraper-offline" }, { status: 503 });
    }
    return Response.json({ error: "upstream" }, { status: 502 });
  }
  if (!out) return Response.json({ eventId: id, home: [], away: [] });
  return Response.json({ eventId: id, ...out }, { headers: { "Cache-Control": "private, max-age=300" } });
}
