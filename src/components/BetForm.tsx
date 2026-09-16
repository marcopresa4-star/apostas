"use client";

import { useState, useTransition } from "react";
import EntityCombobox, { type ComboItem, type ComboCountry } from "./EntityCombobox";
import { createBet, createTeam, createCompetition } from "@/app/(app)/actions";

export default function BetForm({
  initialCompetitions,
  initialTeams,
  countries,
}: {
  initialCompetitions: ComboItem[];
  initialTeams: ComboItem[];
  countries: ComboCountry[];
}) {
  const [competitions, setCompetitions] = useState(initialCompetitions);
  const [teams, setTeams] = useState(initialTeams);

  const [competition, setCompetition] = useState<ComboItem | null>(null);
  const [homeTeam, setHomeTeam] = useState<ComboItem | null>(null);
  const [awayTeam, setAwayTeam] = useState<ComboItem | null>(null);
  const [matchDate, setMatchDate] = useState("");
  const [matchTime, setMatchTime] = useState("");
  const [reason, setReason] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addTeam(item: ComboItem) {
    setTeams((prev) => (prev.some((t) => t.id === item.id) ? prev : [...prev, item]));
  }

  function addCompetition(item: ComboItem) {
    setCompetitions((prev) =>
      prev.some((c) => c.id === item.id) ? prev : [...prev, item]
    );
  }

  function handleSubmit() {
    setError(null);

    if (!competition?.id) return setError("Seleciona ou cria a competição.");
    if (!homeTeam?.id) return setError("Seleciona ou cria a equipa da casa.");
    if (!awayTeam?.id) return setError("Seleciona ou cria a equipa de fora.");
    if (homeTeam.id === awayTeam.id)
      return setError("A equipa da casa e a equipa de fora têm de ser diferentes.");
    if (!matchDate) return setError("Indica o dia do jogo.");
    if (!matchTime) return setError("Indica a hora do jogo.");

    startTransition(async () => {
      try {
        await createBet({
          competitionId: competition.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          matchDate,
          matchTime,
          reason,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setError("Não foi possível guardar a aposta. Tenta novamente.");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <EntityCombobox
        label="Competição / Liga"
        placeholder="Ex: Primeira Liga"
        createLabel="Criar competição"
        items={competitions}
        countries={countries}
        value={competition}
        onSelect={setCompetition}
        createAction={createCompetition}
        onCreated={addCompetition}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EntityCombobox
          label="Equipa da casa"
          placeholder="Ex: Benfica"
          createLabel="Criar equipa"
          items={teams}
          countries={countries}
          value={homeTeam}
          onSelect={setHomeTeam}
          createAction={createTeam}
          onCreated={addTeam}
        />
        <EntityCombobox
          label="Equipa de fora"
          placeholder="Ex: Sporting"
          createLabel="Criar equipa"
          items={teams}
          countries={countries}
          value={awayTeam}
          onSelect={setAwayTeam}
          createAction={createTeam}
          onCreated={addTeam}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Dia do jogo</label>
          <input
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Hora</label>
          <input
            type="time"
            value={matchTime}
            onChange={(e) => setMatchTime(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-300">Razão da aposta</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Porque estás a fazer esta aposta..."
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "A guardar..." : "Registar aposta"}
      </button>
    </div>
  );
}
