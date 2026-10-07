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
  return Response.json({ eventIds }, { headers: { "Cache-Control": "private, max-age=60" } });
}
