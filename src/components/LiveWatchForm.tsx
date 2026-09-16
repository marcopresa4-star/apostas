"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import EntityCombobox, { type ComboItem, type ComboCountry } from "./EntityCombobox";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import {
  createTicket,
  createTeam,
  createCompetition,
  deleteTeam,
  deleteCompetition,
} from "@/app/(app)/actions";

export default function LiveWatchForm({
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
  const [selection, setSelection] = useState("");
  const [oddMin, setOddMin] = useState("");
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

  function removeTeam(id: string) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
    if (homeTeam?.id === id) setHomeTeam(null);
    if (awayTeam?.id === id) setAwayTeam(null);
  }

  function removeCompetition(id: string) {
    setCompetitions((prev) => prev.filter((c) => c.id !== id));
    if (competition?.id === id) setCompetition(null);
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
    if (!selection.trim()) return setError("Indica a possível aposta.");
    if (!oddMin.trim()) return setError("Indica a odd mínima de entrada.");
    if (Number(oddMin) <= 1) return setError("A odd tem de ser maior que 1.");

    startTransition(async () => {
      try {
        await createTicket({
          competitionId: competition.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          matchDate,
          matchTime,
          selection,
          reason,
          betType: "live",
          odd: null,
          oddMin: Number(oddMin),
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
        deleteAction={deleteCompetition}
        onDeleted={removeCompetition}
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
          deleteAction={deleteTeam}
          onDeleted={removeTeam}
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
          deleteAction={deleteTeam}
          onDeleted={removeTeam}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DatePicker label="Dia do jogo" value={matchDate} onChange={setMatchDate} />
        <TimePicker label="Hora" value={matchTime} onChange={setMatchTime} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Possível aposta</label>
          <input
            type="text"
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            placeholder="Ex: Próximo a marcar: Casa"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Odd mínima</label>
          <input
            type="number"
            step="0.01"
            min="1.01"
            value={oddMin}
            onChange={(e) => setOddMin(e.target.value)}
            placeholder="Ex: 1.85"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-300">Razão (opcional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="O que estás a vigiar neste jogo..."
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
        />
      </div>

      <p className="text-xs text-neutral-500">
        Depois de guardares, podes adicionar mais apostas live a este mesmo jogo diretamente
        na lista.
      </p>

      {error && (
        <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link
          href="/live"
          className="rounded-lg px-3 py-2 text-center font-medium text-neutral-400 transition hover:text-white sm:w-auto"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full rounded-lg bg-sky-600 px-3 py-2 font-medium text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500 disabled:opacity-60 sm:w-auto"
        >
          {isPending ? "A guardar..." : "Vigiar jogo"}
        </button>
      </div>
    </div>
  );
}
