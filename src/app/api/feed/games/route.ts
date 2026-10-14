// Followed games for the signed-in user (ids only): lets the global
// FeedWatcher capture snapshots from any site page. Tiny query, cached 60s.
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabase.from("feed_games").select("event_id").eq("user_id", user.id);
  const eventIds = (data ?? [])
    .map((r) => (r as { event_id?: unknown }).event_id)
    .filter((n): n is number => typeof n === "number");
  const { data: favs } = await supabase
    .from("favorite_games")
    .select("event_id, home, away, tournament, promoted_at")
    .eq("user_id", user.id)
    .is("promoted_at", null);
  const favorites = (favs ?? []).flatMap((r) => {
    const f = r as { event_id?: unknown; home?: unknown; away?: unknown; tournament?: unknown; promoted_at?: unknown };
    return typeof f.event_id === "number"
      ? [{ event_id: f.event_id, home: typeof f.home === "string" ? f.home : "", away: typeof f.away === "string" ? f.away : "", tournament: typeof f.tournament === "string" ? f.tournament : "" }]
      : [];
  });
  return Response.json({ eventIds, favorites }, { headers: { "Cache-Control": "private, max-age=60" } });
}
