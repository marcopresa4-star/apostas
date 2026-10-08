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
  tickets: number;
}

export interface BuiltMultiple {
  legs: PricedLeg[];
  odd: number;
  p: number;
  fair: number;
  avgEdge: number;
}

// Ranked qualifying legs, sliced into tickets of N (ticket 1 = the most
// likely N, ticket 2 = the next N...). Ranked by model probability: without
// an edge filter, confidence is the criterion. Empty tickets are dropped.
export function buildMultiples(all: PricedLeg[], opts: BuildOpts): BuiltMultiple[] {
  const n = Math.max(1, Math.floor(opts.legs) || 4);
  const t = Math.max(1, Math.min(10, Math.floor(opts.tickets) || 1));
  const byGame = new Map<number, PricedLeg>();
  for (const leg of all) {
    const f = opts.families[leg.family];
    if (!f?.on) continue;
    if (f.min !== null && leg.real < f.min) continue;
    if (f.max !== null && leg.real > f.max) continue;
    if (leg.p <= 0 || leg.real <= 1) continue;
    const cur = byGame.get(leg.eventId);
    if (!cur || leg.p > cur.p || (leg.p === cur.p && leg.real > cur.real)) {
      byGame.set(leg.eventId, leg);
    }
  }
  const ranked = [...byGame.values()].sort((a, b) => b.p - a.p || b.real - a.real);
  const out: BuiltMultiple[] = [];
  for (let i = 0; i < t; i++) {
    const legs = ranked
      .slice(i * n, i * n + n)
      .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
    if (legs.length === 0) break;
    out.push({
      legs,
      odd: legs.reduce((acc, l) => acc * l.real, 1),
      p: legs.reduce((acc, l) => acc * l.p, 1),
      fair: legs.reduce((acc, l) => acc * l.fair, 1),
      avgEdge: legs.reduce((s, l) => s + l.edge, 0) / legs.length,
    });
  }
  return out;
}

// One leg per game (the most likely passing the filters), top N by model
// probability. Combined numbers assume independent legs — the standard
// accumulator math, optimistic when legs correlate (same league, same day).
export function buildMultiple(all: PricedLeg[], opts: Omit<BuildOpts, "tickets">): BuiltMultiple {
  const [first] = buildMultiples(all, { ...opts, tickets: 1 });
  return first ?? { legs: [], odd: 1, p: 1, fair: 1, avgEdge: 0 };
}
