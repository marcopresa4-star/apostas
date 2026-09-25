import { slugify } from "./slugify";

// Real bookmaker odds from SofaScore (`/event/{id}/odds/1/all`), parsed to
// decimal odds under stable keys. Client-safe: no server imports. The server
// fetch + cache lives in sofaOdds.ts; the live widget route re-serves it.

export interface RealChoice {
  // Stable key, e.g. "ft:home", "ou:2.5:over", "btts:yes", "fts:Benfica".
  key: string;
  name: string;
  odd: number;
  open: number | null;
  winning: boolean;
}

export interface RealMarket {
  name: string;
  group: string;
  period: string;
  line: string | null;
  live: boolean;
  suspended: boolean;
  choices: RealChoice[];
}

export interface ParsedOdds {
  eventId: number;
  live: boolean;
  markets: RealMarket[];
}

// "19/20" -> 1.95, "1/1" and "EVS" -> 2.0. Null when unreadable.
export function fractionalToDecimal(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim().toUpperCase();
  if (text === "EVS" || text === "EVEN") return 2;
  const parts = text.split("/");
  if (parts.length !== 2) return null;
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num < 0) return null;
  const odd = 1 + num / den;
  return odd > 1 && odd < 1000 ? Math.round(odd * 100) / 100 : null;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function choiceKey(group: string, period: string, line: string | null, name: string): string {
  const g = group.toLowerCase();
  const n = name.trim();
  if (g === "1x2" && period.toLowerCase().includes("1st")) {
    return n === "1" ? "ht:home" : n === "X" ? "ht:draw" : n === "2" ? "ht:away" : `ht:${n}`;
  }
  if (g === "1x2") return n === "1" ? "ft:home" : n === "X" ? "ft:draw" : n === "2" ? "ft:away" : `ft:${n}`;
  if (g === "double chance") {
    return n === "1X" ? "dc:1x" : n === "X2" ? "dc:x2" : n === "12" ? "dc:12" : `dc:${n}`;
  }
  if (g === "draw no bet") return n === "1" ? "dnb:home" : n === "2" ? "dnb:away" : `dnb:${n}`;
  if (g === "both teams to score") return n.toLowerCase() === "yes" ? "btts:yes" : n.toLowerCase() === "no" ? "btts:no" : `btts:${n}`;
  if (g === "match goals" && line) {
    return n.toLowerCase() === "over" ? `ou:${line}:over` : n.toLowerCase() === "under" ? `ou:${line}:under` : `ou:${line}:${n}`;
  }
  if (g === "corners 2-way" && line) {
    return n.toLowerCase() === "over" ? `corners:${line}:over` : n.toLowerCase() === "under" ? `corners:${line}:under` : `corners:${line}:${n}`;
  }
  if (g === "asian handicap") {
    const m = /^\(([+-]?\d+(?:\.\d+)?)\)\s*(.+)$/.exec(n);
    if (m) return `ah:${String(Number(m[1]))}:${slugify(m[2])}`;
    return `ah:${n}`;
  }
  if (g === "first team to score") return n.toLowerCase() === "no goal" ? "fts:none" : `fts:${n}`;
  return `${group}:${line ?? ""}:${n}`.toLowerCase();
}

export function parseOddsMarkets(body: unknown, eventId: number): ParsedOdds | null {
  const markets = obj(body)?.markets;
  if (!Array.isArray(markets)) return null;
  const out: RealMarket[] = [];
  for (const item of markets) {
    const m = obj(item);
    if (!m) continue;
    const group = str(m.marketGroup) || str(m.marketName);
    const period = str(m.marketPeriod);
    const line = typeof m.choiceGroup === "string" && m.choiceGroup ? m.choiceGroup : null;
    const rawChoices = m.choices;
    if (!group || !Array.isArray(rawChoices)) continue;
    const choices: RealChoice[] = [];
    for (const c of rawChoices) {
      const row = obj(c);
      if (!row) continue;
      const odd = fractionalToDecimal(row.fractionalValue);
      if (odd === null) continue;
      choices.push({
        key: choiceKey(group, period, line, str(row.name)),
        name: str(row.name),
        odd,
        open: fractionalToDecimal(row.initialFractionalValue),
        winning: row.winning === true,
      });
    }
    if (choices.length === 0) continue;
    out.push({
      name: str(m.marketName),
      group,
      period,
      line,
      live: m.isLive === true,
      suspended: m.suspended === true,
      choices,
    });
  }
  if (out.length === 0) return null;
  return { eventId, live: out.some((m) => m.live), markets: out };
}

// Our model's market keys (recommendation + live candidates) -> odds keys.
// `home`/`away` only matter for first-team-to-score, whose choices are named.
export function oddsKeyFor(marketKey: string, home: string, away: string): string | null {
  if (marketKey === "home") return "ft:home";
  if (marketKey === "draw") return "ft:draw";
  if (marketKey === "away") return "ft:away";
  if (marketKey === "1x") return "dc:1x";
  if (marketKey === "x2") return "dc:x2";
  if (marketKey === "12") return "dc:12";
  if (marketKey === "btts:yes") return "btts:yes";
  if (marketKey === "btts:no") return "btts:no";
  if (marketKey === "dnb:home") return "dnb:home";
  if (marketKey === "dnb:away") return "dnb:away";
  const ah = /^ah:(home|away):([+-]?\d+(?:\.\d+)?)$/.exec(marketKey);
  if (ah) {
    const team = ah[1] === "home" ? home : away;
    return `ah:${ah[2]}:${slugify(team)}`;
  }
  const ou = /^(over|under):(\d+(?:\.\d+)?)$/.exec(marketKey);
  if (ou) return `ou:${ou[2]}:${ou[1]}`;
  if (marketKey === "next:home") return `fts:${home}`;
  if (marketKey === "next:away") return `fts:${away}`;
  if (marketKey === "next:none") return "fts:none";
  if (marketKey === "ht:home" || marketKey === "ht:draw" || marketKey === "ht:away") return marketKey;
  return null;
}

// Our key -> the bookmaker's odd, tolerating name suffixes ("Seattle
// Sounders" vs "Seattle Sounders FC" on the handicap lines). Exact match
// first, containment after.
export function findRealOdd(
  byKey: Record<string, number>,
  marketKey: string,
  home: string,
  away: string
): number | undefined {
  const direct = oddsKeyFor(marketKey, home, away);
  if (direct && byKey[direct] !== undefined) return byKey[direct];
  const ah = /^ah:(home|away):([+-]?\d+(?:\.\d+)?)$/.exec(marketKey);
  if (ah) {
    const slug = slugify(ah[1] === "home" ? home : away);
    const prefix = `ah:${ah[2]}:`;
    for (const [key, odd] of Object.entries(byKey)) {
      if (!key.startsWith(prefix)) continue;
      const other = key.slice(prefix.length);
      if (other === slug || other.startsWith(slug) || slug.startsWith(other)) return odd;
    }
  }
  return undefined;
}
