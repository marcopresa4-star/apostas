"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { searchEntityRows } from "@/lib/entityOptions";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";
import { multipleStatus } from "@/lib/multiples";
import { assignSlugs, parseSportscoreMatch } from "@/lib/sportscoreLink";
import { slugify } from "@/lib/slugify";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/apostas");
  revalidatePath("/live");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createCountryLinkedEntity(
  table: "teams" | "competitions",
  name: string,
  countryId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nome obrigatório.");

  const { data, error } = await supabase
    .from(table)
    .insert({ name: trimmed, country_id: countryId })
    .select("id, name, country_id")
    .single();

  if (error) {
    // Unique violation -> entity already exists for that country, fetch it instead.
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await supabase
        .from(table)
        .select("id, name, country_id")
        .eq("name", trimmed)
        .eq("country_id", countryId)
        .single();
      if (fetchError) throw fetchError;
      return existing;
    }
    throw error;
  }

  return data;
}

// Powers the team / competition search boxes: the base has thousands of each,
// so the browser asks for matches as you type instead of loading them all.
export async function searchEntities(table: "teams" | "competitions", query: string) {
  if (table !== "teams" && table !== "competitions") return [];
  const supabase = await createClient();
  return searchEntityRows(supabase, table, query);
}

export async function createTeam(name: string, countryId: string) {
  return createCountryLinkedEntity("teams", name, countryId);
}

export async function createCompetition(name: string, countryId: string) {
  return createCountryLinkedEntity("competitions", name, countryId);
}

export async function createBetCategory(name: string) {
  const supabase = await createClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nome obrigatório.");

  const { data, error } = await supabase
    .from("bet_categories")
    .insert({ name: trimmed })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await supabase
        .from("bet_categories")
        .select("id, name")
        .eq("name", trimmed)
        .single();
      if (fetchError) throw fetchError;
      return existing;
    }
    throw error;
  }

  return data;
}

type DeleteResult = { ok: true } | { ok: false; error: string };

interface BlockingTicketRow {
  match_date: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

async function describeBlockingTickets(
  table: "teams" | "competitions",
  id: string
): Promise<string> {
  const supabase = await createClient();
  let query = supabase
    .from("tickets")
    .select(
      `match_date,
       home_team:teams!tickets_home_team_id_fkey(name),
       away_team:teams!tickets_away_team_id_fkey(name)`
    );

  query =
    table === "teams"
      ? query.or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      : query.eq("competition_id", id);

  const { data } = await query.limit(5).returns<BlockingTicketRow[]>();

  if (!data || data.length === 0) return "";

  return data
    .map((t) => {
      const date = new Date(`${t.match_date}T00:00:00`).toLocaleDateString("pt-PT");
      return `${t.home_team?.name ?? "?"} vs ${t.away_team?.name ?? "?"} (${date})`;
    })
    .join(", ");
}

async function deleteCountryLinkedEntity(
  table: "teams" | "competitions",
  id: string
): Promise<DeleteResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");

  if (error) {
    // Foreign key violation -> still referenced by an existing bet.
    if (error.code === "23503") {
      const blocking = await describeBlockingTickets(table, id);
      const what = table === "teams" ? "esta equipa" : "esta competição";
      return {
        ok: false,
        error: blocking
          ? `Não é possível remover: ${what} está associada ao(s) jogo(s): ${blocking}.`
          : `Não é possível remover: ${what} está associada a uma ou mais apostas.`,
      };
    }
    return { ok: false, error: "Não foi possível remover. Tenta novamente." };
  }

  // RLS can silently block a delete (0 rows affected, no error) instead of
  // raising one, so verify a row actually came back before reporting success.
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível remover (sem permissão)." };
  }

  revalidatePath("/apostas/nova");
  return { ok: true };
}

export async function deleteTeam(id: string): Promise<DeleteResult> {
  return deleteCountryLinkedEntity("teams", id);
}

