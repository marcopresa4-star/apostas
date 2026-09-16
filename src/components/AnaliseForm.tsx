"use client";

import { useState, useTransition } from "react";
import SearchCombobox from "./SearchCombobox";
import { searchLeagues, searchTeams, analiseJogo } from "@/app/(app)/analise/actions";
import type { AFLeague, AFTeam, AFFixture, AFStandingRow } from "@/lib/apiFootball";

function resultLabel(fixture: AFFixture, teamName: string): "V" | "E" | "D" | "?" {
  if (fixture.homeGoals === null || fixture.awayGoals === null) return "?";
  const isHome = fixture.homeTeam === teamName;
  const goalsFor = isHome ? fixture.homeGoals : fixture.awayGoals;
  const goalsAgainst = isHome ? fixture.awayGoals : fixture.homeGoals;
  if (goalsFor > goalsAgainst) return "V";
  if (goalsFor < goalsAgainst) return "D";
  return "E";
}

const RESULT_STYLES: Record<string, string> = {
  V: "bg-emerald-600 text-white",
  E: "bg-neutral-600 text-white",
  D: "bg-red-600 text-white",
  "?": "bg-neutral-800 text-neutral-400",
};

function FormRow({ team, fixtures }: { team: AFTeam; fixtures: AFFixture[] }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-neutral-200">{team.name}</p>
      <div className="flex flex-wrap gap-1.5">
        {fixtures.map((f) => {
          const result = resultLabel(f, team.name);
          return (
            <span
              key={f.fixtureId}
              title={`${f.homeTeam} ${f.homeGoals ?? "-"} - ${f.awayGoals ?? "-"} ${f.awayTeam}`}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${RESULT_STYLES[result]}`}
            >
              {result}
            </span>
          );
        })}
        {fixtures.length === 0 && (
          <span className="text-xs text-neutral-500">Sem jogos recentes.</span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {fixtures
          .map((f) => (f.homeTeam === team.name ? "vs " + f.awayTeam : "vs " + f.homeTeam))
          .slice(0, 3)
          .join(" · ")}
      </p>
    </div>
  );
}

export default function AnaliseForm() {
  const [league, setLeague] = useState<AFLeague | null>(null);
  const [homeTeam, setHomeTeam] = useState<AFTeam | null>(null);
  const [awayTeam, setAwayTeam] = useState<AFTeam | null>(null);

  const [result, setResult] = useState<{
    homeForm: AFFixture[];
    awayForm: AFFixture[];
    h2h: AFFixture[];
    standings: AFStandingRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAnalyze() {
    setError(null);
    if (!league) return setError("Seleciona a competição.");
    if (!homeTeam) return setError("Seleciona a equipa da casa.");
    if (!awayTeam) return setError("Seleciona a equipa de fora.");

    startTransition(async () => {
      try {
        const data = await analiseJogo({
          leagueId: league.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
        });
        setResult(data);
      } catch {
        setError(
          "Não foi possível obter a análise. Verifica a chave da API ou tenta novamente mais tarde."
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <SearchCombobox
          label="Competição"
          placeholder="Ex: Primeira Liga"
          value={league}
          onSelect={setLeague}
          searchAction={searchLeagues}
          renderSubtitle={(l) => l.country}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SearchCombobox
            label="Equipa da casa"
            placeholder="Ex: Benfica"
            value={homeTeam}
            onSelect={setHomeTeam}
            searchAction={searchTeams}
            renderSubtitle={(t) => t.country}
          />
          <SearchCombobox
            label="Equipa de fora"
            placeholder="Ex: Sporting"
            value={awayTeam}
            onSelect={setAwayTeam}
            searchAction={searchTeams}
            renderSubtitle={(t) => t.country}
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={isPending}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-60 sm:w-auto"
        >
          {isPending ? "A analisar..." : "Analisar"}
        </button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-neutral-400">
              Forma recente (últimos 5 jogos)
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {homeTeam && <FormRow team={homeTeam} fixtures={result.homeForm} />}
              {awayTeam && <FormRow team={awayTeam} fixtures={result.awayForm} />}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-neutral-400">Confronto direto</h2>
            {result.h2h.length === 0 && (
              <p className="text-sm text-neutral-500">Sem confrontos recentes entre as duas equipas.</p>
            )}
            <div className="space-y-1.5">
              {result.h2h.map((f) => (
                <div
                  key={f.fixtureId}
                  className="flex items-center justify-between rounded-lg bg-neutral-950 px-3 py-2 text-sm"
                >
                  <span className="text-neutral-300">
                    {f.homeTeam} <span className="text-neutral-500">vs</span> {f.awayTeam}
                  </span>
                  <span className="font-medium text-neutral-100">
                    {f.homeGoals ?? "-"} - {f.awayGoals ?? "-"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-neutral-400">Classificação</h2>
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Equipa</th>
                  <th className="px-2 py-1 text-center">J</th>
                  <th className="px-2 py-1 text-center">V</th>
                  <th className="px-2 py-1 text-center">E</th>
                  <th className="px-2 py-1 text-center">D</th>
                  <th className="px-2 py-1 text-center">DG</th>
                  <th className="px-2 py-1 text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((row) => {
                  const highlighted =
                    row.teamId === homeTeam?.id || row.teamId === awayTeam?.id;
                  return (
                    <tr
                      key={row.teamId}
                      className={
                        highlighted
                          ? "bg-emerald-950/40 text-emerald-300"
                          : "text-neutral-300"
                      }
                    >
                      <td className="py-1.5 pr-2">{row.rank}</td>
                      <td className="py-1.5 pr-2">{row.teamName}</td>
                      <td className="px-2 py-1.5 text-center">{row.played}</td>
                      <td className="px-2 py-1.5 text-center">{row.win}</td>
                      <td className="px-2 py-1.5 text-center">{row.draw}</td>
                      <td className="px-2 py-1.5 text-center">{row.lose}</td>
                      <td className="px-2 py-1.5 text-center">{row.goalsDiff}</td>
                      <td className="px-2 py-1.5 text-center font-semibold">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
