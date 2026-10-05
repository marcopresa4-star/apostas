// Markets the Value Bets sweep can price. `disabled` marks the ones our odds
// feed has no pre-match prices for (halves and half-time totals): selectable
// nowhere, since without a real odd there is never a verdict.
export interface ValueMarketDef {
  key: string;
  label: string;
  group: "Resultado" | "Golos" | "Por equipa";
  disabled?: string;
}

export const VALUE_MARKETS: ValueMarketDef[] = [
  { key: "home", label: "1X2 Casa", group: "Resultado" },
  { key: "draw", label: "Empate", group: "Resultado" },
  { key: "away", label: "1X2 Fora", group: "Resultado" },
  { key: "1x", label: "Dupla: 1X", group: "Resultado" },
  { key: "x2", label: "Dupla: X2", group: "Resultado" },
  { key: "over:1.5", label: "Over 1.5", group: "Golos" },
  { key: "over:2.5", label: "Over 2.5", group: "Golos" },
  { key: "under:2.5", label: "Under 2.5", group: "Golos" },
  { key: "btts:yes", label: "BTTS Sim", group: "Golos" },
  { key: "over:3.5", label: "+3.5 Golos", group: "Golos" },
  { key: "under:3.5", label: "-3.5 Golos", group: "Golos" },
  { key: "under:4.5", label: "-4.5 Golos", group: "Golos" },
  { key: "halves:both", label: "Golos em Ambas as Partes", group: "Golos", disabled: "sem odds na fonte" },
  { key: "htover:0.5", label: "Over 0.5 HT", group: "Golos", disabled: "sem odds na fonte" },
  { key: "halves:home", label: "Casa Marca nas 2 Partes", group: "Por equipa", disabled: "sem odds na fonte" },
  { key: "halves:away", label: "Fora Marca nas 2 Partes", group: "Por equipa", disabled: "sem odds na fonte" },
];

export const VALUE_MARKET_KEYS = VALUE_MARKETS.filter((m) => !m.disabled).map((m) => m.key);

export const DEFAULT_VALUE_MARKETS = ["home", "over:1.5", "over:2.5", "btts:yes"];
