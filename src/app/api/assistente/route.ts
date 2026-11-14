// Local assistant backend: rule-based answers over the site's own data
// (fixtures, live feed, model, standings) — no LLM, no costs. The widget posts
// { pergunta, contexto } and gets structured blocks back (summary + game rows
// + notes + optional table + links + follow-up chips).
import { createClient } from "@/lib/supabase/server";
import { LEAGUES } from "@/lib/footballData";
import { todayISO } from "@/lib/searchParams";
import {
  AJUDA,
  diaMes,
  diaMesAno,
  fair2,
  hasSideMarker,
  matchLeague,
  matchNav,
  normalizeQuery,
  parsePergunta,
  pct1,
  sameTeam,
  shiftDate,
  teamKey,
  teamQueryWords,
  type JogoResposta,
  type RespostaAssistente,
  type TabelaResposta,
} from "@/lib/assistente";
import {
  fetchLiveEntries,
  linkLocalName,
  lisbonParts,
  loadMaps,
  roundFixtures,
  seasonStandingsTables,
  seasonUpcomingExtra,
  sofaTeamIdFor,
  tournamentLiveFixtures,
  tournamentRounds,
  tournamentSeasons,
  type SofaFixture,
  type SofaMap,
  type SofaStandingRow,
} from "@/lib/sofaHistory";
import { loadSofaLeague, resolveLeagueTeamIds, teamEventList } from "@/lib/sofaLeague";
import { headToHead, predict } from "@/lib/footballModel";
import { buildStandings } from "@/lib/standings";
import { roundLabel, upcomingRounds } from "@/lib/rounds";
import { MIN_GAMES } from "@/lib/recommendation";

const MAX_JOGOS = 40;
const MAX_JORNADA = 12;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Convert = (name: string) => string;

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

const labelOf = (code: string): string => LEAGUES.find((l) => l.code === code)?.label ?? code;
const shortLabel = (code: string): string => labelOf(code).split(" · ").pop() ?? code;

const compareHref = (code: string, home: string, away: string): string =>
  `/estatisticas?${new URLSearchParams({ liga: code, casa: home, fora: away })}`;

const liveHref = (eventId: number): string => `/estatisticas/live?${new URLSearchParams({ sofascore: `id:${eventId}` })}`;

interface EquipaIndex {
  team: string; // local spelling (what the user types)
  league: string;
  leagueLabel: string;
}

// Local spellings of every mapped league's current teams, plus every linked
// team spelling (so "Benfica" matches even mid-season).
async function buildIndex(
  supabase: Supabase,
  userId: string,
  maps: SofaMap[],
  teamMaps: SofaMap[]
): Promise<EquipaIndex[]> {
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert: Convert = (name) => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
  const byLeague = await pool(leagues, 8, async (l) => {
    const map = maps.find((m) => m.name_key === l.code);
    if (!map) return [];
    const seasons = await tournamentSeasons(supabase, userId, map.sofascore_id).catch(() => []);
    if (seasons.length === 0) return [];
    const { seasonTeamNames } = await import("@/lib/sofaHistory");
    const names = await seasonTeamNames(supabase, userId, map.sofascore_id, seasons[0].id, true).catch(() => [] as string[]);
    return names.map((n) => ({ team: convert(n), league: l.code, leagueLabel: l.label as string }));
  });
  const out: EquipaIndex[] = byLeague.flat();
  for (const m of teamMaps) {
    if (!m.local_name) continue;
    if (!out.some((e) => sameTeam(e.team, m.local_name!))) {
      const league = maps.find((t) => t.sofascore_id === m.sofascore_id);
      out.push({ team: m.local_name, league: league?.name_key ?? "", leagueLabel: "" });
    }
  }
  return out;
}

