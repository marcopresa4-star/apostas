// Personal bets board (odds only, no stakes): kinds, markets and the
// automatic settlement for the standard markets.

export type BetKind = "pre" | "watch" | "live";
export type BetStatus = "open" | "won" | "lost" | "void";

export interface Bet {
  id: string;
  kind: BetKind;
  status: BetStatus;
  home_team: string;
  away_team: string;
  league_label: string | null;
  market_key: string;
  market_label: string;
  odd: number | null;
  sofascore_id: number | null;
  kickoff: string | null;
  target_odd: number | null;
  target_minute: number | null;
  settled_auto: boolean;
  // Enriched on load (never stored): analysis link, current price, live read.
  analysisHref?: string | null;
  liveOdd?: number | null;
}

export const KIND_LABEL: Record<BetKind, string> = {
  pre: "Pré-jogo",
  watch: "A vigiar",
  live: "Live",
};

export const STATUS_LABEL: Record<BetStatus, string> = {
  open: "Aberta",
  won: "Ganha",
  lost: "Perdida",
  void: "Anulada",
};

// Standard markets with the same keys the models use, so finished games can
// settle themselves. Half-time and next-goal markets settle by hand.
export const MARKET_OPTIONS: { key: string; label: string }[] = [
  { key: "home", label: "Casa vence" },
  { key: "draw", label: "Empate" },
  { key: "away", label: "Fora vence" },
  { key: "1x", label: "Casa ou empate (1X)" },
  { key: "x2", label: "Fora ou empate (X2)" },
  { key: "12", label: "Sem empate (12)" },
  { key: "dnb:home", label: "Empate anula: casa" },
  { key: "dnb:away", label: "Empate anula: fora" },
  { key: "btts:yes", label: "Ambas marcam: sim" },
  { key: "btts:no", label: "Ambas marcam: não" },
  { key: "over:1.5", label: "Mais de 1,5 golos" },
  { key: "under:1.5", label: "Menos de 1,5 golos" },
  { key: "over:2.5", label: "Mais de 2,5 golos" },
  { key: "under:2.5", label: "Menos de 2,5 golos" },
  { key: "over:3.5", label: "Mais de 3,5 golos" },
  { key: "under:3.5", label: "Menos de 3,5 golos" },
  { key: "over:2", label: "Mais de 2 golos" },
  { key: "under:2", label: "Menos de 2 golos" },
  { key: "over:3", label: "Mais de 3 golos" },
  { key: "under:3", label: "Menos de 3 golos" },
  { key: "ht:home", label: "Casa ao intervalo" },
  { key: "ht:draw", label: "Empate ao intervalo" },
  { key: "ht:away", label: "Fora ao intervalo" },
  { key: "htover:0.5", label: "Mais de 0,5 ao intervalo" },
  { key: "htunder:0.5", label: "Menos de 0,5 ao intervalo" },
  { key: "htover:1.5", label: "Mais de 1,5 ao intervalo" },
  { key: "htunder:1.5", label: "Menos de 1,5 ao intervalo" },
  { key: "fts:home", label: "Casa marca primeiro" },
  { key: "fts:away", label: "Fora marca primeiro" },
  { key: "fts:none", label: "Ninguém marca" },
  { key: "halves:both", label: "Golos nas 2 partes" },
  { key: "halves:home", label: "Casa marca nas 2 partes" },
  { key: "halves:away", label: "Fora marca nas 2 partes" },
  // Linha à parte (handicaps e totais por equipa): a chave leva a linha,
  // ex. "ah:home:-1.5". Só linhas .0 (devolve no certo) e .5.
  { key: "ah:home", label: "Handicap asiático: casa…" },
  { key: "ah:away", label: "Handicap asiático: fora…" },
  { key: "to:home", label: "Golos da casa: mais de…" },
  { key: "tu:home", label: "Golos da casa: menos de…" },
  { key: "to:away", label: "Golos da fora: mais de…" },
  { key: "tu:away", label: "Golos da fora: menos de…" },
  { key: "custom", label: "Outro (manual)…" },
];

