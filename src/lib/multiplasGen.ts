// Generator for multi-game accumulators ("múltiplas"): family catalog plus the
// pure leg-picking. Client-safe. Only families the odds feed really prices
// can yield legs (real odds only); the rest are listed as uncovered so the
// absence is explained, not silent.
export interface MultiFamily {
  id: string;
  label: string;
  covered: boolean;
  whyDisabled?: string;
  match: (key: string) => boolean;
}

export const MULTI_FAMILIES: MultiFamily[] = [
  { id: "result", label: "Resultado (1X2)", covered: true, match: (k) => k === "home" || k === "away" || k === "draw" },
  { id: "dc", label: "Dupla hipótese", covered: true, match: (k) => k === "1x" || k === "x2" },
  { id: "btts", label: "Ambas marcam", covered: true, match: (k) => k === "btts:yes" || k === "btts:no" },
  {
    id: "ou",
    label: "Mais/Menos golos",
    covered: true,
    match: (k) => /^(over|under):\d+(?:\.\d+)?$/.test(k),
  },
  { id: "dnb", label: "Empate anula (DNB)", covered: true, match: (k) => k.startsWith("dnb:") },
  {
    id: "ah",
    label: "Handicap asiático",
    covered: true,
    match: (k) => k.startsWith("ah:"),
  },
  {
    id: "ht",
    label: "Resultado ao intervalo",
    covered: true,
    match: (k) => k === "ht:home" || k === "ht:draw" || k === "ht:away",
  },
  {
    id: "team",
    label: "Totais por equipa",
    covered: false,
    whyDisabled: "sem odds reais na fonte",
    match: (k) => /^(to|tu):/.test(k),
  },
  {
    id: "halves",
    label: "Golo nas 2 partes",
    covered: false,
    whyDisabled: "sem odds reais na fonte",
    match: (k) => k.startsWith("halves:"),
  },
  {
    id: "htgoals",
    label: "Golos 1.ª/2.ª parte",
    covered: false,
    whyDisabled: "sem odds reais na fonte",
    match: (k) => /^(htover|htunder|htto|httu|ht2over|ht2under|ht2to|ht2tu):/.test(k),
  },
  {
    id: "combo",
    label: "Combos BTTS+Over",
    covered: false,
    whyDisabled: "sem odds reais na fonte",
    match: (k) => k.startsWith("combo:"),
  },
];

export const COVERED_FAMILY_IDS = MULTI_FAMILIES.filter((f) => f.covered).map((f) => f.id);

export function familyOf(key: string): MultiFamily | null {
  return MULTI_FAMILIES.find((f) => f.match(key)) ?? null;
}

export interface PricedLeg {
  eventId: number;
  date: string;
  time: string | null;
  league: string;
  leagueLabel: string;
  home: string;
  away: string;
  family: string;
  key: string;
  label: string;
  p: number;
  fair: number;
  real: number;
  edge: number;
  games: number;
  voidNote: string | null;
}

export interface FamilyFilter {
  on: boolean;
  min: number | null;
  max: number | null;
}

export interface BuildOpts {
  families: Record<string, FamilyFilter>;
  legs: number;
  minEdge: number;
}

export interface BuiltMultiple {
  legs: PricedLeg[];
  odd: number;
  p: number;
  fair: number;
  avgEdge: number;
}

// One leg per game (the best edge passing the filters), top N by edge.
// Combined numbers assume independent legs — the standard accumulator math,
// optimistic when legs correlate (same league, same day).
export function buildMultiple(all: PricedLeg[], opts: BuildOpts): BuiltMultiple {
  const n = Math.max(1, Math.min(12, Math.floor(opts.legs) || 4));
  const byGame = new Map<number, PricedLeg>();
  for (const leg of all) {
    const f = opts.families[leg.family];
    if (!f?.on) continue;
    if (f.min !== null && leg.real < f.min) continue;
    if (f.max !== null && leg.real > f.max) continue;
    if (leg.edge < opts.minEdge) continue;
    if (leg.p <= 0 || leg.real <= 1) continue;
    const cur = byGame.get(leg.eventId);
    if (!cur || leg.edge > cur.edge || (leg.edge === cur.edge && leg.p > cur.p)) {
      byGame.set(leg.eventId, leg);
    }
  }
  const legs = [...byGame.values()]
    .sort((a, b) => b.edge - a.edge || b.p - a.p)
    .slice(0, n)
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  const odd = legs.reduce((acc, l) => acc * l.real, 1);
  const p = legs.reduce((acc, l) => acc * l.p, 1);
  const fair = legs.reduce((acc, l) => acc * l.fair, 1);
  return {
    legs,
    odd,
    p,
    fair,
    avgEdge: legs.length > 0 ? legs.reduce((s, l) => s + l.edge, 0) / legs.length : 0,
  };
}
