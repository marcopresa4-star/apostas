import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { cacheGet, cacheSet } from "@/lib/sofaCache";
import { predict } from "@/lib/footballModel";
import { baseRates, candidatesFor, leagueRates, MIN_GAMES } from "@/lib/recommendation";
import { loadAutoTune } from "@/lib/autoTune";
import { first } from "@/lib/searchParams";

// The most probable outcome of each market, for today's games, mapped
// leagues only. No odds involved: pure model probability ranking. Club
// leagues only (cards have no pre-match model, so there is no Cartões tab).
const CATEGORIES = [
  {
    id: "golos",
    label: "Golos",
    markets: [
      { key: "over:1.5", label: "Over 1.5" },
      { key: "over:2.5", label: "Over 2.5" },
      { key: "under:2.5", label: "Under 2.5" },
      { key: "over:3.5", label: "Over 3.5" },
      { key: "under:3.5", label: "Under 3.5" },
      { key: "btts:yes", label: "Ambas marcam" },
    ],
  },
  {
    id: "partes",
    label: "Partes",
    markets: [
      { key: "htover:0.5", label: "Over 0.5 HT" },
      { key: "htover:1.5", label: "Over 1.5 HT" },
      { key: "halves:both", label: "Golos nas 2 partes" },
    ],
  },
  {
    id: "equipas",
    label: "Equipas",
    markets: [
      { key: "team:over:1.5", label: "Equipa Over 1.5" },
      { key: "team:over:2.5", label: "Equipa Over 2.5" },
    ],
  },
] as const;

const TOP_N = 8;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

const pct = (n: number): string => `${(n * 100).toFixed(1).replace(".", ",")}%`;
const oddText = (n: number): string => (Number.isFinite(n) && n > 1 ? n.toFixed(2).replace(".", ",") : "—");

