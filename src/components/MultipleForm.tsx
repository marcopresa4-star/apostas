"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import EntityCombobox, { type ComboItem, type ComboCountry } from "./EntityCombobox";
import CategoryCombobox, { type TagItem } from "./CategoryCombobox";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import { kickoffFromMinute } from "@/lib/matchStatus";
import { formatOdd, totalOdd } from "@/lib/multiples";
import type { BetType } from "@/lib/database.types";
import {
  createMultiple,
  createTeam,
  createCompetition,
  createBetCategory,
  deleteTeam,
  deleteCompetition,
} from "@/app/(app)/actions";

interface LegDraft {
  key: number;
  competition: ComboItem | null;
  home: ComboItem | null;
  away: ComboItem | null;
  date: string;
  time: string;
  category: TagItem | null;
  odd: string;
  minute: string;
}

const MIN_LEGS = 2;
const MAX_LEGS = 20;

const THEME = {
  pre_jogo: {
    back: "/apostas",
    button:
      "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-500",
    focus: "focus:border-emerald-500",
    link: "text-emerald-400",
  },
  live: {
    back: "/live",
    button: "bg-sky-600 shadow-sky-600/20 hover:bg-sky-500",
    focus: "focus:border-sky-500",
    link: "text-sky-400",
  },
} as const;

let nextKey = 1;
function emptyLeg(): LegDraft {
  return {
    key: nextKey++,
    competition: null,
    home: null,
    away: null,
    date: "",
    time: "",
    category: null,
    odd: "",
    minute: "",
  };
}

