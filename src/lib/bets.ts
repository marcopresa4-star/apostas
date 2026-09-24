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
  { key: "btts:yes", label: "Ambas marcam: sim" },
  { key: "btts:no", label: "Ambas marcam: não" },
  { key: "over:1.5", label: "Mais de 1,5 golos" },
  { key: "under:1.5", label: "Menos de 1,5 golos" },
  { key: "over:2.5", label: "Mais de 2,5 golos" },
  { key: "under:2.5", label: "Menos de 2,5 golos" },
  { key: "over:3.5", label: "Mais de 3,5 golos" },
  { key: "under:3.5", label: "Menos de 3,5 golos" },
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
  { key: "custom", label: "Outro (manual)…" },
];

// Whether a standard market won: final score plus, for half-time and
// first-scorer markets, the extra data. Null for markets the site cannot
// settle alone: those stay manual.
export function settleWon(
  key: string,
  ft: [number, number],
  extra?: { ht?: [number, number] | null; firstScorer?: "home" | "away" | "none" | null }
): boolean | null {
  const [h, a] = ft;
  switch (key) {
    case "home":
      return h > a;
    case "draw":
      return h === a;
    case "away":
      return h < a;
    case "1x":
      return h >= a;
    case "x2":
      return a >= h;
    case "12":
      return h !== a;
    case "btts:yes":
      return h > 0 && a > 0;
    case "btts:no":
      return !(h > 0 && a > 0);
    case "ht:home":
    case "ht:draw":
    case "ht:away": {
      const ht = extra?.ht ?? null;
      if (!ht) return null;
      return key === "ht:home" ? ht[0] > ht[1] : key === "ht:draw" ? ht[0] === ht[1] : ht[0] < ht[1];
    }
    case "fts:home":
    case "fts:away":
    case "fts:none": {
      const first = extra?.firstScorer ?? null;
      if (!first) return null;
      return key === "fts:home" ? first === "home" : key === "fts:away" ? first === "away" : first === "none";
    }
    default: {
      const ou = /^(over|under):(\d+(?:\.\d+)?)$/.exec(key);
      if (ou) {
        const line = Number(ou[2]);
        if (!Number.isFinite(line)) return null;
        return ou[1] === "over" ? h + a > line : h + a < line;
      }
      const htou = /^(htover|htunder):(\d+(?:\.\d+)?)$/.exec(key);
      if (htou) {
        const ht = extra?.ht ?? null;
        const line = Number(htou[2]);
        if (!ht || !Number.isFinite(line)) return null;
        return htou[1] === "htover" ? ht[0] + ht[1] > line : ht[0] + ht[1] < line;
      }
      return null;
    }
  }
}

export const oddText = (odd: number | null): string =>
  odd !== null && Number.isFinite(odd) && odd > 1 ? `@${odd.toFixed(2).replace(".", ",")}` : "—";
