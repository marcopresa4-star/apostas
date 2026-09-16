"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import EntityCombobox, { type ComboItem, type ComboCountry } from "./EntityCombobox";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import { updateTicket, createTeam, createCompetition } from "@/app/(app)/actions";

export default function EditTicketForm({
  ticketId,
  initialCompetition,
  initialHomeTeam,
  initialAwayTeam,
  initialMatchDate,
  initialMatchTime,
  initialCompetitions,
  initialTeams,
  countries,
}: {
  ticketId: string;
  initialCompetition: ComboItem;
  initialHomeTeam: ComboItem;
  initialAwayTeam: ComboItem;
  initialMatchDate: string;
  initialMatchTime: string;
  initialCompetitions: ComboItem[];
  initialTeams: ComboItem[];
  countries: ComboCountry[];
}) {
  const [competitions, setCompetitions] = useState(initialCompetitions);
  const [teams, setTeams] = useState(initialTeams);

  const [competition, setCompetition] = useState<ComboItem | null>(initialCompetition);
  const [homeTeam, setHomeTeam] = useState<ComboItem | null>(initialHomeTeam);
  const [awayTeam, setAwayTeam] = useState<ComboItem | null>(initialAwayTeam);
  const [matchDate, setMatchDate] = useState(initialMatchDate);
  const [matchTime, setMatchTime] = useState(initialMatchTime);

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
        await updateTicket({
          ticketId,
          competitionId: competition.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          matchDate,
          matchTime,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setError("Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
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
        <DatePicker label="Dia do jogo" value={matchDate} onChange={setMatchDate} />
        <TimePicker label="Hora" value={matchTime} onChange={setMatchTime} />
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link
          href="/"
          className="rounded-lg px-3 py-2 text-center font-medium text-neutral-400 transition hover:text-white sm:w-auto"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-60 sm:w-auto"
        >
          {isPending ? "A guardar..." : "Guardar alterações"}
        </button>
      </div>
    </div>
  );
}
