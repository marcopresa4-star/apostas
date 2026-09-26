// Open watched bets for the global watcher (auth required).
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabase
    .from("bets")
    .select("id, home_team, away_team, market_key, market_label, odd, sofascore_id, kickoff, target_odd, target_minute")
    .eq("user_id", user.id)
    .eq("kind", "watch")
    .eq("status", "open");
  return Response.json({ bets: data ?? [] }, { headers: { "Cache-Control": "private, max-age=30" } });
}
