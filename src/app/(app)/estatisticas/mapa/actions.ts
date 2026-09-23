"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  alignScore,
  alignTeamNames,
  intlQueryVariants,
  loadMaps,
  nationalFit,
  searchTeams,
  searchTournaments,
  seasonResults,
  seasonStandings,
  suggestTournament,
  teamQueryVariants,
  tournamentRounds,
  tournamentSeasons,
  type SofaCandidate,
} from "@/lib/sofaHistory";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return { supabase, user };
}

export async function searchSofaAction(query: string): Promise<SofaCandidate[]> {
  await authed();
  if (!query.trim()) return [];
  return searchTournaments(query);
}

export async function saveSofaTournamentAction(
  leagueCode: string,
  uniqueId: number,
  name: string,
  slug: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  if (!leagueCode || !Number.isInteger(uniqueId) || uniqueId <= 0) {
    return { ok: false, error: "Mapeamento inválido." };
  }
  const { error } = await supabase.from("sofascore_maps").upsert(
    {
      user_id: user.id,
      kind: "tournament",
      name_key: leagueCode,
      sofascore_id: uniqueId,
      name: name.slice(0, 120),
      slug: slug.slice(0, 120),
    },
    { onConflict: "user_id,kind,name_key" }
  );
  if (error) return { ok: false, error: "Não foi possível guardar. Corre a migração 0033 e tenta de novo." };
  revalidatePath("/estatisticas/mapa");
  return { ok: true };
}

export async function deleteSofaMapAction(
  leagueCode: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  const { error } = await supabase
    .from("sofascore_maps")
    .delete()
    .eq("user_id", user.id)
    .eq("kind", "tournament")
    .eq("name_key", leagueCode);
  if (error) return { ok: false, error: "Não foi possível remover." };
  revalidatePath("/estatisticas/mapa");
  return { ok: true };
}

// End-to-end proof for one mapped league: seasons, current-season rounds and
// finished games, all through scraper + cache. Heavy on first run (one call
// per round), instant afterwards.
export async function testSofaLeagueAction(leagueCode: string): Promise<  | { ok: true; tournament: string; seasons: { id: number; name: string }[]; currentRounds: number; finishedGames: number; latest: string | null }
  | { ok: false; error: string }
