"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BetStatus, BetType } from "@/lib/database.types";

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

export async function createTicket(input: {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  matchTime: string;
  selection: string;
  reason: string;
  odd: number | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  if (input.homeTeamId === input.awayTeamId) {
    throw new Error("A equipa da casa e a equipa de fora têm de ser diferentes.");
  }

  if (!input.selection.trim()) {
    throw new Error("Indica a aposta.");
  }

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

  const { error: pickError } = await supabase.from("picks").insert({
    ticket_id: ticket.id,
    selection: input.selection.trim(),
    reason: input.reason.trim() || null,
    odd: input.odd,
  });

  if (pickError) throw pickError;

  revalidatePath("/");
  redirect("/");
}

export async function updateTicket(input: {
  ticketId: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  matchTime: string;
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

  revalidatePath("/");
  redirect("/");
}

interface PickInput {
  selection: string;
  reason: string;
  betType: BetType;
  odd: number | null;
  oddMin: number | null;
}

function buildPickFields(input: PickInput) {
  if (!input.selection.trim()) {
    throw new Error("Indica a aposta.");
  }

  if (input.betType === "live") {
    if (input.oddMin === null) {
      throw new Error("Indica a odd mínima de entrada da aposta live.");
    }
    if (input.oddMin <= 1) {
      throw new Error("A odd tem de ser maior que 1.");
    }
  } else if (input.odd !== null && input.odd <= 1) {
    throw new Error("A odd tem de ser maior que 1.");
  }

  return {
    selection: input.selection.trim(),
    reason: input.reason.trim() || null,
    bet_type: input.betType,
    odd: input.betType === "pre_jogo" ? input.odd : null,
    odd_min: input.betType === "live" ? input.oddMin : null,
  };
}

export async function updatePick(input: { pickId: string } & PickInput) {
  const fields = buildPickFields(input);

  const supabase = await createClient();
  const { error } = await supabase.from("picks").update(fields).eq("id", input.pickId);

  if (error) throw error;
  revalidatePath("/");
}

export async function addPick(input: { ticketId: string } & PickInput) {
  const fields = buildPickFields(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from("picks")
    .insert({ ticket_id: input.ticketId, ...fields });

  if (error) throw error;
  revalidatePath("/");
}

export async function updatePickStatus(pickId: string, status: BetStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from("picks").update({ status }).eq("id", pickId);
  if (error) throw error;
  revalidatePath("/");
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

  revalidatePath("/");
}

export async function addPickImage(pickId: string, imagePath: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("pick_images")
    .insert({ pick_id: pickId, image_path: imagePath });
  if (error) throw error;
  revalidatePath("/");
}

export async function deletePickImage(imageId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("pick_images").delete().eq("id", imageId);
  if (error) throw error;
  revalidatePath("/");
}

export async function deleteTicket(ticketId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").delete().eq("id", ticketId);
  if (error) throw error;
  revalidatePath("/");
}