export default async function PrevisoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const cat = CATEGORIES.find((c) => c.id === first(params.cat)) ?? CATEGORIES[0];
  const market = cat.markets.find((m) => m.key === first(params.mercado)) ?? cat.markets[0];
  const dayLabel = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`;

  const pill = (on: boolean, href: string, label: string) => (
    <Link
      key={label}
      href={href}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🔮 Previsões do dia</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        O que é mais provável acontecer hoje, mercado a mercado · {dayLabel}
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => pill(c.id === cat.id, `/previsoes?${new URLSearchParams({ cat: c.id, mercado: c.markets[0].key })}`, c.label))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {cat.markets.map((m) => pill(m.key === market.key, `/previsoes?${new URLSearchParams({ cat: cat.id, mercado: m.key })}`, m.label))}
      </div>

      <Suspense
        key={`${today}|${cat.id}|${market.key}`}
        fallback={
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            A calcular as probabilidades de hoje…
          </p>
        }
      >
        <PrevisoesBoard today={today} now={now} marketKey={market.key} marketLabel={market.label} />
      </Suspense>
    </div>
  );
}

interface Ranked {
  league: string;
  leagueLabel: string;
  home: string;
  away: string;
  time: string | null;
  title: string;
  p: number;
  fair: number;
}

async function PrevisoesBoard({
  today,
  now,
  marketKey,
  marketLabel,
}: {
  today: string;
  now: Date;
  marketKey: string;
  marketLabel: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const cacheKey = `previsoes:${today}|${marketKey}`;
  const cached = await cacheGet(supabase, user.id, cacheKey, 60 * 60_000).catch(() => null);
  let ranked: Ranked[] = Array.isArray(cached) ? (cached as Ranked[]) : [];
  let gamesTotal = 0;
  if (!Array.isArray(cached)) {
    const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
    const codes = new Set(maps.map((m) => m.name_key));
    const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
    const tune = await loadAutoTune(supabase, user.id).catch(() => null);
    const all: Ranked[] = [];
    await pool(leagues, 4, async (l) => {
      const loaded = await loadSofaLeague(supabase, user.id, l.code, { history: false, shots: false }).catch(() => null);
      if (!loaded) return;
      const base = baseRates(loaded.data.matches);
      const fhs = leagueRates(loaded.data.matches, now).firstHalfShare;
      const upcoming = loaded.data.fixtures.filter((f) => !f.ft && f.date === today && !started(f.time, now));
      gamesTotal += upcoming.length;
      for (const f of upcoming) {
        const prediction = predict(loaded.data.matches, f.team1, f.team2, now);
        if (Math.min(prediction.gamesHome, prediction.gamesAway) < MIN_GAMES) continue;
        const cands = new Map(
          candidatesFor(prediction, base, f.team1, f.team2, fhs, loaded.data.matches, tune).map((c) => [c.key, c])
        );
        if (marketKey === "team:over:1.5" || marketKey === "team:over:2.5") {
          const line = marketKey.endsWith("1.5") ? "1.5" : "2.5";
          for (const side of ["home", "away"] as const) {
            const c = cands.get(`to:${side}:${line}`);
            if (!c || c.p <= 0) continue;
            const team = side === "home" ? f.team1 : f.team2;
            all.push({
              league: l.code,
              leagueLabel: l.label as string,
              home: f.team1,
              away: f.team2,
              time: f.time ?? null,
              title: `${team} mais de ${line.replace(".", ",")}`,
              p: c.p,
              fair: 1 / c.p,
            });
          }
        } else {
          const c = cands.get(marketKey);
          if (!c || c.p <= 0) continue;
          all.push({
            league: l.code,
            leagueLabel: l.label as string,
            home: f.team1,
            away: f.team2,
            time: f.time ?? null,
            title: c.label,
            p: c.p,
            fair: c.push ? (1 - c.push) / c.p : 1 / c.p,
          });
        }
      }
    });
    all.sort((a, b) => b.p - a.p);
    ranked = all.slice(0, TOP_N);
    await cacheSet(supabase, user.id, cacheKey, ranked).catch(() => {});
  }

  if (ranked.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-12 text-center">
        <p className="text-3xl">⭐</p>
        <p className="mt-2 text-sm font-semibold text-neutral-200">Sem jogos por começar hoje nas ligas mapeadas</p>
        <p className="mt-1 text-xs text-neutral-500">
          {gamesTotal > 0
            ? `${gamesTotal} jogos sem dados suficientes para o modelo (5+ jogos por equipa).`
            : "Volta amanhã ou vê os próximos dias nos Jogos por dia."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-2.5">
      {ranked.map((r, i) => (
        <div key={`${r.league}|${r.home}|${r.away}|${r.title}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
          <span className="w-7 shrink-0 text-lg font-bold tabular-nums text-neutral-600">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-neutral-100">
              {r.home} <span className="font-normal text-neutral-500">vs</span> {r.away}
            </span>
            <span className="block text-[11px] text-neutral-500">
              {r.leagueLabel}{r.time ? ` · ${r.time.slice(0, 5)}` : ""} · {r.title}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-lg font-bold tabular-nums text-emerald-300">{pct(r.p)}</span>
            <span className="block text-[11px] text-neutral-500">justa {oddText(r.fair)}</span>
          </span>
          <Link
            href={`/estatisticas?${new URLSearchParams({ liga: r.league, casa: r.home, fora: r.away })}`}
            className="shrink-0 text-xs font-medium text-emerald-400 hover:underline"
          >
            Analisar →
          </Link>
        </div>
      ))}
      <p className="text-[11px] text-neutral-500">
        {marketLabel}: os {TOP_N} mais prováveis de hoje, só ligas mapeadas, equipas com 5+ jogos. Sem odds — pura probabilidade do modelo.
      </p>
    </div>
  );
}

// Kickoff mais de 2h atrás sem resultado: já começou (ou falhou a fonte) —
// fora da lista de "por começar".
function started(time: string | undefined, now: Date): boolean {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  const kickoff = new Date(now);
  kickoff.setHours(h, m, 0, 0);
  return now.getTime() - kickoff.getTime() > 2 * 3_600_000;
}