export async function deleteCompetition(id: string): Promise<DeleteResult> {
  return deleteCountryLinkedEntity("competitions", id);
}

export async function createTicket(
  input: {
    competitionId: string;
    homeTeamId: string;
    awayTeamId: string;
    matchDate: string;
    matchTime: string;
  } & PickInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  if (input.homeTeamId === input.awayTeamId) {
    throw new Error("A equipa da casa e a equipa de fora têm de ser diferentes.");
  }

  const pickFields = buildPickFields(input, { requireEntryMinute: true });

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      user_id: user.id,
      competition_id: input.competitionId,
      home_team_id: input.homeTeamId,
      away_team_id: input.awayTeamId,
      match_date: input.matchDate,
      match_time: input.matchTime,
    })
    .select("id")
    .single();

  if (ticketError) throw ticketError;

  const { error: pickError } = await supabase
    .from("picks")
    .insert({ ticket_id: ticket.id, ...pickFields });

  if (pickError) throw pickError;

  revalidateAll();
  redirect(input.betType === "live" ? "/live" : "/apostas");
}

export async function updateTicket(input: {
  ticketId: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  matchTime: string;
  returnTo?: string;
}) {
  const supabase = await createClient();

  if (input.homeTeamId === input.awayTeamId) {
    throw new Error("A equipa da casa e a equipa de fora têm de ser diferentes.");
  }

  const { error } = await supabase
    .from("tickets")
    .update({
      competition_id: input.competitionId,
      home_team_id: input.homeTeamId,
      away_team_id: input.awayTeamId,
      match_date: input.matchDate,
      match_time: input.matchTime,
    })
    .eq("id", input.ticketId);

  if (error) throw error;

  revalidateAll();
  redirect(input.returnTo === "/live" ? "/live" : "/apostas");
}

export async function markTicketLiveEnded(ticketId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tickets")
    .update({ live_ended: true })
    .eq("id", ticketId);

  if (error) throw error;
  revalidateAll();
}

export async function addWatchedMatch(
  homeTeam: string,
  awayTeam: string,
  homeAliases: string | null = null,
  awayAliases: string | null = null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const home = homeTeam.trim();
  const away = awayTeam.trim();
  if (!home || !away) throw new Error("Indica as duas equipas.");

  const { error } = await supabase.from("watched_matches").insert({
    user_id: user.id,
    home_team: home,
    away_team: away,
    home_aliases: homeAliases?.trim() || null,
    away_aliases: awayAliases?.trim() || null,
  });

  if (error) throw error;
  revalidateAll();
}

export async function removeWatchedMatch(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("watched_matches").delete().eq("id", id);
  if (error) throw error;
  revalidateAll();
}

interface PickInput {
  selection: string;
  reason: string;
  betType: BetType;
  // Live picks only: "watching" (an idea, needs the minimum odd), "active"
  // (already entered, needs the entry odd) or "skipped". Ignored for
  // pre-game picks, which are always "active".
  stage: PickStage;
  odd: number | null;
  oddMin: number | null;
  entryOdd: number | null;
  // Active live picks: the game minute at which you entered.
  entryMinute?: number | null;
  alertMinute: number | null;
  sofascoreUrl: string;
  bookmakerUrl: string;
  categoryId: string | null;
}

function validateEntryMinute(minute: number | null | undefined) {
  if (minute == null) return;
  if (!Number.isInteger(minute) || minute < 0 || minute > 150) {
    throw new Error("O minuto tem de ser um número entre 0 e 150.");
  }
}

