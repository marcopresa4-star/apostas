"use server";

import {
  searchLeagues as apiSearchLeagues,
  searchTeams as apiSearchTeams,
  getRecentForm,
  getHeadToHead,
  getStandings,
} from "@/lib/apiFootball";

export async function searchLeagues(query: string) {
  return apiSearchLeagues(query);
}

export async function searchTeams(query: string) {
  return apiSearchTeams(query);
}

export async function analiseJogo(input: {
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
}) {
  const [homeForm, awayForm, h2h, standings] = await Promise.all([
    getRecentForm(input.homeTeamId),
    getRecentForm(input.awayTeamId),
    getHeadToHead(input.homeTeamId, input.awayTeamId),
    getStandings(input.leagueId),
  ]);

  return { homeForm, awayForm, h2h, standings };
}
