import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { fixtureEventId, loadSofaLeague } from "@/lib/sofaLeague";
import { eventOdds } from "@/lib/sofaOdds";
import { findRealOdd } from "@/lib/oddsParse";
import { predict } from "@/lib/footballModel";
import { HOUR_MS } from "@/lib/sofaCache";
import { baseRates, candidatesFor, MIN_GAMES, pickWhy, SOLID_GAMES, TRUST } from "@/lib/recommendation";
import { leagueRates } from "@/lib/footballModel";
import { loadAutoTune } from "@/lib/autoTune";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";

// Club leagues only: internationals have no pre-match odds flow.
const MARKETS = [
  { key: "home", label: "1X2 Casa" },
  { key: "draw", label: "Empate" },
  { key: "away", label: "1X2 Fora" },
  { key: "over:1.5", label: "Mais de 1,5" },
  { key: "under:1.5", label: "Menos de 1,5" },
  { key: "over:2.5", label: "Mais de 2,5" },
  { key: "under:2.5", label: "Menos de 2,5" },
  { key: "btts:yes", label: "BTTS Sim" },
  { key: "btts:no", label: "BTTS Não" },
] as const;

const DEFAULT_MARKETS = ["home", "over:1.5", "over:2.5", "btts:yes"];
// Bounds the odds sweep: each fixture costs one (cached) odds read.
const MAX_EVENTS = 60;
// Odds reads go in small batches: the local scraper answers one at a time.
const ODD_CONCURRENCY = 8;

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const oddText = (n: number): string => (Number.isFinite(n) && n > 1 ? n.toFixed(2).replace(".", ",") : "—");

