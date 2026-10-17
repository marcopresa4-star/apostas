// Live 1X2 for a batch of games in one request: the Ao vivo board asks for
// the rows it rendered after render, so a busy scraper never holds the table
// (server render stands without odds). Every id goes through the eventOdds
// cache (60s TTL live) — refreshes inside the minute replay the same cached
// prices, and the scraper's queue spreads the reads over its own slots.
import { createClient } from "@/lib/supabase/server";
import { eventOdds } from "@/lib/sofaOdds";

// One auto-refresh cycle every 60s re-asks for the board's first rows; 40
// keeps a cycle well under the minute even on a cold odds cache.
const CAP = 40;

export async function GET(request: Request) {
  const ids = new URL(request.url).searchParams.get("ids") ?? "";
  const list = ids
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, CAP);
  if (list.length === 0) return Response.json({ odds: {} });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const odds: Record<string, [number, number, number] | null> = {};
  await Promise.all(
    list.map(async (id) => {
      try {
        const parsed = await eventOdds(supabase, user.id, id, 60_000);
        odds[String(id)] = null;
        if (!parsed) return;
        const byKey: Record<string, number> = {};
        for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
        if (byKey["ft:home"] && byKey["ft:draw"] && byKey["ft:away"]) {
          odds[String(id)] = [byKey["ft:home"], byKey["ft:draw"], byKey["ft:away"]];
        }
      } catch {
        // Scraper hiccup: leave the price absent — the row stands without it.
        delete odds[String(id)];
      }
    })
  );
  return Response.json({ odds }, { headers: { "Cache-Control": "private, max-age=30" } });
}