> {
  const { supabase, user } = await authed();
  const maps = await loadMaps(supabase, user.id, "tournament");
  const map = maps.find((m) => m.name_key === leagueCode);
  if (!map) return { ok: false, error: "Liga por mapear." };
  try {
    const seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
    if (seasons.length === 0) return { ok: false, error: "O SofaScore não devolveu épocas." };
    const currentId = seasons[0].id;
    const { rounds } = await tournamentRounds(supabase, user.id, map.sofascore_id, currentId, true);
    const games = await seasonResults(supabase, user.id, map.sofascore_id, currentId, true);
    return {
      ok: true,
      tournament: map.name,
      seasons: seasons.slice(0, 5).map((s) => ({ id: s.id, name: s.name })),
      currentRounds: rounds.length,
      finishedGames: games.length,
      latest: games.at(-1)?.date ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falhou a leitura." };
  }
}

// Maps every still-unmapped league in one go: best same-country guess each,
// saved only when unambiguous enough (suggestTournament rules). Returns what
// was mapped and what still needs a human (no good guess). Needs LEAGUES here
// (server action, no client import of footballData needed beyond the const).
export async function autoMapAllAction(): Promise<{
  mapped: { code: string; label: string; name: string; alternatives: number }[];
  skipped: { code: string; label: string }[];
}> {
  const { supabase, user } = await authed();
  const { LEAGUES } = await import("@/lib/footballData");
  const existing = new Set((await loadMaps(supabase, user.id, "tournament")).map((m) => m.name_key));
  const mapped: { code: string; label: string; name: string; alternatives: number }[] = [];
  const skipped: { code: string; label: string }[] = [];
  for (const league of LEAGUES) {
    if (league.code.startsWith("int.") || existing.has(league.code)) continue;
    try {
      const suggestion = await suggestTournament(league.label as string);
      if (!suggestion) {
        skipped.push({ code: league.code, label: league.label as string });
        continue;
      }
      const { error } = await supabase.from("sofascore_maps").upsert(
        {
          user_id: user.id,
          kind: "tournament",
          name_key: league.code,
          sofascore_id: suggestion.pick.uniqueId!,
          name: suggestion.pick.name.slice(0, 120),
          slug: suggestion.pick.slug.slice(0, 120),
        },
        { onConflict: "user_id,kind,name_key" }
      );
      if (error) skipped.push({ code: league.code, label: league.label as string });
      else {
        existing.add(league.code);
        mapped.push({ code: league.code, label: league.label as string, name: suggestion.pick.name, alternatives: suggestion.alternatives });
      }
    } catch {
      skipped.push({ code: league.code, label: league.label as string });
    }
  }
  revalidatePath("/estatisticas/mapa");
  return { mapped, skipped };
}

// Aligns a mapped league's clubs: local spellings vs SofaScore spellings.
// Confident fits are saved (kind 'team', keyed by club slug); the rest comes
// back pending for manual linking below.
export async function autoAlignTeamsAction(leagueCode: string): Promise<
  | { ok: true; aligned: { local: string; sofa: string }[]; pending: string[] }
  | { ok: false; error: string }
> {
  const { supabase, user } = await authed();
  const { loadLeague } = await import("@/lib/footballData");
  const { slugify } = await import("@/lib/slugify");
  const maps = await loadMaps(supabase, user.id, "tournament");
  const map = maps.find((m) => m.name_key === leagueCode);
  if (!map) return { ok: false, error: "Liga por mapear." };
  const data = await loadLeague(leagueCode, new Date());
  try {
    const seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
    if (seasons.length === 0) return { ok: false, error: "O SofaScore não devolveu épocas." };
    const rows = await seasonStandings(supabase, user.id, map.sofascore_id, seasons[0].id, true);
    const sofaNames = [...new Set(rows.map((r) => r.team).filter(Boolean))];
    if (sofaNames.length === 0) return { ok: false, error: "Sem tabela no SofaScore (taças não têm)." };
    // Leagues without files (European cups, new entries): the SofaScore names
    // ARE the local universe — linking identical spellings still registers
    // every team so the adapter and the model work.
    const localTeams = data && data.teams.length > 0 ? data.teams : sofaNames;
    const aligned: { local: string; sofa: string }[] = [];
    const pending: string[] = [];
    const usedSofa = new Set<string>();
    const save = async (local: string, sofa: string, teamId: number) => {
      const { error } = await supabase.from("sofascore_maps").upsert(
        {
          user_id: user.id,
          kind: "team",
          name_key: slugify(local),
          sofascore_id: teamId,
          name: sofa.slice(0, 120),
          slug: slugify(sofa),
          local_name: local.slice(0, 120),
        },
        { onConflict: "user_id,kind,name_key" }
      );
      return !error;
    };
    for (const a of alignTeamNames(localTeams, sofaNames)) {
      if (a.sofa) {
        if (await save(a.local, a.sofa, 0)) {
          usedSofa.add(a.sofa);
          aligned.push({ local: a.local, sofa: a.sofa });
        } else pending.push(a.local);
      } else {
        pending.push(a.local);
      }
    }
    // Leftovers ("Sporting Clube de Portugal" ↔ "Sporting CP" share too few
    // words, and the exact name hits table tennis): try shorter queries and
    // only accept football teams — famous ones outright, small ones only when
    // the names also fit. Saved with their real team id.
    for (const local of [...pending]) {
      const variants = teamQueryVariants(local);
      let linked = false;
      for (const variant of variants) {
        if (linked) break;
        try {
          const hits = (await searchTeams(variant)).filter(
            (h) => h.sport === "football" && !usedSofa.has(h.name)
          );
          const top = hits[0];
          const fits = top && (top.userCount >= 20000 || (top.userCount >= 2000 && alignScore(local, top.name) >= 1));
          if (fits && (await save(local, top.name, top.id))) {
            usedSofa.add(top.name);
            aligned.push({ local, sofa: top.name });
            pending.splice(pending.indexOf(local), 1);
            linked = true;
          }
        } catch {
          // One failed search must not block the rest.
        }
      }
    }
    revalidatePath("/estatisticas/mapa");
    return { ok: true, aligned, pending };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falhou a leitura." };
  }
}

export async function searchSofaTeamsAction(query: string): Promise<SofaCandidate[]> {
  await authed();
  if (!query.trim()) return [];
  return searchTeams(query);
}
export async function saveSofaTeamAction(  localSlug: string,
  localName: string,
  teamId: number,
  name: string,
  slug: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  if (!localSlug || !Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, error: "Ligação inválida." };
  }
  const { error } = await supabase.from("sofascore_maps").upsert(
    {
      user_id: user.id,
      kind: "team",
      name_key: localSlug,
      sofascore_id: teamId,
      name: name.slice(0, 120),
      slug: slug.slice(0, 120),
      local_name: localName.slice(0, 120),
    },
    { onConflict: "user_id,kind,name_key" }
  );
  if (error) return { ok: false, error: "Não foi possível guardar." };
  revalidatePath("/estatisticas/mapa");
  return { ok: true };
}

