// Floating assistant ("o bot do canto"): local only, no LLM, no costs.
// Coarse intent parsing lives here (client-safe, unit-tested); anything that
// needs server data (team index, fixtures, predictions) stays in the API route.
// Numbers shown always come from the model or the live feed — never invented.

export type Intent =
  | { kind: "live" }
  | { kind: "hoje" }
  | { kind: "amanha" }
  | { kind: "data"; date: string }
  | { kind: "bots" }
  | { kind: "texto"; texto: string };

// Lowercase, no diacritics, single spaces: "Sp. Braga" matches "sporting braga".
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const DIA_RE = /\bdia\s+(\d{1,2})(?:\s*\/\s*(\d{1,2}))?\b/;

// Explicit date in the question ("21/10", "dia 21") -> YYYY-MM-DD of the
// current year. null when there is none.
export function extractDate(normalized: string, today: string): string | null {
  const year = today.slice(0, 4);
  const full = DATE_RE.exec(normalized);
  if (full) {
    const dd = full[1].padStart(2, "0");
    const mm = full[2].padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return `${year}-${mm}-${dd}`;
    return null;
  }
  const dia = DIA_RE.exec(normalized);
  if (dia) {
    const dd = dia[1].padStart(2, "0");
    const mm = (dia[2] ?? today.slice(5, 7)).padStart(2, "0");
    if (Number(dd) >= 1 && Number(dd) <= 31) return `${year}-${mm}-${dd}`;
  }
  return null;
}

export function parsePergunta(text: string, today: string): Intent {
  const t = normalizeQuery(text);
  if (!t) return { kind: "texto", texto: "" };
  if (/vivo|direto|directo|decorrer|em campo|\bagora\b/.test(t)) return { kind: "live" };
  if (/\bbots?\b|\balertas?\b/.test(t)) return { kind: "bots" };
  if (/amanha/.test(t)) return { kind: "amanha" };
  if (/\bhoje\b/.test(t)) return { kind: "hoje" };
  const date = extractDate(t, today);
  if (date) return { kind: "data", date };
  return { kind: "texto", texto: text.trim() };
}

// "0.664" -> "66,4%", like the day matrix. "1/p" -> "1,51", same style.
export const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;
export const fair2 = (p: number): string => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");

// "2026-10-21" -> "21/10".
export const diaMes = (iso: string): string => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

// One game row in an answer: scheduled (date/time), live (minute/score) or
// with model probabilities (matchup question).
export interface JogoResposta {
  league: string;
  home: string;
  away: string;
  date: string;
  time: string | null;
  eventId: number | null;
  minute?: number | null;
  hg?: number | null;
  ag?: number | null;
  live?: boolean;
  pHome?: number;
  pDraw?: number;
  pAway?: number;
  href?: string;
}

export interface RespostaAssistente {
  resumo: string;
  jogos: JogoResposta[];
  links?: { label: string; href: string }[];
}

// Site pages the assistant can point at (navigation questions).
const NAV: { match: RegExp; label: string; href: string }[] = [
  { match: /multipla/, label: "Múltiplas", href: "/multiplas" },
  { match: /jornada/, label: "Jogos da jornada", href: "/estatisticas/jornada" },
  { match: /classifica/, label: "Classificação e força", href: "/estatisticas/classificacao" },
  { match: /comparar|analise/, label: "Comparar equipas", href: "/estatisticas" },
  { match: /mapa|mapear|ligar/, label: "Mapa SofaScore", href: "/estatisticas/mapa" },
  { match: /\bvalue\b|apostas de valor/, label: "Apostas de valor", href: "/value" },
  { match: /previso/, label: "Previsões", href: "/previsoes" },
  { match: /calibra/, label: "Calibração", href: "/estatisticas/calibracao" },
  { match: /equipa/, label: "Análise equipa", href: "/estatisticas/equipa" },
  { match: /feed/, label: "Feed", href: "/feed" },
  { match: /ao vivo|calculadora/, label: "Ao vivo agora", href: "/estatisticas/ao-vivo" },
];

export function matchNav(normalized: string): { label: string; href: string } | null {
  for (const n of NAV) if (n.match.test(normalized)) return { label: n.label, href: n.href };
  return null;
}

export const AJUDA =
  "Pergunta-me por jogos: «ao vivo agora?», «jogos de hoje?», «amanhã?», «dia 21/10?», «quando joga o Benfica?» ou «Benfica vs Porto?» (probabilidades do modelo). Também sei onde fica cada página e como estão os teus bots.";

export const SUGESTOES = ["Ao vivo agora?", "Jogos de hoje?", "Quando joga o Benfica?", "Onde ficam as múltiplas?"];
