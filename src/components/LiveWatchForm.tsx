"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import EntityCombobox, { type ComboItem, type ComboCountry } from "./EntityCombobox";
import CategoryCombobox, { type TagItem } from "./CategoryCombobox";
import DatePicker from "./DatePicker";
import LiveModeToggle, { type LiveMode } from "./LiveModeToggle";
import TimePicker from "./TimePicker";
import { kickoffFromMinute } from "@/lib/matchStatus";
import {
  createTicket,
  createTeam,
  createCompetition,
  createBetCategory,
  deleteTeam,
  deleteCompetition,
} from "@/app/(app)/actions";

export default function LiveWatchForm({
  initialCompetitions,
  initialTeams,
  countries,
  initialCategories,
}: {
  initialCompetitions: ComboItem[];
  initialTeams: ComboItem[];
  countries: ComboCountry[];
  initialCategories: TagItem[];
}) {
  const [competitions, setCompetitions] = useState(initialCompetitions);
  const [teams, setTeams] = useState(initialTeams);
  const [categories, setCategories] = useState(initialCategories);

  const [competition, setCompetition] = useState<ComboItem | null>(null);
  const [homeTeam, setHomeTeam] = useState<ComboItem | null>(null);
  const [awayTeam, setAwayTeam] = useState<ComboItem | null>(null);
  const [matchDate, setMatchDate] = useState("");
  const [matchTime, setMatchTime] = useState("");
  const [mode, setMode] = useState<LiveMode>("watching");
  const [oddMin, setOddMin] = useState("");
  const [entryOdd, setEntryOdd] = useState("");
  const [entryMinute, setEntryMinute] = useState("");
  const [alertMinute, setAlertMinute] = useState("");
  const [category, setCategory] = useState<TagItem | null>(null);
  const [reason, setReason] = useState("");
  const [sofascoreUrl, setSofascoreUrl] = useState("");
  const [bookmakerUrl, setBookmakerUrl] = useState("");

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

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function handleSubmit() {
    setError(null);

    if (!competition?.id) return setError("Seleciona ou cria a competição.");
    if (!homeTeam?.id) return setError("Seleciona ou cria a equipa da casa.");
    if (!awayTeam?.id) return setError("Seleciona ou cria a equipa de fora.");
    if (homeTeam.id === awayTeam.id)
      return setError("A equipa da casa e a equipa de fora têm de ser diferentes.");
    // A game you already entered is happening right now, so its day and
    // kickoff come from the minute you enter instead of being typed in.
    if (mode === "watching") {
      if (!matchDate) return setError("Indica o dia do jogo.");
      if (!matchTime) return setError("Indica a hora do jogo.");
    }
    if (!category?.id) return setError("Seleciona ou cria o tipo de aposta.");
    if (mode === "watching") {
      if (!oddMin.trim()) return setError("Indica a odd mínima de entrada.");
      if (Number(oddMin) <= 1) return setError("A odd tem de ser maior que 1.");
    } else {
      if (!entryOdd.trim()) return setError("Indica a odd em que entraste.");
      if (Number(entryOdd) <= 1) return setError("A odd tem de ser maior que 1.");
      if (!entryMinute.trim()) return setError("Indica o minuto do jogo em que entraste.");
      const minute = Number(entryMinute);
      if (!Number.isInteger(minute) || minute < 0 || minute > 150)
        return setError("O minuto tem de ser um número entre 0 e 150.");
    }

    const kickoff =
      mode === "active"
        ? kickoffFromMinute(Number(entryMinute), new Date())
        : { date: matchDate, time: matchTime };

    startTransition(async () => {
      try {
        await createTicket({
          competitionId: competition.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          matchDate: kickoff.date,
          matchTime: kickoff.time,
          selection: category.name,
          reason,
          betType: "live",
          stage: mode,
          odd: null,
          oddMin: mode === "watching" ? Number(oddMin) : null,
          entryOdd: mode === "active" ? Number(entryOdd) : null,
          entryMinute: mode === "active" ? Number(entryMinute) : null,
          alertMinute: mode === "watching" && alertMinute.trim() ? Number(alertMinute) : null,
          sofascoreUrl,
          bookmakerUrl,
          categoryId: category.id,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setError("Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
      <LiveModeToggle value={mode} onChange={setMode} />

      <EntityCombobox
        label="Competição / Liga"
        placeholder="Ex: Primeira Liga"
        createLabel="Criar competição"
        searchTable="competitions"
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
          searchTable="teams"
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
          searchTable="teams"
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

      {mode === "watching" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePicker label="Dia do jogo" value={matchDate} onChange={setMatchDate} />
          <TimePicker label="Hora" value={matchTime} onChange={setMatchTime} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <CategoryCombobox
          label="Tipo de aposta"
          placeholder="Ex: Over/Under, Ambas Marcam, Handicap..."
          items={categories}
          value={category}
          onSelect={setCategory}
          createAction={createBetCategory}
          onCreated={addCategory}
        />
        {mode === "watching" ? (
          <>
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
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Alerta ao minuto</label>
              <input
                type="number"
                step="1"
                min="1"
                value={alertMinute}
                onChange={(e) => setAlertMinute(e.target.value)}
                placeholder="Ex: 10"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Odd em que entrei</label>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={entryOdd}
                onChange={(e) => setEntryOdd(e.target.value)}
                placeholder="Ex: 1.85"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Minuto em que entrei</label>
              <input
                type="number"
                step="1"
                min="0"
                max="150"
                value={entryMinute}
                onChange={(e) => setEntryMinute(e.target.value)}
                placeholder="Ex: 35"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
              />
            </div>
          </>
        )}
      </div>

      {mode === "active" && (
        <p className="text-xs text-neutral-500">
          A hora do jogo é calculada a partir deste minuto. Se ficar diferente, corrige em Editar
          jogo.
        </p>
      )}

      <div>
        <label className="mb-1 block text-sm text-neutral-300">Razão (opcional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={
            mode === "watching" ? "O que estás a vigiar neste jogo..." : "Porque entraste nesta aposta..."
          }
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">
            Link SofaScore <span className="text-neutral-500">(opcional)</span>
          </label>
          <input
            type="url"
            value={sofascoreUrl}
            onChange={(e) => setSofascoreUrl(e.target.value)}
            placeholder="https://www.sofascore.com/..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">
            Link da casa de apostas <span className="text-neutral-500">(opcional)</span>
          </label>
          <input
            type="url"
            value={bookmakerUrl}
            onChange={(e) => setBookmakerUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500"
          />
        </div>
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
          {isPending ? "A guardar..." : mode === "watching" ? "Vigiar jogo" : "Registar entrada"}
        </button>
      </div>
    </div>
  );
}