// Matches a market that needs its own line (ah/to/tu): "ah:home" or the full
// "ah:home:-1.5". Returns [base, side, line|null].
export function splitLineKey(key: string): [string, string, string | null] | null {
  const m = /^(ah|to|tu):(home|away)(?::([+-]?\d+(?:[.,]\d+)?))?$/.exec(key);
  if (!m) return null;
  return [m[1], m[2], m[3] ?? null];
}

// Only whole (.0, refunded on exact) and half (.5) lines settle alone. Quarter
// lines (.25/.75) split the stake in two — without stakes there is no honest
// won/lost/void for them, so they stay manual.
export function validAsianLine(line: string): boolean {
  const n = Number(line.replace(",", "."));
  if (!Number.isFinite(n)) return false;
  const frac = Math.abs(n % 1);
  return frac === 0 || frac === 0.5;
}

// Whether a standard market won, lost, was refunded (push) or cannot be
// settled alone (null → manual). Exact ties on whole lines refund.
export function settleWon(
  key: string,
  ft: [number, number],
  extra?: { ht?: [number, number] | null; firstScorer?: "home" | "away" | "none" | null }
): "won" | "lost" | "void" | null {
  const [h, a] = ft;
  const win = (v: boolean): "won" | "lost" => (v ? "won" : "lost");
  switch (key) {
    case "home":
      return win(h > a);
    case "draw":
      return win(h === a);
    case "away":
      return win(h < a);
    case "1x":
      return win(h >= a);
    case "x2":
      return win(a >= h);
    case "12":
      return win(h !== a);
    case "dnb:home":
      return h === a ? "void" : win(h > a);
    case "dnb:away":
      return h === a ? "void" : win(h < a);
    case "btts:yes":
      return win(h > 0 && a > 0);
    case "btts:no":
      return win(!(h > 0 && a > 0));
    case "ht:home":
    case "ht:draw":
    case "ht:away": {
      const ht = extra?.ht ?? null;
      if (!ht) return null;
      return key === "ht:home" ? win(ht[0] > ht[1]) : key === "ht:draw" ? win(ht[0] === ht[1]) : win(ht[0] < ht[1]);
    }
    case "fts:home":
    case "fts:away":
    case "fts:none": {
      const first = extra?.firstScorer ?? null;
      if (!first) return null;
      return key === "fts:home" ? win(first === "home") : key === "fts:away" ? win(first === "away") : win(first === "none");
    }
    default: {
      const ou = /^(over|under):(\d+(?:\.\d+)?)$/.exec(key);
      if (ou) {
        const line = Number(ou[2]);
        if (!Number.isFinite(line)) return null;
        const total = h + a;
        if (total === line) return "void";
        return ou[1] === "over" ? win(total > line) : win(total < line);
      }
      const htou = /^(htover|htunder):(\d+(?:\.\d+)?)$/.exec(key);
      if (htou) {
        const ht = extra?.ht ?? null;
        const line = Number(htou[2]);
        if (!ht || !Number.isFinite(line)) return null;
        const total = ht[0] + ht[1];
        if (total === line) return "void";
        return htou[1] === "htover" ? win(total > line) : win(total < line);
      }
      const split = splitLineKey(key);
      if (split) {
        const [base, side, rawLine] = split;
        if (rawLine === null || !validAsianLine(rawLine)) return null;
        const line = Number(rawLine.replace(",", "."));
        const team = side === "home" ? h : a;
        const opp = side === "home" ? a : h;
        if (base === "ah") {
          const diff = team + line - opp;
          if (diff === 0) return "void";
          return win(diff > 0);
        }
        // to/tu: team total over/under the line.
        if (team === line) return "void";
        return base === "to" ? win(team > line) : win(team < line);
      }
      return null;
    }
  }
}

export const oddText = (odd: number | null): string =>
  odd !== null && Number.isFinite(odd) && odd > 1 ? `@${odd.toFixed(2).replace(".", ",")}` : "—";