export async function deleteSofaTeamAction(localSlug: string): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("sofascore_maps").delete().eq("user_id", user.id).eq("kind", "team").eq("name_key", localSlug);
  revalidatePath("/estatisticas/mapa");
}

// The first bootstrap round linked 8 national sides wrongly (youth teams,
// homonyms, a swapped pair). Deletes exactly those pairs — and only while
// they still point at the wrong side, so manual fixes are never touched.
const WRONG_INTL: [string, string][] = [
  ["int:congo", "DR Congo"],
  ["int:dr-congo", "DR Congo U20"],
  ["int:dominica", "Dominican Republic"],
  ["int:dominican-republic", "Dominican Republic U23"],
  ["int:niger", "Nigeria"],
  ["int:nigeria", "Nigeria U20"],
  ["int:saint-martin", "Sint Maarten"],
  ["int:sint-maarten", "Saint Martin"],
];

export async function repairWrongIntlAction(): Promise<{ fixed: number }> {  const { supabase, user } = await authed();
  const maps = await loadMaps(supabase, user.id, "team");
  let fixed = 0;
  for (const [key, wrongName] of WRONG_INTL) {
    const row = maps.find((m) => m.name_key === key);
    if (row && row.name === wrongName) {
      const { error } = await supabase
        .from("sofascore_maps")
        .delete()
        .eq("user_id", user.id)
        .eq("kind", "team")
        .eq("name_key", key);
      if (!error) fixed++;
    }
  }
  revalidatePath("/estatisticas/mapa");
  return { fixed };
}

// Bootstraps national-team links from the files' active list (one CSV read):
// each files spelling is searched on SofaScore and linked to the most
// followed national football team. Saved under "int:<slug>" with the files
// spelling as local_name, so the adapter needs no file reads afterwards.
export async function bootstrapIntlTeamsAction(): Promise<{
  mapped: { local: string; sofa: string }[];
  pending: string[];
  repaired: number;
}> {
  const { supabase, user } = await authed();
  const { loadInternationalGames } = await import("@/lib/internationalData");
  const { activeTeams } = await import("@/lib/internationalData");
  const { slugify } = await import("@/lib/slugify");
  const all = await loadInternationalGames();
  if (!all || all.length === 0) return { mapped: [], pending: ["(ficheiros indisponíveis)"], repaired: 0 };
  // First bootstrap round linked 8 sides wrongly: drop those exact pairs
  // before relinking (manual fixes never match, so they are never touched).
  let repaired = 0;
  {
    const maps = await loadMaps(supabase, user.id, "team");
    for (const [key, wrongName] of WRONG_INTL) {
      const row = maps.find((m) => m.name_key === key);
      if (row && row.name === wrongName) {
        const { error } = await supabase
          .from("sofascore_maps")
          .delete()
          .eq("user_id", user.id)
          .eq("kind", "team")
          .eq("name_key", key);
        if (!error) repaired++;
      }
    }
  }
  const filesTeams = activeTeams(all, new Date());
  const existing = new Set(
    (await loadMaps(supabase, user.id, "team")).filter((m) => m.name_key.startsWith("int:")).map((m) => m.name_key)
  );
  const mapped: { local: string; sofa: string }[] = [];
  const pending: string[] = [];
  const usedSofa = new Set<string>();
  for (const local of filesTeams) {
    const key = `int:${slugify(local)}`;
    if (existing.has(key)) continue;
    // Several query spellings per side (synonyms, distinctive words): small
    // nations hide deep in the results. The fit check keeps broad words safe.
    let linked = false;
    for (const variant of intlQueryVariants(local)) {
      if (linked) break;
      try {
        const hits = (await searchTeams(variant, 20)).filter(
          (h) => h.national && h.sport === "football" && !usedSofa.has(h.name)
        );
        const top = hits.find((h) => nationalFit(local, h));
        if (top && top.userCount >= 100) {
          const { error } = await supabase.from("sofascore_maps").upsert(
            {
              user_id: user.id,
              kind: "team",
              name_key: key,
              sofascore_id: top.id,
              name: top.name.slice(0, 120),
              slug: top.slug.slice(0, 120),
              local_name: local.slice(0, 120),
            },
            { onConflict: "user_id,kind,name_key" }
          );
          if (!error) {
            usedSofa.add(top.name);
            mapped.push({ local, sofa: top.name });
            linked = true;
          }
        }
      } catch {
        // Next variant.
      }
    }
    if (!linked) pending.push(local);
  }
  revalidatePath("/estatisticas/mapa");
  return { mapped, pending, repaired };
}

