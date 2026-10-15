// Local assistant backend: rule-based answers over the site's own data
// (fixtures, live feed, model) — no LLM, no costs. The widget posts
// { pergunta } and gets structured blocks back (summary + game rows + links).
import { createClient } from "@/lib/supabase/server";
import { LEAGUES } from "@/lib/footballData";
import { todayISO } from "@/lib/searchParams";
import {
  AJUDA,
  diaMes,
  fair2,
  matchNav,
  normalizeQuery,
  parsePergunta,
  pct1,
  type JogoResposta,
  type RespostaAssistente,
} from "@/lib/assistente";
import {
  fetchLiveEntries,
  linkLocalName,
  lisbonParts,
  loadMaps,
  roundFixtures,
  seasonUpcomingExtra,
  sofaTeamIdFor,
  tournamentLiveFixtures,
  tournamentRounds,
  tournamentSeasons,
  type SofaFixture,
  type SofaMap,
} from "@/lib/sofaHistory";
import { loadSofaLeague, teamEventList } from "@/lib/sofaLeague";
import { predict } from "@/lib/footballModel";
import { MIN_GAMES } from "@/lib/recommendation";

const MAX_JOGOS = 40;

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

const shift = (date: string, by: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface EquipaIndex {
  team: string; // local spelling (what the user types)
  league: string;
  leagueLabel: string;
}

// Local spellings of every mapped league's current teams, plus every linked
// team spelling (so "Benfica" matches even mid-season).
async function buildIndex(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  maps: SofaMap[],
  teamMaps: SofaMap[]
): Promise<EquipaIndex[]> {
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
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
    if (!out.some((e) => e.team === m.local_name)) {
      const league = maps.find((t) => t.sofascore_id === m.sofascore_id);
      out.push({ team: m.local_name, league: league?.name_key ?? "", leagueLabel: "" });
    }
  }
  return out;
}

// Up to two distinct teams named in the question, longest names first (so
// "Sporting CP" wins over "Sporting").
function matchTeams(normalized: string, index: EquipaIndex[]): EquipaIndex[] {
  const found: EquipaIndex[] = [];
  const padded = ` ${normalized} `;
  const cands = [...index].sort((a, b) => b.team.length - a.team.length);
  for (const c of cands) {
    const needle = normalizeQuery(c.team);
    if (needle.length < 3) continue;
    if (!padded.includes(` ${needle} `) && !padded.includes(` ${needle}s `)) continue;
    if (found.some((f) => f.team === c.team)) continue;
    found.push(c);
    if (found.length >= 2) break;
  }
  return found;
}