// New live entries must say the minute; editing an older pick may leave it
// empty (it was entered before the minute existed).
function buildPickFields(input: PickInput, options: { requireEntryMinute?: boolean } = {}) {
  if (!input.selection.trim()) {
    throw new Error("Indica a aposta.");
  }

  const stage: PickStage = input.betType === "live" ? input.stage : "active";

  if (input.betType === "live") {
    if (stage === "active") {
      if (input.entryOdd === null) {
        throw new Error("Indica a odd em que entraste.");
      }
      if (input.entryOdd <= 1) {
        throw new Error("A odd tem de ser maior que 1.");
      }
      if (options.requireEntryMinute && input.entryMinute == null) {
        throw new Error("Indica o minuto do jogo em que entraste.");
      }
      validateEntryMinute(input.entryMinute);
    } else if (input.oddMin === null) {
      throw new Error("Indica a odd mínima de entrada da aposta live.");
    }
    if (input.oddMin !== null && input.oddMin <= 1) {
      throw new Error("A odd tem de ser maior que 1.");
    }
    if (input.alertMinute !== null && input.alertMinute <= 0) {
      throw new Error("O minuto de alerta tem de ser maior que 0.");
    }
  } else if (input.odd !== null && input.odd <= 1) {
    throw new Error("A odd tem de ser maior que 1.");
  }

  return {
    selection: input.selection.trim(),
    reason: input.reason.trim() || null,
    bet_type: input.betType,
    stage,
    odd: input.betType === "pre_jogo" ? input.odd : null,
    odd_min: input.betType === "live" ? input.oddMin : null,
    entry_odd: input.betType === "live" && stage === "active" ? input.entryOdd : null,
    entry_minute:
      input.betType === "live" && stage === "active" ? (input.entryMinute ?? null) : null,
    alert_minute: input.betType === "live" ? input.alertMinute : null,
    sofascore_url: input.sofascoreUrl.trim() || null,
    bookmaker_url: input.bookmakerUrl.trim() || null,
    category_id: input.categoryId,
  };
}

export async function updatePick(input: { pickId: string } & PickInput) {
  const fields = buildPickFields(input);

  const supabase = await createClient();
  const { error } = await supabase.from("picks").update(fields).eq("id", input.pickId);

  if (error) throw error;
  revalidateAll();
}

export async function addPick(input: { ticketId: string } & PickInput) {
  const fields = buildPickFields(input, { requireEntryMinute: true });

  const supabase = await createClient();
  const { error } = await supabase
    .from("picks")
    .insert({ ticket_id: input.ticketId, ...fields });

  if (error) throw error;
  revalidateAll();
}

export async function updatePickStatus(pickId: string, status: BetStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("picks").update({ status }).eq("id", pickId);
  if (error) throw error;
  revalidateAll();
}

export async function setPickPublished(
  pickId: string,
  published: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  if (published) {
    const { data: pick, error: fetchError } = await supabase
      .from("picks")
      .select("status, stage")
      .eq("id", pickId)
      .single();
    if (fetchError) return { ok: false, error: "Não foi possível verificar a aposta." };
    if (pick.status !== "pending") {
      return { ok: false, error: "Só podes publicar apostas pendentes." };
    }
    if (pick.stage === "skipped") {
      return { ok: false, error: "Não podes publicar uma vigilância em que não entraste." };
    }
  }

  const { error } = await supabase
    .from("picks")
    .update({
      is_published: published,
      published_at: published ? new Date().toISOString() : null,
    })
    .eq("id", pickId);
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  revalidatePath("/comunidade");
  revalidateAll();
  return { ok: true };
}

type StageResult = { ok: true } | { ok: false; error: string };

async function fetchLivePick(pickId: string) {
  const supabase = await createClient();
  const { data: pick, error } = await supabase
    .from("picks")
    .select("bet_type, stage, is_published")
    .eq("id", pickId)
    .single();
  return { supabase, pick: error ? null : pick };
}

