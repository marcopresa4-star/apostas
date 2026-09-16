"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BetStatus } from "@/lib/database.types";

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

export async function createTicket(input: {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  matchTime: string;
  selection: string;
  reason: string;
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

export async function updatePick(input: { pickId: string; selection: string; reason: string }) {
  if (!input.selection.trim()) {
    throw new Error("Indica a aposta.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("picks")
    .update({
      selection: input.selection.trim(),
      reason: input.reason.trim() || null,
    })
    .eq("id", input.pickId);

  if (error) throw error;
  revalidatePath("/");
}

export async function addPick(input: {
  ticketId: string;
  selection: string;
  reason: string;
}) {
  if (!input.selection.trim()) {
    throw new Error("Indica a aposta.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("picks").insert({
    ticket_id: input.ticketId,
    selection: input.selection.trim(),
    reason: input.reason.trim() || null,
  });

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
  const { error } = await supabase.from("picks").delete().eq("id", pickId);
  if (error) throw error;
  revalidatePath("/");
}

export async function deleteTicket(ticketId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").delete().eq("id", ticketId);
  if (error) throw error;
  revalidatePath("/");
}