// A pre-game multiple picks a day and time per game; a live one is registered
// once entered, so each game only needs the minute you entered at (its kickoff
// is worked out from that, like a live bet you are already on).
export default function MultipleForm({
  betType,
  initialCompetitions,
  initialTeams,
  countries,
  initialCategories,
}: {
  betType: BetType;
  initialCompetitions: ComboItem[];
  initialTeams: ComboItem[];
  countries: ComboCountry[];
  initialCategories: TagItem[];
}) {
  const live = betType === "live";
  const theme = THEME[betType];
  const inputClass = `w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors ${theme.focus}`;

  const [competitions, setCompetitions] = useState(initialCompetitions);
  const [teams, setTeams] = useState(initialTeams);
  const [categories, setCategories] = useState(initialCategories);
  const [legs, setLegs] = useState<LegDraft[]>(() => [emptyLeg(), emptyLeg()]);
  const [reason, setReason] = useState("");
  const [bookmakerUrl, setBookmakerUrl] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateLeg(key: number, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLeg(key: number) {
    setLegs((prev) => prev.filter((l) => l.key !== key));
  }

  function addTeam(item: ComboItem) {
    setTeams((prev) => (prev.some((t) => t.id === item.id) ? prev : [...prev, item]));
  }

  function addCompetition(item: ComboItem) {
    setCompetitions((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function removeTeam(id: string) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
    setLegs((prev) =>
      prev.map((l) => ({
        ...l,
        home: l.home?.id === id ? null : l.home,
        away: l.away?.id === id ? null : l.away,
      }))
    );
  }

  function removeCompetition(id: string) {
    setCompetitions((prev) => prev.filter((c) => c.id !== id));
    setLegs((prev) =>
      prev.map((l) => ({ ...l, competition: l.competition?.id === id ? null : l.competition }))
    );
  }

  const odds = legs.map((l) => Number(l.odd));
  const allOddsValid = legs.every((l) => l.odd.trim() !== "" && Number(l.odd) > 1);

  function handleSubmit() {
    setError(null);

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const fail = (message: string) => setError(`Jogo ${i + 1}: ${message}`);

      if (!leg.competition?.id) return fail("seleciona ou cria a competição.");
      if (!leg.home?.id) return fail("seleciona ou cria a equipa da casa.");
      if (!leg.away?.id) return fail("seleciona ou cria a equipa de fora.");
      if (leg.home.id === leg.away.id)
        return fail("a equipa da casa e a de fora têm de ser diferentes.");
      if (live) {
        if (!leg.minute.trim()) return fail("indica o minuto em que entraste.");
        const minute = Number(leg.minute);
        if (!Number.isInteger(minute) || minute < 0 || minute > 150)
          return fail("o minuto tem de ser um número entre 0 e 150.");
      } else {
        if (!leg.date) return fail("indica o dia do jogo.");
        if (!leg.time) return fail("indica a hora do jogo.");
      }
      if (!leg.category?.id) return fail("seleciona ou cria o tipo de aposta.");
      if (!leg.odd.trim()) return fail("indica a odd.");
      if (!(Number(leg.odd) > 1)) return fail("a odd tem de ser maior que 1.");
    }

    const now = new Date();
    startTransition(async () => {
      try {
        await createMultiple({
          betType,
          reason,
          bookmakerUrl,
          legs: legs.map((leg) => {
            const kickoff = live
              ? kickoffFromMinute(Number(leg.minute), now)
              : { date: leg.date, time: leg.time };
            return {
              competitionId: leg.competition!.id,
              homeTeamId: leg.home!.id,
              awayTeamId: leg.away!.id,
              matchDate: kickoff.date,
              matchTime: kickoff.time,
              selection: leg.category!.name,
              categoryId: leg.category!.id,
              odd: Number(leg.odd),
              entryMinute: live ? Number(leg.minute) : null,
            };
          }),
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setError(
          err instanceof Error && err.message.startsWith("Jogo ")
            ? err.message
            : "Não foi possível guardar a múltipla. Tenta novamente."
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      {legs.map((leg, index) => (
        <div
          key={leg.key}
          className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">Jogo {index + 1}</h2>
            {legs.length > MIN_LEGS && (
              <button
                type="button"
                onClick={() => removeLeg(leg.key)}
                className="text-xs font-medium text-neutral-500 hover:text-red-400"
              >
                Remover jogo
              </button>
            )}
          </div>

          <EntityCombobox
            label="Competição / Liga"
            placeholder="Ex: Primeira Liga"
            createLabel="Criar competição"
            searchTable="competitions"
            items={competitions}
            countries={countries}
            value={leg.competition}
            onSelect={(item) => updateLeg(leg.key, { competition: item })}
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
              value={leg.home}
              onSelect={(item) => updateLeg(leg.key, { home: item })}
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
              value={leg.away}
              onSelect={(item) => updateLeg(leg.key, { away: item })}
              createAction={createTeam}
              onCreated={addTeam}
              deleteAction={deleteTeam}
              onDeleted={removeTeam}
            />
          </div>

          {!live && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DatePicker
                label="Dia do jogo"
                value={leg.date}
                onChange={(date) => updateLeg(leg.key, { date })}
              />
              <TimePicker
                label="Hora"
                value={leg.time}
                onChange={(time) => updateLeg(leg.key, { time })}
              />
            </div>
          )}

          <div
            className={`grid grid-cols-1 gap-4 ${live ? "sm:grid-cols-[2fr_1fr_1fr]" : "sm:grid-cols-[2fr_1fr]"}`}
          >
            <CategoryCombobox
              label="Tipo de aposta"
              placeholder="Ex: Over/Under, Ambas Marcam, Handicap..."
              items={categories}
              value={leg.category}
              onSelect={(category) => updateLeg(leg.key, { category })}
              createAction={createBetCategory}
              onCreated={addCategory}
            />
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Odd</label>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={leg.odd}
                onChange={(e) => updateLeg(leg.key, { odd: e.target.value })}
                placeholder="Ex: 1.85"
                className={inputClass}
              />
            </div>
            {live && (
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Minuto em que entrei</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="150"
                  value={leg.minute}
                  onChange={(e) => updateLeg(leg.key, { minute: e.target.value })}
                  placeholder="Ex: 35"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        </div>
      ))}

      {legs.length < MAX_LEGS && (
        <button
          type="button"
          onClick={() => setLegs((prev) => [...prev, emptyLeg()])}
          className={`w-full rounded-2xl border border-dashed border-neutral-700 px-4 py-3 text-sm font-medium transition hover:border-neutral-500 hover:bg-neutral-900 ${theme.link}`}
        >
          + Adicionar jogo
        </button>
      )}

      <div className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-neutral-950 px-4 py-3">
          <span className="text-sm text-neutral-400">
            Odd total · {legs.length} jogos
          </span>
          <span className="text-2xl font-bold text-emerald-400">
            {allOddsValid ? formatOdd(totalOdd(odds)) : "—"}
          </span>
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-300">
            Razão da aposta <span className="text-neutral-500">(opcional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Porque estás a fazer esta múltipla..."
            className={inputClass}
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
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Link
            href={theme.back}
            className="rounded-lg px-3 py-2 text-center font-medium text-neutral-400 transition hover:text-white sm:w-auto"
          >
            Cancelar
          </Link>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className={`w-full rounded-lg px-3 py-2 font-medium text-white shadow-lg transition disabled:opacity-60 sm:w-auto ${theme.button}`}
          >
            {isPending ? "A guardar..." : "Registar múltipla"}
          </button>
        </div>
      </div>
    </div>
  );
}