// Aligns every mapped league in one go (same rules as the per-league button:
// fuzzy fit first, short-query search fallback for leftovers). Idempotent:
// re-running only fills gaps. Slow on first run (standings + searches),
// then mostly cache.
export async function autoAlignAllTeamsAction(): Promise<{
  leagues: { code: string; label: string; aligned: number; pending: string[]; error?: string }[];
}> {
  const { supabase, user } = await authed();
  const { LEAGUES } = await import("@/lib/footballData");
  const { loadLeague } = await import("@/lib/footballData");
  const { slugify } = await import("@/lib/slugify");
  const maps = await loadMaps(supabase, user.id, "tournament");
  const existingTeams = new Map((await loadMaps(supabase, user.id, "team")).map((m) => [m.name_key, m.name]));
  const leagues: { code: string; label: string; aligned: number; pending: string[]; error?: string }[] = [];
  for (const league of LEAGUES) {
    if (league.code.startsWith("int.")) continue;
    const map = maps.find((m) => m.name_key === league.code);
    if (!map) continue;
    try {
      const data = await loadLeague(league.code, new Date());
      const seasons = await tournamentSeasons(supabase, user.id, map.sofascore_id);
      if (seasons.length === 0) {
        leagues.push({ code: league.code, label: league.label as string, aligned: 0, pending: [], error: "sem épocas no SofaScore" });
        continue;
      }
      const rows = await seasonStandings(supabase, user.id, map.sofascore_id, seasons[0].id, true);
      const sofaNames = [...new Set(rows.map((r) => r.team).filter(Boolean))];
      if (sofaNames.length === 0) {
        leagues.push({ code: league.code, label: league.label as string, aligned: 0, pending: [], error: "sem tabela (taça?)" });
        continue;
      }
      // Leagues without files: the SofaScore names ARE the local universe.
      const localTeams = data && data.teams.length > 0 ? data.teams : sofaNames;
      let aligned = 0;
      const savedSlugs = new Set<string>();
      const usedSofa = new Set<string>();
      for (const known of existingTeams.values()) usedSofa.add(known);
      const save = async (local: string, sofa: string, teamId: number): Promise<boolean> => {
        const { error } = await supabase.from("sofascore_maps").upsert(
          {
            user_id: user.id,
            kind: "team",
            name_key: slugify(local),
            sofascore_id: teamId,
            name: sofa.slice(0, 120),
            slug: slugify(sofa),
            local_name: local.slice(0, 120),
          },
          { onConflict: "user_id,kind,name_key" }
        );
        if (!error) savedSlugs.add(slugify(local));
        return !error;
      };
      const stillPending: string[] = [];
      for (const a of alignTeamNames(localTeams, sofaNames)) {
        // Always re-save confident fits (upsert): besides linking, this
        // backfills local_name on rows created before migration 0034.
        if (a.sofa) {
          if (await save(a.local, a.sofa, 0)) {
            usedSofa.add(a.sofa);
          } else if (!existingTeams.has(slugify(a.local))) {
            stillPending.push(a.local);
            continue;
          }
          aligned++;
          savedSlugs.add(slugify(a.local));
        } else if (!existingTeams.has(slugify(a.local))) {
          stillPending.push(a.local);
        }
      }
      for (const local of stillPending) {
        for (const variant of teamQueryVariants(local)) {
          if (savedSlugs.has(slugify(local))) break;
          try {
            const hits = (await searchTeams(variant)).filter((h) => h.sport === "football" && !usedSofa.has(h.name));
            const top = hits[0];
            const fits = top && (top.userCount >= 20000 || (top.userCount >= 2000 && alignScore(local, top.name) >= 1));
            if (fits && (await save(local, top.name, top.id))) {
              usedSofa.add(top.name);
              aligned++;
              break;
            }
          } catch {
            // Next variant / next club.
          }
        }
      }
      leagues.push({
        code: league.code,
        label: league.label as string,
        aligned,
        pending: localTeams.filter((t) => !savedSlugs.has(slugify(t))),
      });
    } catch (err) {
      leagues.push({
        code: league.code,
        label: league.label as string,
        aligned: 0,
        pending: [],
        error: err instanceof Error ? err.message : "falhou",
      });
    }
  }
  revalidatePath("/estatisticas/mapa");
  return { leagues };
}

