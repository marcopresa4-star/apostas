"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";

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

  const pickFields = buildPickFields(input);

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

export async function addWatchedMatch(homeTeam: string, awayTeam: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const home = homeTeam.trim();
  const away = awayTeam.trim();
  if (!home || !away) throw new Error("Indica as duas equipas.");

  const { error } = await supabase
    .from("watched_matches")
    .insert({ user_id: user.id, home_team: home, away_team: away });

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
  alertMinute: number | null;
  sofascoreUrl: string;
  bookmakerUrl: string;
  categoryId: string | null;
}

function buildPickFields(input: PickInput) {
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
  const fields = buildPickFields(input);

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
export async function enterLivePick(pickId: string, entryOdd: number): Promise<StageResult> {
  if (!Number.isFinite(entryOdd) || entryOdd <= 1) {
    return { ok: false, error: "A odd tem de ser maior que 1." };
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
export async function getCommunityUnseen(): Promise<{ count: number; entered: number }> {
  const none = { count: 0, entered: 0 };
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

  const [all, entered] = await Promise.all([
    unseen(),
    unseen().eq("bet_type", "live").eq("stage", "active"),
  ]);
  if (all.error || entered.error) return none;
  return { count: all.count ?? 0, entered: entered.count ?? 0 };
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