// watching -> active: you entered, at this real odd. If the pick is already
// published, published_at is bumped so followers get notified again - this
// is the moment they can actually act on it.
export async function enterLivePick(
  pickId: string,
  entryOdd: number,
  entryMinute: number | null = null
): Promise<StageResult> {
  if (!Number.isFinite(entryOdd) || entryOdd <= 1) {
    return { ok: false, error: "A odd tem de ser maior que 1." };
  }
  if (entryMinute !== null && (!Number.isInteger(entryMinute) || entryMinute < 0 || entryMinute > 150)) {
    return { ok: false, error: "O minuto tem de ser um número entre 0 e 150." };
  }

  const { supabase, pick } = await fetchLivePick(pickId);
  if (!pick) return { ok: false, error: "Não foi possível verificar a aposta." };
  if (pick.bet_type !== "live" || pick.stage !== "watching") {
    return { ok: false, error: "Só podes entrar numa aposta que estás a vigiar." };
  }

  const { error } = await supabase
    .from("picks")
    .update({
      stage: "active",
      entry_odd: entryOdd,
      entry_minute: entryMinute,
      ...(pick.is_published ? { published_at: new Date().toISOString() } : {}),
    })
    .eq("id", pickId);
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  revalidatePath("/comunidade");
  revalidateAll();
  return { ok: true };
}

// watching -> skipped: you never entered. A skipped pick is pulled out of
// the Comunidade automatically, so followers never see it as still worth
// entering.
export async function skipLivePick(pickId: string): Promise<StageResult> {
  const { supabase, pick } = await fetchLivePick(pickId);
  if (!pick) return { ok: false, error: "Não foi possível verificar a aposta." };
  if (pick.bet_type !== "live" || pick.stage !== "watching") {
    return { ok: false, error: "Só podes marcar como não entrei uma aposta que estás a vigiar." };
  }

  const { error } = await supabase
    .from("picks")
    .update({ stage: "skipped", is_published: false, published_at: null })
    .eq("id", pickId);
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  revalidatePath("/comunidade");
  revalidateAll();
  return { ok: true };
}

// skipped -> watching: undo a mistaken "Não entrei".
export async function resumeWatchingPick(pickId: string): Promise<StageResult> {
  const { supabase, pick } = await fetchLivePick(pickId);
  if (!pick) return { ok: false, error: "Não foi possível verificar a aposta." };
  if (pick.bet_type !== "live" || pick.stage !== "skipped") {
    return { ok: false, error: "Esta aposta não está marcada como não entrei." };
  }

  const { error } = await supabase.from("picks").update({ stage: "watching" }).eq("id", pickId);
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  revalidateAll();
  return { ok: true };
}

