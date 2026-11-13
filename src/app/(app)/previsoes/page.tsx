import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { cacheGet, cacheSet } from "@/lib/sofaCache";
import { predict, leagueRates } from "@/lib/footballModel";
import { baseRates, candidatesFor, MIN_GAMES } from "@/lib/recommendation";
import { loadAutoTune } from "@/lib/autoTune";
import { first } from "@/lib/searchParams";
import Icon from "@/components/Icon";
import { Badge, Crest, Empty, Ring } from "@/components/ui";

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
        on ? "border-emerald-400/60 bg-gradient-to-b from-emerald-400/25 to-emerald-500/10 text-emerald-200 shadow-[0_0_18px_-4px_rgba(52,211,153,0.6)]" : "border-white/[0.07] text-neutral-400 hover:border-white/[0.15] hover:text-neutral-200"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div data-wide>
      <h1 className="hero-title mb-3"><Icon name="sparkle" className="mr-2 inline-block h-8 w-8 -translate-y-0.5 text-emerald-300" /> <span className="title-glow">Previsões do dia</span><span className="hero-underline" /></h1>
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
          <div className="space-y-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-[4.5rem]" />
            ))}
          </div>
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
  // Intraday data barely moves (only new results trickle in): 3h cache, so
  // the sweep costs once a day in practice.
  const cached = await cacheGet(supabase, user.id, cacheKey, 3 * 60 * 60_000).catch(() => null);
  let ranked: Ranked[] = Array.isArray(cached) ? (cached as Ranked[]) : [];
  let gamesTotal = 0;
  if (!Array.isArray(cached)) {
    const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
    const codes = new Set(maps.map((m) => m.name_key));
    const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
    const tune = await loadAutoTune(supabase, user.id).catch(() => null);
    const all: Ranked[] = [];
    await pool(leagues, 8, async (l) => {
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
      <Empty icon={<Icon name="sparkle" className="h-7 w-7" />} title="Sem jogos por começar hoje nas ligas mapeadas">
        {gamesTotal > 0
          ? `${gamesTotal} jogos sem dados suficientes para o modelo (5+ jogos por equipa).`
          : "Volta amanhã ou vê os próximos dias nos Jogos por dia."}
      </Empty>
    );
  }

  return (
    <div className="space-y-2.5 xl:grid xl:grid-cols-2 xl:items-start xl:gap-3 xl:space-y-0">
      {ranked.map((r, i) => {
        const medal = i === 0 ? "from-amber-300 to-amber-600 text-amber-950" : i === 1 ? "from-neutral-200 to-neutral-400 text-neutral-900" : i === 2 ? "from-orange-300 to-orange-600 text-orange-950" : "from-white/10 to-white/5 text-neutral-400";
        return (
          <div key={`${r.league}|${r.home}|${r.away}|${r.title}`} className="glass flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-display text-base font-extrabold tabular-nums ${medal}`}>{i + 1}</span>
            <span className="flex shrink-0 -space-x-2">
              <Crest name={r.home} size={30} />
              <Crest name={r.away} size={30} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-neutral-100">
                {r.home} <span className="font-normal text-neutral-500">vs</span> {r.away}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                {r.leagueLabel}{r.time ? ` · ${r.time.slice(0, 5)}` : ""}
                <Badge kind="neutral">{r.title}</Badge>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-right">
                <span className="block text-[10px] uppercase tracking-wider text-neutral-500">odd justa</span>
                <span className="block font-display text-lg font-bold tabular-nums text-neutral-100">{oddText(r.fair)}</span>
              </span>
              <Ring value={r.p * 100} size={52} color={r.p >= 0.7 ? "#34d399" : r.p >= 0.55 ? "#fbbf24" : "#94a3b8"} />
            </span>
            <Link
              href={`/estatisticas?${new URLSearchParams({ liga: r.league, casa: r.home, fora: r.away })}`}
              className="btn-soft shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
            >
              Analisar →
            </Link>
          </div>
        );
      })}
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
