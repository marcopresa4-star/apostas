"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { searchEntityRows } from "@/lib/entityOptions";
import { parseSofascoreId } from "@/lib/sofascore";

function revalidateAll() {
  revalidatePath("/");
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

export async function addWatchedMatch(
  homeTeam: string,
  awayTeam: string,
  homeAliases: string | null = null,
  awayAliases: string | null = null,
  sofascoreUrl: string | null = null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const home = homeTeam.trim();
  const away = awayTeam.trim();
  if (!home || !away) throw new Error("Indica as duas equipas.");

  // No duplicates: pinning, re-adding and the + Dashboard button all land
  // here. Same SofaScore event (by id, whatever the link shape) is refused.
  const newId = sofascoreUrl ? parseSofascoreId(sofascoreUrl) : null;
  if (newId !== null) {
    const { data: existing } = await supabase
      .from("watched_matches")
      .select("sofascore_url")
      .eq("user_id", user.id);
    if ((existing ?? []).some((w) => parseSofascoreId(String(w.sofascore_url ?? "")) === newId)) {
      revalidateAll();
      return;
    }
  }

  const { error } = await supabase.from("watched_matches").insert({
    user_id: user.id,
    home_team: home,
    away_team: away,
    home_aliases: homeAliases?.trim() || null,
    away_aliases: awayAliases?.trim() || null,
    sofascore_url: sofascoreUrl?.trim() || null,
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

export type BetKindInput = "pre" | "watch" | "live";

const BET_STATUSES = new Set(["open", "won", "lost", "void"]);

function cleanText(text: unknown, max = 80): string {
  return typeof text === "string" ? text.trim().slice(0, max) : "";
}

function cleanOdd(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) && n > 1 && n < 1000 ? Math.round(n * 100) / 100 : null;
}

export async function addBet(input: {
  kind: BetKindInput;
  home: unknown;
  away: unknown;
  league?: unknown;
  marketKey: unknown;
  marketLabel: unknown;
  odd?: unknown;
  sofascoreId?: unknown;
  kickoff?: unknown;
  targetOdd?: unknown;
  targetMinute?: unknown;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  if (input.kind !== "pre" && input.kind !== "watch" && input.kind !== "live") {
    throw new Error("Tipo de aposta inválido.");
  }
  const home = cleanText(input.home);
  const away = cleanText(input.away);
  if (!home || !away) throw new Error("Indica as duas equipas.");
  const marketKey = cleanText(input.marketKey, 24);
  const marketLabel = cleanText(input.marketLabel);
  if (!marketKey || !marketLabel) throw new Error("Escolhe o mercado.");
  const odd = cleanOdd(input.odd);
  if (odd === null) throw new Error("Odd inválida (tem de ser maior que 1).");
  const sofaId = Number(input.sofascoreId);
  const kickoff = cleanText(input.kickoff);
  const kickoffAt = kickoff && !Number.isNaN(new Date(kickoff).getTime()) ? new Date(kickoff).toISOString() : null;
  const targetMinute = Number(input.targetMinute);

  const sofaIdClean = Number.isInteger(sofaId) && sofaId > 0 ? sofaId : null;
  const { error } = await supabase.from("bets").insert({
    user_id: user.id,
    kind: input.kind,
    status: "open",
    home_team: home,
    away_team: away,
    league_label: cleanText(input.league) || null,
    market_key: marketKey,
    market_label: marketLabel,
    odd,
    sofascore_id: sofaIdClean,
    kickoff: kickoffAt,
    target_odd: cleanOdd(input.targetOdd),
    target_minute: Number.isInteger(targetMinute) && targetMinute >= 0 && targetMinute <= 130 ? targetMinute : null,
  });
  if (error) throw error;
  // Live bets watch their game: same link straight into the Jogos board
  // (duplicates refused there).
  if (input.kind === "live" && sofaIdClean) {
    await addWatchedMatch(home, away, null, null, `id:${sofaIdClean}`).catch(() => {});
  }
  revalidatePath("/apostas");
}

export async function setBetStatus(id: string, status: "open" | "won" | "lost" | "void") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  if (!BET_STATUSES.has(status)) throw new Error("Estado inválido.");
  const { error } = await supabase
    .from("bets")
    .update({ status, settled_at: status === "open" ? null : new Date().toISOString(), settled_auto: false })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/apostas");
}

// A watched game the user entered: it becomes a live bet at the odd they
// got (asked on entry, since the reference odd is not the entry price).
export async function enterWatchedBet(id: string, entryOdd?: unknown) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  const odd = cleanOdd(entryOdd);
  if (odd === null) throw new Error("Indica a odd a que entraste (maior que 1).");
  const { error } = await supabase
    .from("bets")
    .update({ kind: "live", odd })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "watch")
    .eq("status", "open");
  if (error) throw error;
  revalidatePath("/apostas");
}

export async function deleteBet(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  const { error } = await supabase.from("bets").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/apostas");
}

// Fix a placed bet (wrong odd or market): teams and kind stay, the rest can
// change. Custom markets ("Outro") bring their own label.
export async function updateBet(
  id: string,
  input: { marketKey: unknown; marketLabel: unknown; odd: unknown; league?: unknown; kickoff?: unknown; kind?: unknown }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  const marketKey = cleanText(input.marketKey, 24);
  const marketLabel = cleanText(input.marketLabel);
  if (!marketKey || !marketLabel) throw new Error("Escolhe o mercado.");
  const odd = cleanOdd(input.odd);
  if (odd === null) throw new Error("Odd inválida (tem de ser maior que 1).");
  const kickoff = cleanText(input.kickoff);
  const kickoffAt = kickoff && !Number.isNaN(new Date(kickoff).getTime()) ? new Date(kickoff).toISOString() : null;
  const kind = cleanText(input.kind, 12);
  if (kind !== "" && kind !== "pre" && kind !== "watch" && kind !== "live") {
    throw new Error("Tipo de aposta inválido.");
  }
  // Editing reopens the bet (status open, hand-touched): the automatic
  // check settles it again with the fixed values on the next load.
  const { error } = await supabase
    .from("bets")
    .update({
      market_key: marketKey,
      market_label: marketLabel,
      odd,
      league_label: cleanText(input.league) || null,
      kickoff: kickoffAt,
      ...(kind !== "" ? { kind } : {}),
      status: "open",
      settled_auto: false,
      settled_at: null,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/apostas");
}