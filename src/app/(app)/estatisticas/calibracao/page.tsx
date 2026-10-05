import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { loadSofaInternational } from "@/lib/sofaIntl";
import { settleWon } from "@/lib/bets";
import EstatisticasTabs from "@/components/EstatisticasTabs";

interface Row {
  league: string;
  home: string;
  away: string;
  match_date: string;
  pick_key: string;
  pick_group: string;
  label: string;
  p: number;
  base: number;
  fair: number;
  result: "won" | "lost" | "void" | null;
  settled_at: string | null;
  created_at: string;
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const odd = (n: number): string => (Number.isFinite(n) && n > 1 ? `@${n.toFixed(2).replace(".", ",")}` : "—");

// Settles what gained a result since it was logged: the first same-orientation
// fixture on or after the game's date. Keys that cannot settle alone
// (quarter lines stay manual, halves need an interval score the calendar
// never has) keep waiting instead of guessing.
async function settlePending(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  pending: Row[]
): Promise<number> {
  const byLeague = new Map<string, Row[]>();
  for (const r of pending) {
    const list = byLeague.get(r.league) ?? [];
    list.push(r);
    byLeague.set(r.league, list);
  }
  let settled = 0;
  for (const [code, rows] of byLeague) {
    let pool: { date: string; team1: string; team2: string; ft: [number, number] }[] = [];
    try {
      if (isInternational(code)) {
        const s = await loadSofaInternational(supabase, userId, new Date()).catch(() => null);
        if (s) pool = s.games.map((g) => ({ date: g.date, team1: g.home, team2: g.away, ft: [g.hg, g.ag] as [number, number] }));
      } else {
        const l = await loadSofaLeague(supabase, userId, code, { history: false, shots: false }).catch(() => null);
        if (l) pool = l.data.fixtures.filter((f) => f.ft).map((f) => ({ date: f.date, team1: f.team1, team2: f.team2, ft: f.ft! }));
      }
    } catch {
      continue;
    }
    pool.sort((a, b) => a.date.localeCompare(b.date));
    for (const row of rows) {
      const game = pool.find((g) => g.team1 === row.home && g.team2 === row.away && g.date >= row.match_date);
      if (!game) continue;
      const result = settleWon(row.pick_key, game.ft);
      if (!result) continue;
      const { error } = await supabase
        .from("calibration_picks")
        .update({ result, settled_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("league", row.league)
        .eq("home", row.home)
        .eq("away", row.away)
        .eq("match_date", row.match_date)
        .eq("pick_key", row.pick_key);
      if (!error) settled++;
    }
  }
  return settled;
}

export default async function CalibracaoPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const { data, error } = await supabase
    .from("calibration_picks")
    .select("league, home, away, match_date, pick_key, pick_group, label, p, base, fair, result, settled_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  if (error) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
        <EstatisticasTabs />
        <p className="max-w-4xl rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não consegui ler as sugestões registadas ({error.message}). Se a tabela ainda não existe, corre a migração 0038 no Supabase.
        </p>
      </div>
    );
  }

  const rows = data ?? [];
  const pending = rows.filter((r) => !r.result);
  if (pending.length > 0) await settlePending(supabase, user.id, pending);
  const settled = (data ?? []).filter((r) => r.result);
  const decided = settled.filter((r) => r.result === "won" || r.result === "lost");

  const labelOf = (code: string): string => LEAGUES.find((l) => l.code === code)?.label ?? code;
  const agg = (list: Row[]): { n: number; hits: number; avgP: number } => ({
    n: list.length,
    hits: list.filter((r) => r.result === "won").length,
    avgP: list.length > 0 ? list.reduce((s, r) => s + r.p, 0) / list.length : 0,
  });
  const groups = ["result", "goals", "btts", "halves"] as const;
  const groupName: Record<string, string> = { result: "Resultado", goals: "Golos", btts: "Ambas marcam", halves: "Partes" };
  const overall = agg(decided);
  const byLeague = new Map<string, Row[]>();
  for (const r of decided) {
    const list = byLeague.get(r.league) ?? [];
    list.push(r);
    byLeague.set(r.league, list);
  }
  const leagueRows = [...byLeague.entries()]
    .map(([code, list]) => ({ code, ...agg(list) }))
    .sort((a, b) => b.n - a.n);
  const recent = settled
    .filter((r) => r.settled_at)
    .sort((a, b) => (b.settled_at ?? "").localeCompare(a.settled_at ?? ""))
    .slice(0, 20);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Acerto real das sugestões do Comparar: o que o modelo disse contra o que aconteceu, por família de mercado.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold text-neutral-100">{decided.length}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">decididas</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">{overall.n > 0 ? pct(overall.hits / overall.n) : "–"}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">acertaram</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-neutral-300">{overall.n > 0 ? pct(overall.avgP) : "–"}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">chance média dita</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
          Cada jogo do Comparar regista a primeira sugestão uma vez; quando o resultado chega, liquida sozinha
          (devoluções excluídas, linhas de quartos ficam por decidir — liquidam-se à mão na Jornada). Com menos de 30
          casos por família, isto é ruído, não veredicto. {pending.length > 0 && `${pending.length} ainda por decidir.`}
        </p>
      </div>

      <div className="mb-4 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2">
        {groups.map((g) => {
          const a = agg(decided.filter((r) => r.pick_group === g));
          return (
            <div key={g} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <h3 className="mb-2 text-sm font-semibold text-neutral-300">{groupName[g]}</h3>
              {a.n === 0 ? (
                <p className="text-xs text-neutral-500">Ainda sem casos decididos.</p>
              ) : (
                <p className="text-sm tabular-nums text-neutral-200">
                  <span className="font-bold text-emerald-400">{pct(a.hits / a.n)}</span> em {a.n} ({a.hits}✓–{a.n - a.hits}✗) · dita {pct(a.avgP)}
                  {a.n < 30 && <span className="text-neutral-500"> · poucos casos</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {leagueRows.length > 0 && (
        <div className="mb-4 max-w-4xl rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Por liga</h3>
          <div className="space-y-1 text-xs tabular-nums">
            {leagueRows.map((l) => (
              <div key={l.code} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-neutral-300">{labelOf(l.code)}</span>
                <span className="shrink-0 text-neutral-200">
                  <span className="font-bold text-emerald-400">{pct(l.hits / l.n)}</span> em {l.n} · dita {pct(l.avgP)}
                  {l.n < 30 && <span className="text-neutral-500"> · poucos casos</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Onde o acerto fica abaixo do dito, confia menos; onde acompanha, confia mais.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <div className="max-w-4xl rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Últimas decididas</h3>
          <div className="space-y-1 text-xs tabular-nums">
            {recent.map((r) => (
              <div key={`${r.league}|${r.home}|${r.away}|${r.match_date}|${r.pick_key}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-neutral-300">
                  <span className={r.result === "won" ? "font-bold text-emerald-400" : r.result === "lost" ? "font-bold text-red-400" : "font-bold text-neutral-500"}>
                    {r.result === "won" ? "✓" : r.result === "lost" ? "✗" : "↩"}
                  </span>{" "}
                  {r.label} · {r.home} vs {r.away}{" "}
                  <span className="text-neutral-500">({labelOf(r.league)} · {pct(r.p)} · {odd(r.fair)})</span>
                </span>
                <span className="shrink-0 text-neutral-500">{r.match_date.slice(8, 10)}/{r.match_date.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
