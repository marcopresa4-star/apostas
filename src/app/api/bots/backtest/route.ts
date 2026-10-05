// Backtest-lite for a bot draft: pre-game filter + scoreline proxy over
// recent finished games. Honest limits, stated in the UI: minute windows and
// live stats never existed for past games, so the score condition is checked
// at half time (1st-half bots) or full time, as a plausibility proxy — never
// as proof the bot would have fired.
import { createClient } from "@/lib/supabase/server";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { pregameOk, scoreOk } from "@/lib/bots";
import type { PlayedMatch } from "@/lib/footballModel";

interface Draft {
  leagues: string[];
  period: "any" | "first" | "second" | "half";
  minute_to: number;
  score: string;
  pregame: { side: "home" | "away" | "either"; metric: "total_over15" | "total_over25" | "btts" | "sh_over05" | "sh_over15"; n: number; pct: number }[];
}

const BACKTEST_GAMES = 40;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const draft = (await request.json().catch(() => null)) as Draft | null;
  if (!draft || !Array.isArray(draft.leagues)) return Response.json({ error: "bad request" }, { status: 400 });

  let tested = 0;
  let passed = 0;
  const examples: { game: string; score: string }[] = [];
  for (const code of draft.leagues.slice(0, 12)) {
    const loaded = await loadSofaLeague(supabase, user.id, code, { history: true, shots: false }).catch(() => null);
    if (!loaded) continue;
    const pool = [...loaded.data.history, ...loaded.data.matches].sort((a, b) => a.date.localeCompare(b.date));
    const recent = pool.slice(-BACKTEST_GAMES);
    for (const g of recent) {
      const before = pool.filter((m) => m.date < g.date);
      if (before.length === 0) continue;
      tested++;
      let ok = true;
      for (const r of draft.pregame) {
        if (!pregameOk(r, before, g.team1, g.team2)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // Scoreline proxy: half-time score for 1st-half bots, full-time else.
      const useHt = draft.period === "first" || draft.period === "half" || draft.minute_to <= 45;
      const s: [number, number] | null = useHt ? (g.ht ?? null) : g.ft;
      if (!s) continue;
      if (!scoreOk(draft.score, s[0], s[1])) continue;
      passed++;
      if (examples.length < 5) examples.push({ game: `${g.team1} vs ${g.team2}`, score: `${s[0]}–${s[1]}` });
    }
  }
  return Response.json({ tested, passed, examples });
}