// Up to two distinct teams named in the question, strongest match first (so
// "Sporting CP" wins over "Sporting", and "SL Benfica" matches "Benfica").
function matchTeams(normalized: string, index: EquipaIndex[]): EquipaIndex[] {
  const hay = ` ${normalized.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const scored = index.flatMap((e) => {
    const key = teamKey(e.team);
    if (!key) return [];
    const words = key.split(" ");
    // Every word of the club must be in the question; a full contiguous key
    // always beats a partial one ("Sporting" vs "Sporting Braga").
    if (!words.every((w) => hay.includes(` ${w} `))) return [];
    const full = hay.includes(` ${key} `);
    return [{ e, score: (full ? 1000 : 0) + words.length * 100 + key.length }];
  });
  scored.sort((a, b) => b.score - a.score);
  const out: EquipaIndex[] = [];
  for (const { e } of scored) {
    if (out.some((f) => sameTeam(f.team, e.team))) continue;
    out.push(e);
    if (out.length >= 2) break;
  }
  return out;
}

interface LeagueFixture extends SofaFixture {
  code: string;
  label: string;
}

// Every game between two dates across the mapped leagues (same sources as the
// day board: round window + upcoming + live extras), converted to local names.
async function rangeFixtures(
  supabase: Supabase,
  userId: string,
  maps: SofaMap[],
  from: string,
  to: string,
  limit = MAX_JOGOS
): Promise<LeagueFixture[]> {
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
  const liveEntries = await fetchLiveEntries().catch(() => []);
  const perLeague = await pool(leagues, 4, async (l) => {
    const map = maps.find((m) => m.name_key === l.code);
    if (!map) return [];
    const seasons = await tournamentSeasons(supabase, userId, map.sofascore_id).catch(() => []);
    const s = seasons[0];
    if (!s) return [];
    const { rounds, currentRound } = await tournamentRounds(supabase, userId, map.sofascore_id, s.id, true).catch(() => ({
      rounds: [] as number[],
      currentRound: null as number | null,
    }));
    const flat: SofaFixture[] = [];
    if (rounds.length > 0) {
      const want =
        currentRound !== null
          ? [currentRound - 2, currentRound - 1, currentRound, currentRound + 1, currentRound + 2].filter((r) =>
              rounds.includes(r)
            )
          : rounds.slice(0, 5);
      const lists = await Promise.all(
        want.map((r) => roundFixtures(supabase, userId, map.sofascore_id, s.id, r, true).catch(() => [] as SofaFixture[]))
      );
      for (const x of lists) flat.push(...x);
    }
    const extra = await seasonUpcomingExtra(supabase, userId, map.sofascore_id, s.id, true, currentRound ?? 0).catch(
      () => [] as SofaFixture[]
    );
    const seen = new Set(flat.map((f) => f.id));
    for (const f of [...extra, ...tournamentLiveFixtures(liveEntries, map.sofascore_id, currentRound ?? 0)]) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        flat.push(f);
      }
    }
    return flat
      .filter((f) => f.date >= from && f.date <= to)
      .map((f): LeagueFixture => ({ ...f, code: l.code, label: l.label as string }));
  });
  const seen = new Set<number>();
  return perLeague
    .flat()
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function fixtureRow(f: LeagueFixture, team: string | null, convert: Convert): JogoResposta {
  const home = convert(f.team1);
  const away = convert(f.team2);
  const hg = f.ft?.[0] ?? null;
  const ag = f.ft?.[1] ?? null;
  let resultado: JogoResposta["resultado"];
  if (team && hg !== null && ag !== null) {
    const isHome = sameTeam(home, team);
    const isAway = sameTeam(away, team);
    if (isHome || isAway) {
      const mine = isHome ? hg : ag;
      const theirs = isHome ? ag : hg;
      resultado = mine > theirs ? "V" : mine === theirs ? "E" : "D";
    }
  }
  return {
    league: f.label,
    home,
    away,
    date: f.date,
    time: f.time,
    eventId: f.id,
    ...(hg !== null && ag !== null ? { hg, ag, finished: true } : {}),
    ...(resultado ? { resultado } : {}),
    href: compareHref(f.code, home, away),
  };
}

interface TeamResults {
  jogos: JogoResposta[];
  form: ("V" | "E" | "D")[];
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
}

// Team id from the links, falling back to SofaScore's own search (the links
// often carry 0 until a league page resolves them). Cached 30 days upstream.
async function teamIdFor(
  supabase: Supabase,
  userId: string,
  teamMaps: SofaMap[],
  team: string
): Promise<number | null> {
  const direct = await sofaTeamIdFor(supabase, userId, team).catch(() => null);
  if (direct) return direct;
  // Never guess a reserve/youth side through search: the senior team is the
  // obvious hit and would answer with the wrong games.
  if (hasSideMarker(team)) return null;
  const { resolved } = await resolveLeagueTeamIds(supabase, userId, teamMaps, [team]).catch(() => ({
    resolved: new Map<string, number>(),
    missing: [team],
  }));
  return resolved.get(team) ?? null;
}

// The team's last finished games across competitions, most recent first.
async function teamResults(
  supabase: Supabase,
  userId: string,
  teamMaps: SofaMap[],
  team: string,
  convert: Convert,
  byUid: Map<number, string>,
  limit = 5
): Promise<TeamResults | null> {
  const teamId = await teamIdFor(supabase, userId, teamMaps, team);
  if (!teamId) return null;
  const events = await teamEventList(supabase, userId, teamId, "last").catch(() => []);
  const finished = events
    .filter((s) => s.status === "finished" && s.hg !== null && s.ag !== null)
    .sort((a, b) => b.start - a.start)
    .slice(0, limit);
  const jogos = finished.map((s): JogoResposta => {
    const { date, time } = lisbonParts(s.start);
    const home = convert(s.home);
    const away = convert(s.away);
    const isHome = sameTeam(home, team);
    const mine = isHome ? s.hg! : s.ag!;
    const theirs = isHome ? s.ag! : s.hg!;
    const code = s.uniqueId !== null ? (byUid.get(s.uniqueId) ?? null) : null;
    return {
      league: code ? labelOf(code) : s.tournament,
      home,
      away,
      date,
      time,
      eventId: s.id,
      hg: s.hg,
      ag: s.ag,
      finished: true,
      resultado: mine > theirs ? "V" : mine === theirs ? "E" : "D",
      href: code ? compareHref(code, home, away) : liveHref(s.id),
    };
  });
  const count = (r: "V" | "E" | "D") => jogos.filter((j) => j.resultado === r).length;
  // Goals for/against from the asked team's side, not the home side.
  const gf = finished.reduce((sum, s) => sum + (sameTeam(convert(s.home), team) ? s.hg! : s.ag!), 0);
  const ga = finished.reduce((sum, s) => sum + (sameTeam(convert(s.home), team) ? s.ag! : s.hg!), 0);
  return {
    jogos,
    form: jogos.map((j) => j.resultado!).filter(Boolean),
    wins: count("V"),
    draws: count("E"),
    losses: count("D"),
    gf,
    ga,
  };
}

// The team's next scheduled games (all competitions), soonest first.
async function teamNext(
  supabase: Supabase,
  userId: string,
  teamMaps: SofaMap[],
  team: string,
  convert: Convert,
  byUid: Map<number, string>,
  today: string,
  limit = 5
): Promise<JogoResposta[]> {
  const teamId = await teamIdFor(supabase, userId, teamMaps, team);
  if (!teamId) return [];
  const events = await teamEventList(supabase, userId, teamId, "next").catch(() => []);
  const jogos: JogoResposta[] = [];
  for (const s of events) {
    if (s.status !== "notstarted") continue;
    const { date, time } = lisbonParts(s.start);
    if (date < today) continue;
    const home = convert(s.home);
    const away = convert(s.away);
    const code = s.uniqueId !== null ? (byUid.get(s.uniqueId) ?? null) : null;
    jogos.push({
      league: code ? labelOf(code) : s.tournament,
      home,
      away,
      date,
      time,
      eventId: s.id,
      href: code ? compareHref(code, home, away) : liveHref(s.id),
    });
    if (jogos.length >= limit) break;
  }
  return jogos;
}

// The team's line in the official table of a mapped league, when there is one.
async function standingOf(
  supabase: Supabase,
  userId: string,
  maps: SofaMap[],
  teamMaps: SofaMap[],
  team: string,
  leagueCode: string | null
): Promise<{ row: SofaStandingRow; total: number; label: string; tableName: string } | null> {
  if (!leagueCode) return null;
  const map = maps.find((m) => m.name_key === leagueCode);
  if (!map) return null;
  const seasons = await tournamentSeasons(supabase, userId, map.sofascore_id).catch(() => []);
  const season = seasons[0];
  if (!season) return null;
  const tables = await seasonStandingsTables(supabase, userId, map.sofascore_id, season.id, true).catch(() => []);
  for (const table of tables) {
    const row = table.rows.find((r) => sameTeam(linkLocalName(teamMaps, r.team) ?? r.team, team));
    if (row) return { row, total: table.rows.length, label: labelOf(leagueCode), tableName: table.name };
  }
  return null;
}

function formChips(form: ("V" | "E" | "D")[]): string {
  return form.length > 0 ? form.join("-") : "—";
}

// Form from the league's own fixtures, matched with sameTeam (the links can
// spell the same club two ways: "Benfica" and "Sport Lisboa e Benfica").
function formFor(fixtures: { date: string; team1: string; team2: string; ft: [number, number] | null }[], team: string): ("V" | "E" | "D")[] {
  return fixtures
    .filter((f) => f.ft && (sameTeam(f.team1, team) || sameTeam(f.team2, team)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5)
    .reverse()
    .map((f) => {
      const home = sameTeam(f.team1, team);
      const mine = home ? f.ft![0] : f.ft![1];
      const theirs = home ? f.ft![1] : f.ft![0];
      return mine > theirs ? "V" : mine === theirs ? "E" : "D";
    });
}

// "3.º com 24 pontos em 11 jogos (7V 2E 2D, 21-8)."
function standingText(s: { row: SofaStandingRow; total: number }): string {
  const r = s.row;
  return `${r.position}.º de ${s.total} com ${r.points} ponto${r.points === 1 ? "" : "s"} em ${r.played} jogos (${r.wins}V ${r.draws}E ${r.losses}D, ${r.goalsFor}-${r.goalsAgainst})`;
}

function leagueOfTeam(team: string, index: EquipaIndex[], contexto: { liga?: string } | null): string | null {
  const hit = index.find((e) => sameTeam(e.team, team) && e.league);
  return hit?.league ?? contexto?.liga ?? null;
}

// The top N rows plus the asked team's neighbourhood, so the answer stays
// small but shows where the team sits.
function tableAround(rows: SofaStandingRow[], team: string | null, limit = 6): TabelaResposta["linhas"] {
  const converted = rows.map((r) => ({ ...r }));
  const idx = team ? converted.findIndex((r) => sameTeam(r.team, team)) : -1;
  const picked =
    idx < 0
      ? converted.slice(0, limit)
      : [...new Set([0, 1, idx - 1, idx, idx + 1, converted.length - 1])]
          .filter((i) => i >= 0 && i < converted.length)
          .sort((a, b) => a - b)
          .map((i) => converted[i]);
  return picked.map((r) => ({
    pos: r.position,
    team: r.team,
    jogos: r.played,
    pontos: r.points,
    dg: r.goalsFor - r.goalsAgainst,
    destaque: team ? sameTeam(r.team, team) : false,
  }));
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let pergunta = "";
  let contexto: { equipa?: string; liga?: string; dia?: string } | null = null;
  try {
    const body: unknown = await req.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const raw = body as Record<string, unknown>;
      pergunta = typeof raw.pergunta === "string" ? raw.pergunta : "";
      const c = raw.contexto;
      if (typeof c === "object" && c !== null && !Array.isArray(c)) {
        const cc = c as Record<string, unknown>;
        contexto = {
          equipa: typeof cc.equipa === "string" ? cc.equipa : undefined,
          liga: typeof cc.liga === "string" ? cc.liga : undefined,
          dia: typeof cc.dia === "string" ? cc.dia : undefined,
        };
      }
    }
  } catch {
    pergunta = "";
  }

  const today = todayISO(new Date());
  const intent = parsePergunta(pergunta, today);
  const q = normalizeQuery(pergunta);
  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const teamMaps = await loadMaps(supabase, user.id, "team").catch(() => []);
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert: Convert = (name) => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
  const byUid = new Map(maps.map((m) => [m.sofascore_id, m.name_key]));

  // Only build the team index when the question can actually name a team:
  // it costs one cached read per mapped league.
  const needsTeam =
    intent.kind === "texto" ||
    intent.kind === "resultados" ||
    intent.kind === "classificacao" ||
    intent.kind === "jornada" ||
    teamQueryWords(q).length > 0;
  const index = needsTeam ? await buildIndex(supabase, user.id, maps, teamMaps) : [];
  const found = matchTeams(q, index);
  const explicitTeam = found[0]?.team ?? null;
  // A short follow-up ("e amanhã?", "e o próximo jogo?", "resultados?") leans
  // on the team from the previous answer; a fresh question does not.
  const shortFollowUp =
    /^e\b/.test(q) ||
    (q.split(/\s+/).length <= 4 &&
      /^(proximo|proxima|ultimo|ultima|resultado|resultados|classificacao|jornada|quando|joga|agora)\b/.test(q));
  const useContextTeam = !explicitTeam && !!contexto?.equipa && shortFollowUp;
  const team =
    explicitTeam ??
    (useContextTeam || intent.kind === "resultados" || intent.kind === "classificacao" || intent.kind === "jornada" || intent.kind === "texto"
      ? contexto?.equipa ?? null
      : null);
  const teamLeague = team ? leagueOfTeam(team, index, contexto) : null;
  const baseContext = team ? { equipa: team, ...(teamLeague ? { liga: teamLeague } : {}) } : undefined;

  // Games happening right now in the mapped leagues (or the named team's game
  // wherever it is playing, mapped or not).
  if (intent.kind === "live") {
    const entries = await fetchLiveEntries().catch(() => []);
    const labelOfUid = (uid: number | null): string => {
      const code = uid !== null ? (maps.find((m) => m.sofascore_id === uid)?.name_key ?? null) : null;
      return code ? labelOf(code) : "Outra competição";
    };
    const all: JogoResposta[] = entries.map((g) => ({
      league: labelOfUid(g.uniqueId),
      home: convert(g.home),
      away: convert(g.away),
      date: today,
      time: lisbonParts(Date.parse(g.kickoff) / 1000).time,
      eventId: g.id,
      minute: g.minute,
      hg: g.homeGoals,
      ag: g.awayGoals,
      live: true,
      href: liveHref(g.id),
    }));
    const mine = team ? all.filter((g) => sameTeam(g.home, team) || sameTeam(g.away, team)) : [];
    const jogos = (mine.length > 0 ? mine : team ? [] : all.filter((g) => g.league !== "Outra competição")).slice(0, MAX_JOGOS);

    if (team && jogos.length === 0) {
      const next = await teamNext(supabase, user.id, teamMaps, team, convert, byUid, today, 2);
      const resumo =
        next.length > 0
          ? `${team} não está a jogar agora. Próximo jogo:`
          : `${team} não está a jogar agora e não tem próximos jogos ligados.`;
      return Response.json({
        resumo,
        jogos: next,
        notas: next.length > 0 ? ["O «ao vivo» só mostra jogos a decorrer neste momento."] : [],
        links: [
          { label: "Ao vivo agora", href: "/estatisticas/ao-vivo" },
          ...(teamLeague ? [{ label: "Jornada", href: `/estatisticas/jornada?liga=${teamLeague}` }] : []),
        ],
        sugestoes: [`Resultados do ${team}`, `Quando joga o ${team}?`, "Jogos de hoje?"],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    if (jogos.length === 0) {
      return Response.json({
        resumo: "Nada a decorrer agora nas tuas ligas mapeadas.",
        jogos: [],
        links: [{ label: "Ao vivo agora", href: "/estatisticas/ao-vivo" }],
        sugestoes: ["Jogos de hoje?", "Amanhã?", "Resultados de ontem"],
      } satisfies RespostaAssistente);
    }
    return Response.json({
      resumo:
        team && mine.length > 0
          ? `${team} está a jogar agora:`
          : `${jogos.length} jogo${jogos.length === 1 ? "" : "s"} a decorrer nas tuas ligas:`,
      jogos,
      links: [{ label: "Abrir Ao vivo agora", href: "/estatisticas/ao-vivo" }],
      sugestoes: [
        ...(team ? [`Resultados do ${team}`, `Quando joga o ${team}?`] : []),
        "Jogos de hoje?",
        "Classificação da Primeira Liga",
      ],
      contexto: baseContext,
    } satisfies RespostaAssistente);
  }

  // Whole-day listings: today, tomorrow, yesterday, a date, a weekday or the
  // next seven days. Past days keep their score and result. A named team in a
  // "next games" question skips this block and gets its own fixture list.
  if (
    (intent.kind === "hoje" ||
      intent.kind === "amanha" ||
      intent.kind === "ontem" ||
      intent.kind === "data" ||
      intent.kind === "semana") &&
    !(intent.kind === "semana" && team)
  ) {
    const from =
      intent.kind === "hoje"
        ? today
        : intent.kind === "amanha"
          ? shiftDate(today, 1)
          : intent.kind === "ontem"
            ? shiftDate(today, -1)
            : intent.kind === "data"
              ? intent.date
              : today;
    const to = intent.kind === "semana" ? shiftDate(today, 6) : from;
    const fixtures = await rangeFixtures(supabase, user.id, maps, from, to, intent.kind === "semana" ? 240 : MAX_JOGOS);
    const filtered = team
      ? fixtures.filter((f) => sameTeam(convert(f.team1), team) || sameTeam(convert(f.team2), team))
      : fixtures;
    // A week is too much for one panel: keep every day visible by capping each
    // day at six games (the full list is one click away).
    let jogos = filtered.map((f) => fixtureRow(f, team, convert));
    if (intent.kind === "semana") {
      const byDay = new Map<string, JogoResposta[]>();
      for (const j of jogos) byDay.set(j.date, [...(byDay.get(j.date) ?? []), j]);
      jogos = [...byDay.values()].flatMap((list) => list.slice(0, 6));
    }
    const daysWithGames = new Set(jogos.map((j) => j.date)).size;

    const quando =
      intent.kind === "hoje"
        ? "hoje"
        : intent.kind === "amanha"
          ? "amanhã"
          : intent.kind === "ontem"
            ? "ontem"
            : intent.kind === "data"
              ? `a ${diaMes(intent.date)}`
              : "nos próximos 7 dias";
    const quem = team ? ` do ${team}` : "";
    const finished = jogos.filter((j) => j.finished);
    if (jogos.length === 0) {
      return Response.json({
        resumo: `Sem jogos${quem} ${quando} nas ligas mapeadas.`,
        jogos: [],
        links: [{ label: "Ver Jogos por dia", href: `/estatisticas/jogos-dia?data=${from}` }],
        sugestoes: team
          ? [`Quando joga o ${team}?`, `Resultados do ${team}`, "Jogos de hoje?"]
          : ["Jogos de hoje?", "Amanhã?", "Esta semana?"],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    const resumo =
      finished.length === jogos.length
        ? `${jogos.length} resultado${jogos.length === 1 ? "" : "s"}${quem} ${quando}:`
        : `${jogos.length} jogo${jogos.length === 1 ? "" : "s"}${quem} ${quando}${finished.length > 0 ? ` (${finished.length} já terminado${finished.length === 1 ? "" : "s"})` : ""}:`;
    return Response.json({
      resumo,
      jogos,
      notas: [
        ...(intent.kind === "ontem" || (intent.kind === "data" && from < today)
          ? ["Resultados com o marcador final; clica em «comparar» para abrir a análise."]
          : []),
        ...(intent.kind === "semana"
          ? [`${daysWithGames} dia${daysWithGames === 1 ? "" : "s"} com jogos · até 6 por dia (abre Jogos por dia para a lista completa).`]
          : []),
      ],
      links: [{ label: "Ver Jogos por dia", href: `/estatisticas/jogos-dia?data=${from}` }],
      sugestoes: team
        ? [`Resultados do ${team}`, `Classificação do ${team}`, "Jogos de hoje?"]
        : ["Ao vivo agora?", "Resultados de ontem", "Esta semana?"],
      contexto: { ...(baseContext ?? {}), dia: from },
    } satisfies RespostaAssistente);
  }

  // The user's bots at a glance.
  if (intent.kind === "bots") {
    const { data: bots } = await supabase.from("bots").select("id,name,enabled").eq("user_id", user.id);
    const all = (bots ?? []) as { id: string; name: string; enabled: boolean }[];
    const on = all.filter((b) => b.enabled);
    const { data: alerts } = await supabase
      .from("bot_alerts")
      .select("id,minute,market,hit,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3);
    const recent = (alerts ?? []) as { minute: number; market: string; hit: boolean | null; created_at: string }[];
    const resumo =
      all.length === 0
        ? "Ainda não tens bots. Cria um na página Bots."
        : `${on.length} de ${all.length} bots ligados${recent.length > 0 ? `; último alerta: ${recent[0].market} aos ${recent[0].minute}′ (${recent[0].hit === null ? "por decidir" : recent[0].hit ? "certo" : "falhado"})` : ""}.`;
    const notas = all.slice(0, 6).map((b) => `${b.enabled ? "🟢" : "⚪"} ${b.name}`);
    for (const a of recent) {
      const when = new Date(a.created_at);
      const hh = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      notas.push(
        `Alerta ${hh} · ${a.market} aos ${a.minute}′ · ${a.hit === null ? "por decidir" : a.hit ? "certo" : "falhado"}`
      );
    }
    return Response.json({
      resumo,
      jogos: [],
      notas,
      links: [{ label: "Abrir Bots", href: "/bots" }],
      sugestoes: ["Jogos de hoje?", "Ao vivo agora?", "Onde ficam as múltiplas?"],
    } satisfies RespostaAssistente);
  }

  if (intent.kind === "ajuda") {
    return Response.json({
      resumo: AJUDA,
      jogos: [],
      links: [{ label: "Jogos por dia", href: "/estatisticas/jogos-dia" }],
      sugestoes: ["Ao vivo agora?", "Jogos de hoje?", "Resultados do Benfica", "Classificação da Primeira Liga"],
    } satisfies RespostaAssistente);
  }

  // Results of one team (last five, all competitions).
  if (intent.kind === "resultados") {
    if (!team) {
      return Response.json({
        resumo: "Diz-me a equipa: «resultados do Benfica», «últimos jogos do Porto».",
        jogos: [],
        links: [{ label: "Jogos por dia", href: "/estatisticas/jogos-dia" }],
        sugestoes: ["Resultados do Benfica", "Resultados do Porto", "Resultados de ontem"],
      } satisfies RespostaAssistente);
    }
    const results = await teamResults(supabase, user.id, teamMaps, team, convert, byUid, 5);
    if (!results || results.jogos.length === 0) {
      return Response.json({
        resumo: `${team} não tem resultados ligados no Mapa (ou ainda não jogou).`,
        jogos: [],
        links: [{ label: "Abrir Mapa", href: "/estatisticas/mapa" }],
        sugestoes: [`Quando joga o ${team}?`, "Jogos de hoje?"],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    const standing = await standingOf(supabase, user.id, maps, teamMaps, team, teamLeague);
    const next = await teamNext(supabase, user.id, teamMaps, team, convert, byUid, today, 1);
    const notas = [
      `Últimos ${results.jogos.length}: ${results.wins}V ${results.draws}E ${results.losses}D · ${results.gf} marcados, ${results.ga} sofridos.`,
      ...(standing ? [`Classificação: ${standingText(standing)}.`] : []),
      ...(next.length > 0
        ? [`Próximo: ${diaMes(next[0].date)}${next[0].time ? ` às ${next[0].time.slice(0, 5)}` : ""} · ${next[0].home} vs ${next[0].away} (${next[0].league}).`]
        : []),
    ];
    return Response.json({
      resumo: `Últimos jogos do ${team}:`,
      jogos: results.jogos,
      notas,
      links: [
        { label: "Análise equipa", href: `/estatisticas/equipa?equipa=${encodeURIComponent(team)}` },
        ...(teamLeague ? [{ label: "Classificação", href: `/estatisticas/classificacao?liga=${teamLeague}` }] : []),
      ],
      sugestoes: [`Quando joga o ${team}?`, `Classificação do ${team}`, `Jornada da ${teamLeague ? shortLabel(teamLeague) : "Primeira Liga"}`],
      contexto: baseContext,
    } satisfies RespostaAssistente);
  }

  // Official table, around the asked team or the top of a named league.
  if (intent.kind === "classificacao") {
    const code = teamLeague ?? matchLeague(q);
    if (!code) {
      return Response.json({
        resumo: "Diz-me a liga ou a equipa: «classificação da Primeira Liga», «classificação do Benfica».",
        jogos: [],
        links: [{ label: "Classificação", href: "/estatisticas/classificacao" }],
        sugestoes: ["Classificação da Primeira Liga", "Classificação da Premier League", "Classificação do Benfica"],
      } satisfies RespostaAssistente);
    }
    const loaded = await loadSofaLeague(supabase, user.id, code, { history: false, shots: false }).catch(() => null);
    if (!loaded) {
      return Response.json({
        resumo: `Sem dados do SofaScore para ${labelOf(code)}. Liga a liga no Mapa.`,
        jogos: [],
        links: [{ label: "Abrir Mapa", href: "/estatisticas/mapa" }],
        sugestoes: ["Classificação da Primeira Liga", "Jogos de hoje?"],
      } satisfies RespostaAssistente);
    }
    // Official table when the league has one; otherwise count the season's
    // own fixtures (same fallback as the classification page).
    const official = loaded.tables[0] ?? null;
    const rows: SofaStandingRow[] = official
      ? official.rows.map((r) => ({
          position: r.position,
          team: linkLocalName(teamMaps, r.team) ?? r.team,
          played: r.played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goalsFor: r.gf,
          goalsAgainst: r.ga,
          points: r.points,
        }))
      : buildStandings(loaded.data.fixtures).map((r, i) => ({
          position: i + 1,
          team: r.team,
          played: r.played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goalsFor: r.gf,
          goalsAgainst: r.ga,
          points: r.points,
        }));
    const tableName = official?.name ?? "";
    const row = team ? rows.find((r) => sameTeam(r.team, team)) ?? null : null;
    if (team && !row) {
      return Response.json({
        resumo: `${team} não aparece na tabela de ${labelOf(code)}.`,
        jogos: [],
        links: [{ label: "Classificação", href: `/estatisticas/classificacao?liga=${code}` }],
        sugestoes: [`Resultados do ${team}`, `Jornada da ${shortLabel(code)}`],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    const linhas = tableAround(rows, team);
    for (const l of linhas) {
      const full = rows.find((r) => r.position === l.pos);
      if (full) l.forma = formFor(loaded.data.fixtures, full.team);
      if (l.destaque && team) l.team = team;
    }
    const resumo = row
      ? `${team}: ${standingText({ row, total: rows.length })}.`
      : `${labelOf(code)}: ${tableName || "classificação"} (top ${linhas.length}).`;
    return Response.json({
      resumo,
      jogos: [],
      notas: [
        row ? `Forma: ${formChips(formFor(loaded.data.fixtures, team!))} (últimos 5 da liga).` : "",
        `Tabela: ${tableName || "calculada dos resultados"} · ${rows.length} equipas.`,
      ].filter(Boolean),
      tabela: { titulo: tableName || labelOf(code), linhas },
      links: [
        { label: "Classificação completa", href: `/estatisticas/classificacao?liga=${code}` },
        ...(team ? [{ label: `Jornada da ${shortLabel(code)}`, href: `/estatisticas/jornada?liga=${code}` }] : []),
      ],
      sugestoes: [
        ...(team ? [`Resultados do ${team}`, `Quando joga o ${team}?`] : []),
        `Jornada da ${shortLabel(code)}`,
        "Jogos de hoje?",
      ],
      contexto: { ...(baseContext ?? {}), liga: code },
    } satisfies RespostaAssistente);
  }

  // Current round of a league, with the model's probabilities per game.
  if (intent.kind === "jornada") {
    const code = teamLeague ?? matchLeague(q);
    if (!code) {
      return Response.json({
        resumo: "Diz-me a liga: «jornada da Primeira Liga».",
        jogos: [],
        links: [{ label: "Jogos da jornada", href: "/estatisticas/jornada" }],
        sugestoes: ["Jornada da Primeira Liga", "Jornada da Premier League", "Jogos de hoje?"],
      } satisfies RespostaAssistente);
    }
    const loaded = await loadSofaLeague(supabase, user.id, code, { history: false, shots: false }).catch(() => null);
    const rounds = loaded ? upcomingRounds(loaded.data.fixtures, today) : [];
    const round = rounds[0] ?? null;
    if (!loaded || !round) {
      return Response.json({
        resumo: `Sem próxima jornada para ${labelOf(code)} (dados do SofaScore em falta ou época terminada).`,
        jogos: [],
        links: [{ label: "Jogos da jornada", href: `/estatisticas/jornada?liga=${code}` }],
        sugestoes: [`Classificação da ${shortLabel(code)}`, "Jogos de hoje?"],
        contexto: { ...(baseContext ?? {}), liga: code },
      } satisfies RespostaAssistente);
    }
    const now = new Date();
    const jogos: JogoResposta[] = round.fixtures.slice(0, MAX_JORNADA).map((f): JogoResposta => {
      const home = convert(f.team1);
      const away = convert(f.team2);
      if (f.ft) {
        return {
          league: labelOf(code),
          home,
          away,
          date: f.date,
          time: f.time ?? null,
          eventId: null,
          hg: f.ft[0],
          ag: f.ft[1],
          finished: true,
          href: compareHref(code, home, away),
        };
      }
      const p = predict(loaded.data.matches, f.team1, f.team2, now);
      const games = Math.min(p.gamesHome, p.gamesAway);
      return {
        league: labelOf(code),
        home,
        away,
        date: f.date,
        time: f.time ?? null,
        eventId: null,
        pHome: p.fullTime.home,
        pDraw: p.fullTime.draw,
        pAway: p.fullTime.away,
        nota:
          games < MIN_GAMES
            ? "Estimativa frágil (poucos jogos)"
            : `Mais de 2,5: ${pct1(p.over["2.5"] ?? 0)} · ambas marcam: ${pct1(p.bothScore)}`,
        href: compareHref(code, home, away),
      };
    });
    return Response.json({
      resumo: `${roundLabel(round.name)} · ${labelOf(code)}: ${jogos.length} jogo${jogos.length === 1 ? "" : "s"} (probabilidades do modelo).`,
      jogos,
      notas: [
        `Primeiro jogo: ${diaMes(round.first)}.`,
        "As probabilidades usam só os jogos anteriores de cada equipa; amostra pequena aparece marcada.",
      ],
      links: [{ label: "Jogos da jornada", href: `/estatisticas/jornada?liga=${code}` }],
      sugestoes: [`Classificação da ${shortLabel(code)}`, "Jogos de hoje?", "Ao vivo agora?"],
      contexto: { ...(baseContext ?? {}), liga: code },
    } satisfies RespostaAssistente);
  }

  // Everything else: two teams -> matchup model; one team -> next games plus
  // recent form; then site pages; then help.
  const texto = intent.kind === "texto" ? intent.texto : pergunta;

  // Two teams of the same league: model probabilities, like Comparar.
  const pair = found.length >= 2 ? found.slice(0, 2) : [];
  const sameLeague = pair.length === 2 && pair[0].league && pair[0].league === pair[1].league ? pair[0].league : null;
  if (sameLeague) {
    const [home, away] = [pair[0].team, pair[1].team];
    const loaded = await loadSofaLeague(supabase, user.id, sameLeague, { history: false, shots: false }).catch(() => null);
    if (loaded) {
      const now = new Date();
      const p = predict(loaded.data.matches, home, away, now);
      const games = Math.min(p.gamesHome, p.gamesAway);
      const label = labelOf(sameLeague);
      const resumo =
        `${home} vs ${away} (${label}): ` +
        `casa ${pct1(p.fullTime.home)} (justa ${fair2(p.fullTime.home)}), ` +
        `empate ${pct1(p.fullTime.draw)}, fora ${pct1(p.fullTime.away)} (justa ${fair2(p.fullTime.away)}). ` +
        `Mais de 2,5: ${pct1(p.over["2.5"] ?? 0)}; ambas marcam: ${pct1(p.bothScore)}. ` +
        `Base: ${games} jogos cada${games < MIN_GAMES ? " — estimativa frágil" : ""}.`;
      const h2h = headToHead(loaded.data.matches, home, away).slice(0, 3);
      const nextMeeting =
        loaded.data.fixtures
          .filter(
            (f) =>
              !f.ft &&
              f.date >= today &&
              ((sameTeam(f.team1, home) && sameTeam(f.team2, away)) ||
                (sameTeam(f.team1, away) && sameTeam(f.team2, home)))
          )
          .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
      const notas = [
        `Forma: ${home} ${formChips(formFor(loaded.data.fixtures, home))} · ${away} ${formChips(formFor(loaded.data.fixtures, away))}.`,
        ...(nextMeeting
          ? [`Próximo confronto marcado: ${diaMes(nextMeeting.date)}${nextMeeting.time ? ` às ${nextMeeting.time.slice(0, 5)}` : ""}.`]
          : []),
        ...(h2h.length > 0
          ? [
              `Confrontos: ${h2h
                .map((m) => `${diaMes(m.date)} ${m.team1} ${m.ft[0]}–${m.ft[1]} ${m.team2}`)
                .join(" · ")}.`,
            ]
          : []),
      ];
      return Response.json({
        resumo,
        jogos: [
          {
            league: label,
            home,
            away,
            date: nextMeeting?.date ?? today,
            time: nextMeeting?.time ?? null,
            eventId: null,
            pHome: p.fullTime.home,
            pDraw: p.fullTime.draw,
            pAway: p.fullTime.away,
            nota: nextMeeting ? "Data do próximo confronto marcado." : "Sem data marcada nos dados; probabilidades do modelo.",
            href: compareHref(sameLeague, home, away),
          },
        ],
        notas,
        links: [{ label: "Abrir no Comparar", href: compareHref(sameLeague, home, away) }],
        sugestoes: [`Resultados do ${home}`, `Resultados do ${away}`, `Classificação da ${shortLabel(sameLeague)}`],
        contexto: { equipa: home, liga: sameLeague },
      } satisfies RespostaAssistente);
    }
  }

  // One team: its next games, with recent form and table position alongside.
  if (team) {
    const next = await teamNext(supabase, user.id, teamMaps, team, convert, byUid, today, 5);
    const results = await teamResults(supabase, user.id, teamMaps, team, convert, byUid, 5);
    const standing = await standingOf(supabase, user.id, maps, teamMaps, team, teamLeague);
    if (next.length > 0) {
      const notas = [
        ...(standing ? [`${standing.label}: ${standingText(standing)}.`] : []),
        ...(results && results.jogos.length > 0
          ? [
              `Forma (todas as competições): ${formChips(results.form)} (${results.wins}V ${results.draws}E ${results.losses}D).`,
              `Último: ${diaMesAno(results.jogos[0].date)} ${results.jogos[0].home} ${results.jogos[0].hg}–${results.jogos[0].ag} ${results.jogos[0].away}.`,
            ]
          : []),
      ];
      return Response.json({
        resumo: `Próximos jogos do ${team}${standing ? ` (${standing.row.position}.º, ${standing.row.points} pts)` : ""}:`,
        jogos: next,
        notas,
        links: [
          ...(teamLeague ? [{ label: "Classificação", href: `/estatisticas/classificacao?liga=${teamLeague}` }] : []),
          { label: "Análise equipa", href: `/estatisticas/equipa?equipa=${encodeURIComponent(team)}` },
        ],
        sugestoes: [`Resultados do ${team}`, `Classificação do ${team}`, "Jogos de hoje?"],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    if (results && results.jogos.length > 0) {
      return Response.json({
        resumo: `${team} não tem próximos jogos ligados. Últimos resultados:`,
        jogos: results.jogos,
        notas: [
          `Forma (todas as competições): ${formChips(results.form)} (${results.wins}V ${results.draws}E ${results.losses}D).`,
          ...(standing ? [`${standing.label}: ${standingText(standing)}.`] : []),
        ],
        links: [{ label: "Abrir Mapa", href: "/estatisticas/mapa" }],
        sugestoes: [`Classificação do ${team}`, "Jogos de hoje?"],
        contexto: baseContext,
      } satisfies RespostaAssistente);
    }
    return Response.json({
      resumo: `${team} não está ligado no Mapa (ou sem jogos ligados). Liga a equipa para eu seguir os jogos.`,
      jogos: [],
      links: [{ label: "Abrir Mapa", href: "/estatisticas/mapa" }],
      sugestoes: ["Jogos de hoje?", "Ao vivo agora?"],
      contexto: baseContext,
    } satisfies RespostaAssistente);
  }

  // Site pages by name.
  const nav = matchNav(normalizeQuery(texto));
  if (nav) {
    return Response.json({
      resumo: `É aqui: ${nav.label}.`,
      jogos: [],
      links: [nav],
      sugestoes: ["Jogos de hoje?", "Ao vivo agora?", "Resultados do Benfica"],
    } satisfies RespostaAssistente);
  }

  return Response.json({
    resumo: AJUDA,
    jogos: [],
    links: [{ label: "Jogos por dia", href: "/estatisticas/jogos-dia" }],
    sugestoes: ["Ao vivo agora?", "Jogos de hoje?", "Resultados do Benfica", "Classificação da Primeira Liga"],
  } satisfies RespostaAssistente);
}
