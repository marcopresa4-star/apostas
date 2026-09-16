"use server";

import {
  searchLeagues as apiSearchLeagues,
  searchTeams as apiSearchTeams,
  getRecentForm,
  getHeadToHead,
  getStandings,
  type AFLeague,
  type AFTeam,
  type AFFixture,
  type AFStandingRow,
} from "@/lib/apiFootball";

// Next.js redacts messages thrown from Server Actions in production, so
// errors are returned as data instead of thrown, to actually reach the UI.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Erro desconhecido.";
}

export async function searchLeagues(query: string): Promise<ActionResult<AFLeague[]>> {
  try {
    return { ok: true, data: await apiSearchLeagues(query) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function searchTeams(query: string): Promise<ActionResult<AFTeam[]>> {
  try {
    return { ok: true, data: await apiSearchTeams(query) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export interface AnaliseData {
  homeForm: AFFixture[];
  awayForm: AFFixture[];
  h2h: AFFixture[];
  standings: AFStandingRow[];
}

export async function analiseJogo(input: {
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  season: number;
}): Promise<ActionResult<AnaliseData>> {
  try {
    const [homeForm, awayForm, h2h, standings] = await Promise.all([
      getRecentForm(input.homeTeamId, input.season),
      getRecentForm(input.awayTeamId, input.season),
      getHeadToHead(input.homeTeamId, input.awayTeamId),
      getStandings(input.leagueId, input.season),
    ]);

    return { ok: true, data: { homeForm, awayForm, h2h, standings } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