// Audits national-team links: reads each linked side's latest games (cached)
// and flags the ones that look like clubs (club competitions) or youth/women
// sides (age markers in most opponents). Read-only: nothing is deleted.
export async function auditIntlMapsAction(): Promise<{
  rows: { local: string; sofa: string; id: number; tournaments: string[]; youthShare: number; flag: string | null }[];
}> {
  const { supabase, user } = await authed();
  const { teamEvents } = await import("@/lib/sofaHistory");
  const { sideTokensIn } = await import("@/lib/sportscoreSlug");
  const { slugify } = await import("@/lib/slugify");
  const maps = (await loadMaps(supabase, user.id, "team")).filter((m) => m.name_key.startsWith("int:"));
  const CLUB_COMPS = [
    "premier league", "la liga", "bundesliga", "serie a", "ligue 1", "primeira liga",
    "eredivisie", "championship", "league one", "league two", "liga mx", "mls",
    "serie b", "ligue 2", "segunda", "2. bundesliga", "champions league", "europa league",
    "conference league", "copa libertadores", "fa cup", "coppa italia", "copa del rey",
  ];
  // "Championship" alone is England's second tier — but national-team
  // championships (African Nations, ASEAN, SAFF, EAFF...) are not clubs.
  const NATIONAL_CHAMPS = /nations championship|asean|eaff|saff|cecafa|cosafa/i;
  const rows: { local: string; sofa: string; id: number; tournaments: string[]; youthShare: number; flag: string | null }[] = [];
  for (const m of maps) {
    if (!Number.isInteger(m.sofascore_id) || m.sofascore_id <= 0) {
      rows.push({ local: m.local_name || m.name_key, sofa: m.name, id: m.sofascore_id, tournaments: [], youthShare: 0, flag: "sem id" });
      continue;
    }
    try {
      const { events } = await teamEvents(m.sofascore_id, "last", 0);
      const tournaments = [...new Set(events.map((e) => String((e.tournament as Record<string, unknown> | null)?.name ?? "")))].filter(Boolean).slice(0, 4);
      const opponents: string[] = [];
      for (const e of events) {
        const t = e as Record<string, unknown>;
        const home = (t.homeTeam as Record<string, unknown> | null)?.name;
        const away = (t.awayTeam as Record<string, unknown> | null)?.name;
        if (typeof home === "string") opponents.push(home);
        if (typeof away === "string") opponents.push(away);
      }
      const marked = opponents.filter((o) => sideTokensIn(slugify(o)).length > 0).length;
      const youthShare = opponents.length > 0 ? marked / opponents.length : 0;
      const clubComp = tournaments.find(
        (t) => !NATIONAL_CHAMPS.test(t) && CLUB_COMPS.some((c) => t.toLowerCase().includes(c))
      );
      rows.push({
        local: m.local_name || m.name_key,
        sofa: m.name,
        id: m.sofascore_id,
        tournaments,
        youthShare: Math.round(youthShare * 100) / 100,
        flag: clubComp ? `clube? (${clubComp})` : youthShare >= 0.5 && opponents.length >= 10 ? "youth?" : null,
      });
    } catch {
      rows.push({ local: m.local_name || m.name_key, sofa: m.name, id: m.sofascore_id, tournaments: [], youthShare: 0, flag: "leitura falhou" });
    }
  }
  return { rows: rows.filter((r) => r.flag !== null) };
}