// Every game of one day across the mapped leagues (same sources as the day
// board: round window + upcoming + live extras), converted to local spellings.
async function dayGames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  maps: SofaMap[],
  teamMaps: SofaMap[],
  day: string
): Promise<JogoResposta[]> {
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;
  const labelOf = (code: string): string => LEAGUES.find((l) => l.code === code)?.label ?? code;
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
          ? [currentRound - 1, currentRound, currentRound + 1].filter((r) => rounds.includes(r))
          : rounds.slice(0, 3);
      const lists = await Promise.all(
        want.map((r) => roundFixtures(supabase, userId, map.sofascore_id, s.id, r, true).then((x) => x, () => null))
      );
      for (const x of lists) if (x !== null) flat.push(...x);
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
      .filter((f) => f.date === day)
      .map(
        (f): JogoResposta => ({
          league: labelOf(l.code),
          home: convert(f.team1),
          away: convert(f.team2),
          date: f.date,
          time: f.time,
          eventId: f.id,
          href: `/estatisticas?${new URLSearchParams({ liga: l.code, casa: convert(f.team1), fora: convert(f.team2) })}`,
        })
      );
  });
  return perLeague
    .flat()
    .sort((a, b) => `${a.time ?? ""}`.localeCompare(`${b.time ?? ""}`) || a.league.localeCompare(b.league))
    .slice(0, MAX_JOGOS);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let pergunta = "";
  try {
    pergunta = String((await req.json())?.pergunta ?? "");
  } catch {
    pergunta = "";
  }
  const today = todayISO(new Date());
  const intent = parsePergunta(pergunta, today);
  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const teamMaps = await loadMaps(supabase, user.id, "team").catch(() => []);
  const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
  const convert = (name: string): string => toLocal.get(name) ?? linkLocalName(teamMaps, name) ?? name;

  // Games happening right now in the mapped leagues.
  if (intent.kind === "live") {
    const entries = await fetchLiveEntries().catch(() => []);
    const ids = new Set(maps.map((m) => m.sofascore_id));
    const labelOf = (uid: number | null): string => {
      const code = maps.find((m) => m.sofascore_id === uid)?.name_key;
      return code ? (LEAGUES.find((l) => l.code === code)?.label ?? code) : "Outra competição";
    };
    const jogos: JogoResposta[] = entries
      .filter((g) => g.uniqueId !== null && ids.has(g.uniqueId))
      .map((g) => ({
        league: labelOf(g.uniqueId),
        home: convert(g.home),
        away: convert(g.away),
        date: today,
        time: lisbonParts(Date.parse(g.kickoff) / 1000).time,
        eventId: g.id,
        minute: g.minute,
        hg: g.homeGoals,
        ag: g.awayGoals,
        live: true,
        href: `/estatisticas/ao-vivo`,
      }))
      .slice(0, MAX_JOGOS);
    if (jogos.length === 0) {
      return Response.json({
        resumo: "Nada a decorrer agora nas tuas ligas mapeadas.",
        jogos: [],
        links: [{ label: "Ao vivo agora", href: "/estatisticas/ao-vivo" }],
      } satisfies RespostaAssistente);
    }
    return Response.json({
      resumo: `${jogos.length} jogo${jogos.length === 1 ? "" : "s"} a decorrer nas tuas ligas:`,
      jogos,
      links: [{ label: "Abrir Ao vivo agora", href: "/estatisticas/ao-vivo" }],
    } satisfies RespostaAssistente);
  }

  // Whole-day listings: today, tomorrow or an explicit date.
  if (intent.kind === "hoje" || intent.kind === "amanha" || intent.kind === "data") {
    const day = intent.kind === "hoje" ? today : intent.kind === "amanha" ? shift(today, 1) : intent.date;
    const jogos = await dayGames(supabase, user.id, maps, teamMaps, day);
    const quando = intent.kind === "hoje" ? "hoje" : intent.kind === "amanha" ? "amanhã" : `a ${diaMes(day)}`;
    if (jogos.length === 0) {
      return Response.json({
        resumo: `Sem jogos ${quando} nas ligas mapeadas.`,
        jogos: [],
        links: [{ label: "Ver Jogos por dia", href: `/estatisticas/jogos-dia?data=${day}` }],
      } satisfies RespostaAssistente);
    }
    return Response.json({
      resumo: `${jogos.length} jogo${jogos.length === 1 ? "" : "s"} ${quando} (clica para comparar):`,
      jogos,
      links: [{ label: "Ver Jogos por dia", href: `/estatisticas/jogos-dia?data=${day}` }],
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
        ? "Ainda não tens bots."
        : `${on.length} de ${all.length} bots ligados${recent.length > 0 ? `; último alerta: ${recent[0].market} aos ${recent[0].minute}′ (${recent[0].hit === null ? "por decidir" : recent[0].hit ? "certo" : "falhado"})` : ""}.`;
    return Response.json({
      resumo,
      jogos: [],
      links: [{ label: "Abrir Bots", href: "/bots" }],
    } satisfies RespostaAssistente);
  }

  // Everything else: teams first, then site pages, then help.
  const texto = intent.kind === "texto" ? intent.texto : pergunta;
  const index = await buildIndex(supabase, user.id, maps, teamMaps);
  const found = matchTeams(normalizeQuery(texto), index);

  // Two teams of the same league: model probabilities, like Comparar.
  const pair = found.length >= 2 ? found.slice(0, 2) : [];
  const sameLeague = pair.length === 2 && pair[0].league && pair[0].league === pair[1].league ? pair[0].league : null;
  if (sameLeague) {
    const [home, away] = pair[0].team === found[0].team ? [found[0].team, found[1].team] : [found[1].team, found[0].team];
    const loaded = await loadSofaLeague(supabase, user.id, sameLeague, { history: false, shots: false }).catch(() => null);
    if (loaded) {
      const now = new Date();
      const p = predict(loaded.data.matches, home, away, now);
      const games = Math.min(p.gamesHome, p.gamesAway);
      const label = LEAGUES.find((l) => l.code === sameLeague)?.label ?? sameLeague;
      const resumo =
        `${home} vs ${away} (${label}): ` +
        `casa ${pct1(p.fullTime.home)} (justa ${fair2(p.fullTime.home)}), ` +
        `empate ${pct1(p.fullTime.draw)}, fora ${pct1(p.fullTime.away)} (justa ${fair2(p.fullTime.away)}). ` +
        `Mais de 2,5: ${pct1(p.over["2.5"] ?? 0)}; ambas marcam: ${pct1(p.bothScore)}. ` +
        `Base: ${games} jogos cada${games < MIN_GAMES ? " — estimativa frágil" : ""}.`;
      return Response.json({
        resumo,
        jogos: [
          {
            league: label,
            home,
            away,
            date: today,
            time: null,
            eventId: null,
            pHome: p.fullTime.home,
            pDraw: p.fullTime.draw,
            pAway: p.fullTime.away,
            href: `/estatisticas?${new URLSearchParams({ liga: sameLeague, casa: home, fora: away })}`,
          },
        ],
        links: [{ label: "Abrir no Comparar", href: `/estatisticas?${new URLSearchParams({ liga: sameLeague, casa: home, fora: away })}` }],
      } satisfies RespostaAssistente);
    }
  }

  // One team: its next games (own event list, no league scan needed).
  if (found.length >= 1) {
    const team = found[0].team;
    const teamId = await sofaTeamIdFor(supabase, user.id, team).catch(() => null);
    if (teamId) {
      const events = await teamEventList(supabase, user.id, teamId, "next").catch(() => []);
      const byUid = new Map(maps.map((m) => [m.sofascore_id, m.name_key]));
      const jogos: JogoResposta[] = [];
      for (const s of events) {
        if (s.status !== "notstarted") continue;
        const { date, time } = lisbonParts(s.start);
        if (date < today) continue;
        const code = s.uniqueId !== null ? (byUid.get(s.uniqueId) ?? null) : null;
        const label = code ? (LEAGUES.find((l) => l.code === code)?.label ?? s.tournament) : s.tournament;
        jogos.push({
          league: label,
          home: convert(s.home),
          away: convert(s.away),
          date,
          time,
          eventId: s.id,
          href:
            code && (convert(s.home) === team || convert(s.away) === team)
              ? `/estatisticas?${new URLSearchParams({ liga: code, casa: convert(s.home), fora: convert(s.away) })}`
              : undefined,
        });
        if (jogos.length >= 5) break;
      }
      if (jogos.length > 0) {
        return Response.json({
          resumo: `Próximos jogos do ${team}:`,
          jogos,
          links: [],
        } satisfies RespostaAssistente);
      }
    }
    return Response.json({
      resumo: `${team} não está ligado no Mapa (ou sem próximos jogos). Liga a equipa para eu seguir os jogos.`,
      jogos: [],
      links: [{ label: "Abrir Mapa", href: "/estatisticas/mapa" }],
    } satisfies RespostaAssistente);
  }

  // Site pages by name.
  const nav = matchNav(normalizeQuery(texto));
  if (nav) {
    return Response.json({
      resumo: `É aqui: ${nav.label}.`,
      jogos: [],
      links: [nav],
    } satisfies RespostaAssistente);
  }

  return Response.json({ resumo: AJUDA, jogos: [], links: [] } satisfies RespostaAssistente);
}