export default async function ValuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament") : [];
  const mappedCodes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => mappedCodes.has(l.code) && !l.code.startsWith("int."));

  const run = first(params.analisar) === "1";
  const selLigas = list(params.ligas);
  const selMercados = list(params.mercados);
  const ligas = selLigas.length > 0 ? selLigas : leagues.map((l) => l.code);
  const mercados = selMercados.length > 0 ? selMercados : [...DEFAULT_MARKETS];
  const edgeMin = [3, 5, 8, 10].includes(Number(first(params.edge))) ? Number(first(params.edge)) / 100 : 0.05;
  const oddMaxRaw = first(params.oddmax);
  const oddMax = ["1.8", "2.5", "3", "5"].includes(oddMaxRaw) ? Number(oddMaxRaw) : null;
  const conf = ["media", "alta"].includes(first(params.conf)) ? first(params.conf) : "qualquer";
  const datas = ["hoje", "amanha", "14d"].includes(first(params.datas)) ? first(params.datas) : "7d";

  const pill = (on: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"}`;
  const chip =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600";

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Compara a odd da casa com a probabilidade do modelo: só aparece onde a odd paga acima do justo (valor
        esperado positivo). Valor não é garantia — é vantagem a longo prazo. Gere a banca com responsabilidade.
      </p>

      <EstatisticasTabs />

      <form method="get" action="/estatisticas/value" className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <input type="hidden" name="analisar" value="1" />
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Competições ({ligas.length} de {leagues.length})
            </p>
            <details className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              <summary className="cursor-pointer text-sm text-neutral-300">
                Escolher competições ({ligas.length} selecionadas)
              </summary>
              <div className="mt-3 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {leagues.map((l) => (
                  <label key={l.code} className={chip}>
                    <input type="checkbox" name="ligas" value={l.code} defaultChecked={ligas.includes(l.code)} className="accent-amber-500" />
                    {l.label}
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Mercados</p>
            <div className="flex flex-wrap gap-1.5">
              {MARKETS.map((m) => (
                <label key={m.key} className={chip}>
                  <input type="checkbox" name="mercados" value={m.key} defaultChecked={mercados.includes(m.key)} className="accent-amber-500" />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Edge mínimo (EV)</p>
              <div className="flex flex-wrap gap-1.5">
                {[3, 5, 8, 10].map((e) => (
                  <label key={e} className={pill(edgeMin === e / 100)}>
                    <input type="radio" name="edge" value={String(e)} defaultChecked={edgeMin === e / 100} className="sr-only" />
                    +{e}%
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Odd máxima</p>
              <div className="flex flex-wrap gap-1.5">
                {["1.8", "2.5", "3", "5"].map((o) => (
                  <label key={o} className={pill(oddMaxRaw === o)}>
                    <input type="radio" name="oddmax" value={o} defaultChecked={oddMaxRaw === o} className="sr-only" />
                    {o.replace(".", ",")}
                  </label>
                ))}
                <label className={pill(oddMax === null)}>
                  <input type="radio" name="oddmax" value="" defaultChecked={oddMax === null} className="sr-only" />
                  Sem limite
                </label>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Confiança mínima</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "qualquer", l: "Qualquer" },
                  { v: "media", l: "Média+ (5+ jogos)" },
                  { v: "alta", l: "Alta (12+ jogos)" },
                ].map((c) => (
                  <label key={c.v} className={pill(conf === c.v)}>
                    <input type="radio" name="conf" value={c.v} defaultChecked={conf === c.v} className="sr-only" />
                    {c.l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Datas</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "hoje", l: "Hoje" },
                  { v: "amanha", l: "Amanhã" },
                  { v: "7d", l: "Próx. 7 dias" },
                  { v: "14d", l: "Próx. 14 dias" },
                ].map((d) => (
                  <label key={d.v} className={pill(datas === d.v)}>
                    <input type="radio" name="datas" value={d.v} defaultChecked={datas === d.v} className="sr-only" />
                    {d.l}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div>
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
            >
              Analisar jogos
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              Só contam jogos com odds reais da casa (regra geral, poucos dias antes do jogo) e equipas com 5+ jogos nos
              dados. A primeira análise demora minutos em cache fria; depois é rápido.
            </p>
          </div>
        </div>
      </form>

      {run && (
        <Suspense
          key={`${ligas.join(",")}|${mercados.join(",")}|${edgeMin}|${oddMax ?? "x"}|${conf}|${datas}`}
          fallback={
            <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
              A analisar os jogos… (a primeira vez demora minutos: é uma leitura de odds por jogo)
            </p>
          }
        >
          <ValueResults ligas={ligas} mercados={mercados} edgeMin={edgeMin} oddMax={oddMax} conf={conf} datas={datas} userId={user?.id ?? null} />
        </Suspense>
      )}
    </div>
  );
}

interface ValuePick {
  league: string;
  leagueLabel: string;
  home: string;
  away: string;
  date: string;
  time: string | null;
  market: string;
  p: number;
  odd: number;
  fair: number;
  edge: number;
  games: number;
  why: string;
}

async function ValueResults({
  ligas,
  mercados,
  edgeMin,
  oddMax,
  conf,
  datas,
  userId,
}: {
  ligas: string[];
  mercados: string[];
  edgeMin: number;
  oddMax: number | null;
  conf: string;
  datas: string;
  userId: string | null;
}) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const horizon = datas === "hoje" ? 0 : datas === "amanha" ? 1 : datas === "14d" ? 14 : 7;
  const lastDay = new Date(now.getTime() + horizon * 86_400_000).toISOString().slice(0, 10);
  const inWindow = (date: string): boolean =>
    datas === "hoje" ? date === today : datas === "amanha" ? date === tomorrow : date >= today && date <= lastDay;

  const supabase = await createClient();
  const tune = userId ? await loadAutoTune(supabase, userId).catch(() => null) : null;
  const marketByKey = new Map(MARKETS.map((m) => [m.key as string, m.label]));

  let fixturesTotal = 0;
  let oddsTotal = 0;
  let truncated = false;
  const picks: ValuePick[] = [];

  for (const code of ligas) {
    if (!userId) break;
    const league = LEAGUES.find((l) => l.code === code) ?? null;
    // Mapped leagues read from SofaScore; the rest (none, currently) from files.
    const sofa = await loadSofaLeague(supabase, userId, code, { history: false, shots: false }).catch(() => null);
    const data = sofa?.data ?? (await loadLeague(code, now).catch(() => null));
    if (!data) continue;
    const base = baseRates(data.matches);
    const fhs = leagueRates(data.matches, now).firstHalfShare;
    const upcoming = data.fixtures
      .filter((f) => !f.ft && inWindow(f.date))
      .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
    fixturesTotal += upcoming.length;
    for (let i = 0; i < upcoming.length; i += ODD_CONCURRENCY) {
      for (const f of upcoming.slice(i, i + ODD_CONCURRENCY)) {
        if (oddsTotal >= MAX_EVENTS) {
          truncated = true;
          break;
        }
        const eventId = fixtureEventId(f);
        if (!eventId) continue;
        oddsTotal++;
        const prediction = predict(data.matches, f.team1, f.team2, now);
        const games = Math.min(prediction.gamesHome, prediction.gamesAway);
        if (games < MIN_GAMES) continue;
        if (conf === "alta" && games < SOLID_GAMES) continue;
        const parsed = await eventOdds(supabase, userId, eventId, HOUR_MS).catch(() => null);
        if (!parsed) continue;
        const byKey: Record<string, number> = {};
        for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
        const cands = new Map(candidatesFor(prediction, base, f.team1, f.team2, fhs, data.matches, tune).map((c) => [c.key, c]));
        // Empate não é candidato (nunca se sugere), mas é mercado: mesma
        // conta do pull-back da família resultado.
        if (mercados.includes("draw") && !cands.has("draw")) {
          const trust = TRUST.result * (tune?.groups.result?.trustMult ?? 1);
          const p = base.draw + trust * (prediction.fullTime.draw - base.draw);
          cands.set("draw", {
            group: "result",
            key: "draw",
            label: "Empate",
            p,
            base: base.draw,
            won: ([h, a]) => h === a,
          });
        }
        for (const key of mercados) {
          const c = cands.get(key);
          if (!c || c.p <= 0) continue;
          const odd = findRealOdd(byKey, key, f.team1, f.team2);
          if (odd === undefined || odd <= 1) continue;
          if (oddMax !== null && odd > oddMax) continue;
          const fair = c.push ? (1 - c.push) / c.p : 1 / c.p;
          const edge = c.p * odd - 1;
          if (edge < edgeMin) continue;
          picks.push({
            league: code,
            leagueLabel: league?.label ?? code,
            home: f.team1,
            away: f.team2,
            date: f.date,
            time: f.time ?? null,
            market: marketByKey.get(key) ?? key,
            p: c.p,
            odd,
            fair,
            edge,
            games,
            why: pickWhy(
              { key: c.key, group: c.group, label: c.label, p: c.p, base: c.base, fairOdd: fair, minOdd: fair, won: c.won },
              { matches: data.matches, home: f.team1, away: f.team2, prediction }
            ),
          });
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  picks.sort((a, b) => b.edge - a.edge);
  const avgEdge = picks.length > 0 ? picks.reduce((s, p) => s + p.edge, 0) / picks.length : 0;
  const best = picks[0] ?? null;
  const dayMonth = (d: string): string => {
    const wd = new Date(`${d}T00:00:00`).toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit" });
    return wd;
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{picks.length}</p>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">value bets</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{picks.length > 0 ? `+${Math.round(avgEdge * 100)}%` : "—"}</p>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">edge médio</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
          <p className="truncate text-sm font-bold text-neutral-100">{best ? `${best.home} (${best.market})` : "—"}</p>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">melhor ({best ? `+${Math.round(best.edge * 100)}%` : "—"})</p>
        </div>
      </div>

      {picks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Sem valor com estes filtros: {fixturesTotal} jogos no período, {oddsTotal} com odds reais. Alarga as datas,
          baixa o edge ou inclui mais ligas.
        </p>
      ) : (
        <div className="space-y-3">
          {picks.map((p) => (
            <div key={`${p.league}|${p.home}|${p.away}|${p.market}`} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-neutral-100">
                    {p.home} <span className="font-normal text-neutral-500">vs</span> {p.away}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {p.leagueLabel} · {p.market} · {dayMonth(p.date)}
                    {p.time ? ` às ${p.time.slice(0, 5)}` : ""} ·{" "}
                    <span className={p.games >= SOLID_GAMES ? "text-emerald-400" : "text-amber-400"}>
                      {p.games >= SOLID_GAMES ? "Alta" : "Média"} confiança
                    </span>
                  </p>
                </div>
                <p className="text-xl font-bold text-emerald-400">+{Math.round(p.edge * 100)}%</p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs tabular-nums">
                <div>
                  <p className="text-neutral-500">Modelo {pct(p.p)}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, p.p * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <p className="text-neutral-500">Casa {pct(1 / p.odd)}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                    <div className="h-full rounded-full bg-red-500/80" style={{ width: `${Math.min(100, (1 / p.odd) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <p className="text-neutral-100">Odd {oddText(p.odd)}</p>
                  <p className="text-neutral-500">justa {oddText(p.fair)}</p>
                </div>
              </div>
              {p.why && <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">Porquê: {p.why}</p>}
              <Link
                href={`/estatisticas?${new URLSearchParams({ liga: p.league, casa: p.home, fora: p.away })}`}
                className="mt-2 inline-block text-xs font-medium text-amber-400 hover:underline"
              >
                Analisar no Comparar →
              </Link>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        {fixturesTotal} jogos no período, {oddsTotal} com odds reais{truncated ? ` (limite de ${MAX_EVENTS} leituras por análise)` : ""}.
        Edge = probabilidade do modelo × odd − 1. Sem a odd real não há veredicto.
      </p>
    </div>
  );
}
