// Floating assistant ("o bot do canto"): local only, no LLM, no costs.
// Coarse intent parsing lives here (client-safe, unit-tested); anything that
// needs server data (team index, fixtures, predictions) stays in the API route.
// Numbers shown always come from the model or the live feed — never invented.

export type Intent =
  | { kind: "live" }
  | { kind: "hoje" }
  | { kind: "amanha" }
  | { kind: "ontem" }
  | { kind: "data"; date: string }
  | { kind: "semana" }
  | { kind: "resultados" }
  | { kind: "classificacao" }
  | { kind: "jornada" }
  | { kind: "bots" }
  | { kind: "ajuda" }
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

// YYYY-MM-DD + n days (calendar days, noon avoids DST edges).
export function shiftDate(date: string, by: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const DIA_RE = /\bdia\s+(\d{1,2})(?:\s*\/\s*(\d{1,2}))?\b/;

// Explicit date in the question ("21/10", "dia 21") -> YYYY-MM-DD. Without a
// year it assumes the current one, rolling to next year once the date is more
// than six months behind (nobody asks about last spring in October).
export function extractDate(normalized: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const full = DATE_RE.exec(normalized);
  if (full) {
    const dd = full[1].padStart(2, "0");
    const mm = full[2].padStart(2, "0");
    if (!(Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31)) return null;
    const given = full[3] ? Number(full[3].length === 2 ? `20${full[3]}` : full[3]) : year;
    const iso = `${given}-${mm}-${dd}`;
    if (full[3]) return iso;
    const behind = (Date.parse(`${today}T12:00:00`) - Date.parse(`${iso}T12:00:00`)) / 86_400_000;
    return behind > 180 ? `${year + 1}-${mm}-${dd}` : iso;
  }
  const dia = DIA_RE.exec(normalized);
  if (dia) {
    const dd = Number(dia[1]);
    if (!(dd >= 1 && dd <= 31)) return null;
    if (dia[2]) {
      const mm = dia[2].padStart(2, "0");
      if (Number(mm) < 1 || Number(mm) > 12) return null;
      return `${year}-${mm}-${String(dd).padStart(2, "0")}`;
    }
    // "dia 21" without a month: this month, or next when the day has passed.
    const thisMonth = Number(today.slice(5, 7));
    const next = dd < Number(today.slice(8, 10)) ? thisMonth + 1 : thisMonth;
    if (next === 13) return `${year + 1}-01-${String(dd).padStart(2, "0")}`;
    return `${year}-${String(next).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

const WEEKDAYS: { match: RegExp; day: number }[] = [
  { match: /\bdomingo\b/, day: 0 },
  { match: /\bsegunda(?:-feira)?\b/, day: 1 },
  { match: /\bterca(?:-feira)?\b/, day: 2 },
  { match: /\bquarta(?:-feira)?\b/, day: 3 },
  { match: /\bquinta(?:-feira)?\b/, day: 4 },
  { match: /\bsexta(?:-feira)?\b/, day: 5 },
  { match: /\bsabado\b/, day: 6 },
];

// Next time that weekday comes round, today included ("segunda" asked on a
// Monday means today). null when no weekday is named.
export function nextWeekday(normalized: string, today: string): string | null {
  const t = normalizeQuery(normalized);
  const hit = WEEKDAYS.find((w) => w.match.test(t));
  if (!hit) return null;
  const current = new Date(`${today}T12:00:00`).getDay();
  const delta = (hit.day - current + 7) % 7;
  return shiftDate(today, delta);
}

// "fim de semana" -> the coming Saturday (today when it is already Sat/Sun).
export function weekendDate(normalized: string, today: string): string | null {
  const t = normalizeQuery(normalized);
  if (!/fim de semana|fim-de-semana/.test(t)) return null;
  const current = new Date(`${today}T12:00:00`).getDay();
  const delta = current === 0 ? 0 : (6 - current + 7) % 7;
  return shiftDate(today, delta);
}

export function parsePergunta(text: string, today: string): Intent {
  const t = normalizeQuery(text);
  if (!t) return { kind: "texto", texto: "" };
  if (/^(ajuda|help|o que sabes|o que consegues|comandos)\b/.test(t)) return { kind: "ajuda" };
  if (/vivo|direto|directo|decorrer|em campo|\bagora\b/.test(t)) return { kind: "live" };
  if (/\bbots?\b|\balertas?\b/.test(t)) return { kind: "bots" };
  if (/depois de amanha/.test(t)) return { kind: "data", date: shiftDate(today, 2) };
  if (/\bontem\b/.test(t)) return { kind: "ontem" };
  if (/amanha/.test(t)) return { kind: "amanha" };
  if (/\bhoje\b/.test(t)) return { kind: "hoje" };
  const date = extractDate(t, today);
  if (date) return { kind: "data", date };
  const weekday = nextWeekday(t, today);
  if (weekday) return { kind: "data", date: weekday };
  const weekend = weekendDate(t, today);
  if (weekend) return { kind: "data", date: weekend };
  if (/resultados?|ultimos|ultimas|como (se )?saiu|como correu|marcou|sofreu/.test(t)) return { kind: "resultados" };
  if (/classificacao|\btabela\b|em que lugar|que lugar|posicao|quantos pontos/.test(t)) return { kind: "classificacao" };
  if (/jornada|\bronda\b|proxima jornada/.test(t)) return { kind: "jornada" };
  if (/esta semana|proximos|proximas|proximos jogos|agenda|semana/.test(t)) return { kind: "semana" };
  return { kind: "texto", texto: text.trim() };
}

// "0.664" -> "66,4%", like the day matrix. "1/p" -> "1,51", same style.
export const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;
export const fair2 = (p: number): string => (p > 0 ? (1 / p).toFixed(2).replace(".", ",") : "—");

// "2026-10-21" -> "21/10".
export const diaMes = (iso: string): string => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

// "2026-10-21" -> "21/10/2026" (for past results, where the year matters).
export const diaMesAno = (iso: string): string =>
  iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

// One game row in an answer: scheduled (date/time), live (minute/score),
// finished (score + result for the asked team) or with model probabilities.
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
  finished?: boolean;
  // Result for the team the question was about ("V"/"E"/"D").
  resultado?: "V" | "E" | "D";
  pHome?: number;
  pDraw?: number;
  pAway?: number;
  // Extra line under the row (position, competition, note).
  nota?: string;
  href?: string;
}

// Compact table for classification answers: five rows around the team or the
// top of the league, with the asked team highlighted.
export interface TabelaResposta {
  titulo: string;
  linhas: {
    pos: number;
    team: string;
    jogos: number;
    pontos: number;
    dg: number;
    forma?: ("V" | "E" | "D")[];
    destaque?: boolean;
  }[];
}

export interface RespostaAssistente {
  resumo: string;
  jogos: JogoResposta[];
  links: { label: string; href: string }[];
  // Extra plain-text lines: form, position, head-to-head, sample warnings.
  notas?: string[];
  tabela?: TabelaResposta;
  // Contextual chips shown after the answer.
  sugestoes?: string[];
  // What the next short question can lean on ("e amanhã?", "e o Porto?").
  contexto?: { equipa?: string; liga?: string; dia?: string };
}

// Site pages the assistant can point at (navigation questions).
const NAV: { match: RegExp; label: string; href: string }[] = [
  { match: /multipla/, label: "Múltiplas", href: "/multiplas" },
  { match: /jornada/, label: "Jogos da jornada", href: "/estatisticas/jornada" },
  { match: /jogos.?dia|jogos de hoje/, label: "Jogos por dia", href: "/estatisticas/jogos-dia" },
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

// League names people type, longest first so "liga portugal 2" does not stop
// at "liga portugal". Codes are the same used across the site.
const LEAGUE_ALIASES: { code: string; match: RegExp }[] = [
  { code: "eu.1", match: /champions league|liga dos campeoes|champions\b/ },
  { code: "eu.2", match: /europa league|liga europa\b/ },
  { code: "eu.3", match: /conference league|liga conferencia|conferencia\b/ },
  { code: "pt.2", match: /liga portugal 2|segunda liga|liga 2\b|liga dois\b/ },
  { code: "pt.1", match: /primeira liga|liga portuguesa|liga nos\b/ },
  { code: "en.1", match: /premier league|premier\b/ },
  { code: "en.2", match: /championship\b/ },
  { code: "es.1", match: /la liga|liga espanhola/ },
  { code: "es.2", match: /segunda division|segunda espanhola/ },
  { code: "it.1", match: /serie a|serie italiana/ },
  { code: "it.2", match: /serie b\b/ },
  { code: "de.1", match: /bundesliga\b/ },
  { code: "fr.1", match: /ligue 1\b/ },
  { code: "fr.2", match: /ligue 2\b/ },
  { code: "nl.1", match: /eredivisie\b/ },
  { code: "br.1", match: /brasileirao|brasileirao serie a|serie a brasileira/ },
  { code: "br.2", match: /serie b brasileira|brasileirao serie b/ },
  { code: "int.nl", match: /liga das nacoes|nations league/ },
  { code: "int.1", match: /\bselecoes?\b|\bselecao\b/ },
];

export function matchLeague(normalized: string): string | null {
  for (const l of LEAGUE_ALIASES) if (l.match.test(normalized)) return l.code;
  return null;
}

// Words that decorate a club name but never identify it: "SL Benfica" and
// "Benfica" must be the same team.
const CLUB_WORDS = new Set([
  "fc", "cf", "sc", "sl", "sp", "sd", "cd", "ud", "ac", "as", "ss", "ssc", "us", "rc", "rcd", "ca", "cp",
  "afc", "bk", "if", "ff", "sk", "fk", "nk", "hk", "club", "clube", "de", "do", "da", "dos", "das",
  "futebol", "sad", "e",
]);

// Identity key for a club: accents, punctuation and club decorations removed.
export function teamKey(name: string): string {
  return normalizeQuery(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !CLUB_WORDS.has(w))
    .join(" ")
    .trim();
}

// True when the question names the team ("benfica" in "quando joga o benfica").
export function teamMention(normalized: string, team: string): boolean {
  const key = teamKey(team);
  if (!key) return false;
  const hay = ` ${normalized.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (key.length <= 3) return hay.includes(` ${key} `);
  // Multi-word keys ("sporting cp" -> "sporting") also match their last word
  // only when the whole key is there, so "real" alone never claims both Reals.
  return hay.includes(` ${key} `);
}

const SIDE_MARKERS = new Set(["b", "ii", "iii", "u19", "u20", "u21", "u23", "sub19", "sub20", "sub21", "sub23", "fem", "feminino", "women"]);

function sideMarker(key: string): string | null {
  return key.split(" ").find((w) => SIDE_MARKERS.has(w)) ?? null;
}

// True for reserve/youth/women's sides ("SL Benfica B", "Porto U19").
export function hasSideMarker(name: string): boolean {
  return sideMarker(teamKey(name)) !== null;
}

export function sameTeam(a: string, b: string): boolean {
  const ka = teamKey(a);
  const kb = teamKey(b);
  if (!ka || !kb) return false;
  // A reserve/youth/women's side is never the first team, even when its name
  // contains the first team's ("SL Benfica B" vs "Benfica").
  if (sideMarker(ka) !== sideMarker(kb)) return false;
  if (ka === kb) return true;
  // "Benfica" is the same club as "Sport Lisboa e Benfica": the shorter key's
  // words are all present in the longer one ("Real Madrid" vs "Real Sociedad"
  // stays apart because "madrid" is not in "sociedad").
  const wa = new Set(ka.split(" "));
  const wb = new Set(kb.split(" "));
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  return [...small].every((w) => big.has(w));
}

// Question words that never name a team: used to decide whether building the
// full team index (dozens of cached league reads) is worth it.
const QUESTION_WORDS = new Set([
  "jogo", "jogos", "jogar", "joga", "jogam", "jogou", "jogaram", "jogando", "hoje", "amanha", "ontem", "agora",
  "vivo", "direto", "directo", "decorrer", "campo", "esta", "estao", "esta", "quando", "onde",
  "qual", "quais", "quem", "que", "como", "resultado", "resultados", "ultimo", "ultimos",
  "ultima", "ultimas", "saiu", "correu", "marcou", "sofreu", "classificacao", "tabela", "lugar",
  "posicao", "pontos", "jornada", "ronda", "proximo", "proximos", "proxima", "proximas", "agenda",
  "semana", "dia", "dias", "liga", "ligas", "equipa", "equipas", "versus", "contra", "modelo",
  "probabilidades", "probabilidade", "bots", "bot", "alertas", "alerta", "ajuda", "ver", "abrir",
  "pagina", "feed", "live", "valor", "apostas", "multiplas", "previsoes", "calibracao", "mapa",
  "estatisticas", "analise", "comparar", "portugal", "espanha", "inglaterra", "italia", "franca",
  "alemanha", "holanda", "belgica", "europa", "brasil", "america", "selecoes", "selecao",
  "campeonato", "divisao", "serie", "premier", "championship", "bundesliga", "ligue", "eredivisie",
  "champions", "conference", "primeira", "segunda", "terceira", "nos", "por", "para", "com",
  "sem", "dos", "das", "num", "numa", "sao", "foi", "sera", "tem", "ter", "vai", "vao", "meu",
  "minha", "teu", "tua", "seu", "sua", "fim", "proximos", "calendario", "horario", "hora",
]);

export function teamQueryWords(normalized: string): string[] {
  return normalizeQuery(normalized)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !QUESTION_WORDS.has(w));
}

export function mightNameTeam(normalized: string): boolean {
  return teamQueryWords(normalized).length > 0;
}

export const AJUDA =
  "Pergunta-me por jogos («ao vivo agora?», «jogos de hoje?», «ontem?», «amanhã?», «dia 21/10?», «esta semana?»), " +
  "por uma equipa («quando joga o Benfica?», «resultados do Benfica», «classificação do Benfica», «Benfica vs Porto?»), " +
  "por uma jornada («jornada da Primeira Liga») ou pelos teus bots. Também sei onde fica cada página.";

export const SUGESTOES = [
  "Ao vivo agora?",
  "Jogos de hoje?",
  "Quando joga o Benfica?",
  "Resultados do Benfica",
  "Classificação da Primeira Liga",
  "Onde ficam as múltiplas?",
];