// How many picks were published (or, for a published watch, entered) since
// this user last opened the Comunidade, and how many of those are live
// entries - so the toast can say "Entrei" instead of a generic "new bet".
// A user's first ever call just plants their marker (so they start at zero)
// instead of flooding them with the whole back catalogue. Never throws: if
// the table is missing (migration not run yet) it just reports zeros.
//
// It also returns a "signature" of everything currently published (how many
// picks and the latest change). Unpublishing or resolving a pick changes it
// without adding anything new, which is how an open Comunidade page knows it
// must refresh. Empty means "unknown", never "changed".
export async function getCommunityUnseen(): Promise<{
  count: number;
  entered: number;
  signature: string;
}> {
  const none = { count: 0, entered: 0, signature: "" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return none;

  const { data: read, error: readError } = await supabase
    .from("community_reads")
    .select("last_seen_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return none;

  if (!read) {
    await supabase
      .from("community_reads")
      .insert({ user_id: user.id, last_seen_at: new Date().toISOString() });
    return none;
  }

  const unseen = () =>
    supabase
      .from("picks")
      .select("id", { count: "exact", head: true })
      .eq("is_published", true)
      .gt("published_at", read.last_seen_at);

  const latest = supabase
    .from("picks")
    .select("updated_at", { count: "exact" })
    .eq("is_published", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  // Published multiples: a live one is always an entry. Their games change
  // (results) without the multiple itself changing, so the signature follows
  // the latest update among the games of published multiples.
  const unseenMultiples = () =>
    supabase
      .from("multiples")
      .select("id", { count: "exact", head: true })
      .eq("is_published", true)
      .gt("published_at", read.last_seen_at);

  const latestMultipleLeg = supabase
    .from("multiple_legs")
    .select("updated_at, multiple:multiples!inner(is_published)", { count: "exact" })
    .eq("multiple.is_published", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  const [all, entered, newest, multiples, liveMultiples, newestLeg] = await Promise.all([
    unseen(),
    unseen().eq("bet_type", "live").eq("stage", "active"),
    latest,
    unseenMultiples(),
    unseenMultiples().eq("bet_type", "live"),
    latestMultipleLeg,
  ]);
  if (all.error || entered.error) return none;

  // If the multiples tables are missing (migrations not run yet) they simply
  // count as nothing.
  const multiplesCount = multiples.error ? 0 : (multiples.count ?? 0);
  const liveMultiplesCount = liveMultiples.error ? 0 : (liveMultiples.count ?? 0);
  const multiplesSignature = newestLeg.error
    ? ""
    : `${newestLeg.count ?? 0}:${newestLeg.data?.[0]?.updated_at ?? ""}`;
  const signature = newest.error
    ? ""
    : `${newest.count ?? 0}:${newest.data?.[0]?.updated_at ?? ""}|${multiplesSignature}`;
  return {
    count: (all.count ?? 0) + multiplesCount,
    entered: (entered.count ?? 0) + liveMultiplesCount,
    signature,
  };
}

export async function markCommunitySeen(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("community_reads")
    .upsert(
      { user_id: user.id, last_seen_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

export async function deletePick(pickId: string) {
  const supabase = await createClient();

  const { data: pick } = await supabase
    .from("picks")
    .select("ticket_id")
    .eq("id", pickId)
    .single();

  const { error } = await supabase.from("picks").delete().eq("id", pickId);
  if (error) throw error;

  // A ticket with no picks left is orphaned (invisible in the dashboard,
  // but still holding onto its team/competition rows) — remove it too.
  if (pick?.ticket_id) {
    const { count } = await supabase
      .from("picks")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", pick.ticket_id);
    if (count === 0) {
      await supabase.from("tickets").delete().eq("id", pick.ticket_id);
    }
  }

  revalidateAll();
}

export async function addPickImage(pickId: string, imagePath: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("pick_images")
    .insert({ pick_id: pickId, image_path: imagePath });
  if (error) throw error;
  revalidateAll();
}

export async function deletePickImage(imageId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("pick_images").delete().eq("id", imageId);
  if (error) throw error;
  revalidateAll();
}

export async function deleteTicket(ticketId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").delete().eq("id", ticketId);
  if (error) throw error;
  revalidateAll();
}

export interface MultipleLegInput {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  matchTime: string;
  selection: string;
  categoryId: string | null;
  odd: number;
  // Live multiples: the game minute at which you entered this game.
  entryMinute: number | null;
}

// A multiple is one bet over two or more games. Live multiples are only ever
// registered once entered, so every live leg needs its minute.
export async function createMultiple(input: {
  betType: BetType;
  reason: string;
  bookmakerUrl: string;
  legs: MultipleLegInput[];
}) {
  if (input.legs.length < 2) throw new Error("Uma múltipla precisa de pelo menos 2 jogos.");

  input.legs.forEach((leg, i) => {
    const where = `Jogo ${i + 1}`;
    if (leg.homeTeamId === leg.awayTeamId) {
      throw new Error(`${where}: a equipa da casa e a de fora têm de ser diferentes.`);
    }
    if (!leg.selection.trim()) throw new Error(`${where}: indica a aposta.`);
    if (!Number.isFinite(leg.odd) || leg.odd <= 1) {
      throw new Error(`${where}: a odd tem de ser maior que 1.`);
    }
    if (input.betType === "live") {
      validateEntryMinute(leg.entryMinute);
      if (leg.entryMinute == null) throw new Error(`${where}: indica o minuto em que entraste.`);
    }
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const { data: multiple, error: multipleError } = await supabase
    .from("multiples")
    .insert({
      user_id: user.id,
      bet_type: input.betType,
      reason: input.reason.trim() || null,
      bookmaker_url: input.bookmakerUrl.trim() || null,
    })
    .select("id")
    .single();
  if (multipleError) throw multipleError;

  const { error: legsError } = await supabase.from("multiple_legs").insert(
    input.legs.map((leg) => ({
      multiple_id: multiple.id,
      competition_id: leg.competitionId,
      home_team_id: leg.homeTeamId,
      away_team_id: leg.awayTeamId,
      match_date: leg.matchDate,
      match_time: leg.matchTime,
      selection: leg.selection.trim(),
      category_id: leg.categoryId,
      odd: leg.odd,
      entry_minute: input.betType === "live" ? leg.entryMinute : null,
    }))
  );
  if (legsError) {
    // Don't leave a multiple with no games behind.
    await supabase.from("multiples").delete().eq("id", multiple.id);
    throw legsError;
  }

  revalidateAll();
  revalidatePath("/analise");
  redirect(input.betType === "live" ? "/live" : "/apostas");
}

export async function updateLegStatus(legId: string, status: BetStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("multiple_legs").update({ status }).eq("id", legId);
  if (error) throw error;
  revalidateAll();
  revalidatePath("/analise");
}

export async function deleteMultiple(multipleId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("multiples").delete().eq("id", multipleId);
  if (error) throw error;
  revalidateAll();
  revalidatePath("/analise");
}

// Like setPickPublished: only a pending multiple can be published (worked out
// from its games), and retiring it is always allowed. Once every game is over
// it leaves the Comunidade feed on its own but keeps counting in its Análise.
export async function setMultiplePublished(
  multipleId: string,
  published: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  if (published) {
    const { data: legs, error: fetchError } = await supabase
      .from("multiple_legs")
      .select("status")
      .eq("multiple_id", multipleId)
      .returns<{ status: BetStatus }[]>();
    if (fetchError) return { ok: false, error: "Não foi possível verificar a múltipla." };
    if (multipleStatus(legs ?? []) !== "pending") {
      return { ok: false, error: "Só podes publicar múltiplas pendentes." };
    }
  }

  const { error } = await supabase
    .from("multiples")
    .update({
      is_published: published,
      published_at: published ? new Date().toISOString() : null,
    })
    .eq("id", multipleId);
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  revalidatePath("/comunidade");
  revalidateAll();
  return { ok: true };
}

// Teaches the live widget what Sportscore calls two clubs, from the address of
// one of its match pages (or its slug). Saved by the clubs' names, so every
// later game of those clubs finds its widget, bets and hand-added games alike.
// `homeNames` / `awayNames` are a club's name followed by its other names; the
// first one is what the lesson is saved under.
export async function saveSportscoreLink(
  homeNames: string[],
  awayNames: string[],
  link: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseSportscoreMatch(link);
  if (!parsed) {
    return {
      ok: false,
      error: 'Não reconheci o link. Cola o endereço da página do jogo no Sportscore (tem "-vs-" no nome).',
    };
  }

  const home = homeNames.map((n) => n.trim()).filter(Boolean).slice(0, 6);
  const away = awayNames.map((n) => n.trim()).filter(Boolean).slice(0, 6);
  if (home.length === 0 || away.length === 0) {
    return { ok: false, error: "Faltam os nomes das equipas." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado." };

  const slugs = assignSlugs(home, away, parsed.slugs);
  const { error } = await supabase.from("sportscore_teams").upsert(
    [
      { user_id: user.id, name_key: slugify(home[0]), slug: slugs.home },
      { user_id: user.id, name_key: slugify(away[0]), slug: slugs.away },
    ],
    { onConflict: "user_id,name_key" }
  );
  if (error) return { ok: false, error: "Não foi possível guardar. Tenta novamente." };

  return { ok: true };
}
