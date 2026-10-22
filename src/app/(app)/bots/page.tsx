import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import BotsClient, { type BotRow, type AlertRow } from "@/components/BotsClient";
import { goalsNeutral } from "@/lib/bots";

export default async function BotsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int.")).map((l) => ({
    code: l.code,
    label: l.label as string,
  }));

  const { data: botsRaw } = await supabase
    .from("bots")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<(Omit<BotRow, "goals"> & { goal_rules?: unknown })[]>();
  // DB column is goal_rules; the Bot type calls it goals.
  const bots = (botsRaw ?? []).map((b) => ({ ...b, goals: goalsNeutral(b.goal_rules) }));
  const { data: alerts } = await supabase
    .from("bot_alerts")
    .select("id, bot_id, market, text, minute, home, away, hg, ag, hit, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40)
    .returns<AlertRow[]>();
  // Per-bot totals across the WHOLE alert history (the list above is capped
  // at 40 for showing): only two light columns, grouped here.
  const { data: tally } = await supabase
    .from("bot_alerts")
    .select("bot_id, hit")
    .eq("user_id", user.id)
    .returns<{ bot_id: string; hit: boolean | null }[]>();
  const alertStats: Record<string, { total: number; hits: number; reds: number; pending: number }> = {};
  for (const t of tally ?? []) {
    const s = (alertStats[t.bot_id] ??= { total: 0, hits: 0, reds: 0, pending: 0 });
    s.total++;
    if (t.hit === true) s.hits++;
    else if (t.hit === false) s.reds++;
    else s.pending++;
  }

  return (
    <div data-wide>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">🤖 <span className="title-glow">Bots</span></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Robôs que vigiam jogos ao vivo e avisam quando as tuas condições se verificam — em qualquer página do site,
        com um separador aberto. De browser fechado nada corre (não há servidor sempre-ligado), nem há push para o
        telemóvel: o alerta é do browser.
      </p>
      <BotsClient bots={bots ?? []} alerts={alerts ?? []} alertStats={alertStats} leagues={leagues} />
    </div>
  );
}
