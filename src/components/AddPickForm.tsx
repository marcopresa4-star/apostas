"use client";

import { useState, useTransition } from "react";
import { addPick, createBetCategory } from "@/app/(app)/actions";
import CategoryCombobox, { type TagItem } from "./CategoryCombobox";
import LiveModeToggle, { type LiveMode } from "./LiveModeToggle";
import type { BetType } from "@/lib/database.types";

// What a duplicated bet starts with; everything can be changed before saving.
export interface PickTemplate {
  category: TagItem | null;
  reason: string | null;
  odd: number | null;
  oddMin: number | null;
  alertMinute: number | null;
  sofascoreUrl: string | null;
  bookmakerUrl: string | null;
}

const text = (n: number | null) => (n === null ? "" : String(n));

export default function AddPickForm({
  ticketId,
  betType,
  initialCategories,
  template,
}: {
  ticketId: string;
  betType: BetType;
  initialCategories: TagItem[];
  // Opens the form already filled in, to duplicate a bet of this game. Give it a
  // new `key` to start from another one.
  template?: PickTemplate;
}) {
  const [open, setOpen] = useState(Boolean(template));
  const [mode, setMode] = useState<LiveMode>("watching");
  const [odd, setOdd] = useState(text(template?.odd ?? null));
  const [oddMin, setOddMin] = useState(text(template?.oddMin ?? null));
  const [entryOdd, setEntryOdd] = useState("");
  const [entryMinute, setEntryMinute] = useState("");
  const [alertMinute, setAlertMinute] = useState(text(template?.alertMinute ?? null));
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<TagItem | null>(template?.category ?? null);
  const [reason, setReason] = useState(template?.reason ?? "");
  const [sofascoreUrl, setSofascoreUrl] = useState(template?.sofascoreUrl ?? "");
  const [bookmakerUrl, setBookmakerUrl] = useState(template?.bookmakerUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs font-medium hover:underline ${
          betType === "live" ? "text-sky-400" : "text-emerald-400"
        }`}
      >
        {betType === "live" ? "+ Nova aposta live" : "+ Adicionar aposta pré-jogo"}
      </button>
    );
  }

  function reset() {
    setOdd("");
    setOddMin("");
    setEntryOdd("");
    setEntryMinute("");
    setAlertMinute("");
    setSofascoreUrl("");
    setBookmakerUrl("");
    setCategory(null);
    setReason("");
  }

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function handleSubmit() {
    setError(null);
    if (!category?.id) {
      setError("Seleciona ou cria o tipo de aposta.");
      return;
    }
    const enteringLive = betType === "live" && mode === "active";
    if (enteringLive) {
      const minute = Number(entryMinute);
      if (!entryMinute.trim() || !Number.isInteger(minute) || minute < 0 || minute > 150) {
        setError("Indica o minuto do jogo em que entraste (0 a 150).");
        return;
      }
    }
    startTransition(async () => {
      try {
        await addPick({
          ticketId,
          selection: category.name,
          reason,
          betType,
          stage: betType === "live" ? mode : "active",
          odd: odd.trim() ? Number(odd) : null,
          oddMin: betType === "live" && mode === "watching" && oddMin.trim() ? Number(oddMin) : null,
          entryOdd: enteringLive && entryOdd.trim() ? Number(entryOdd) : null,
          entryMinute: enteringLive ? Number(entryMinute) : null,
          alertMinute:
            betType === "live" && mode === "watching" && alertMinute.trim()
              ? Number(alertMinute)
              : null,
          sofascoreUrl,
          bookmakerUrl,
          categoryId: category.id,
        });
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      {template && (
        <p className="mb-2 text-xs text-neutral-400">
          <span className="font-medium text-neutral-200">Duplicar aposta.</span> Já vem preenchida: muda o tipo de
          aposta ou o que quiseres e clica em Adicionar.
        </p>
      )}
      {betType === "live" && (
        <div className="mb-2">
          <LiveModeToggle value={mode} onChange={setMode} small />
        </div>
      )}
      <div className="mb-2 flex gap-2">
        <div className="min-w-0 flex-1">
          <CategoryCombobox
            label="Tipo de aposta"
            placeholder="Ex: Over/Under, Ambas Marcam..."
            items={categories}
            value={category}
            onSelect={setCategory}
            createAction={createBetCategory}
            onCreated={addCategory}
          />
        </div>
        {betType === "pre_jogo" ? (
          <div className="w-20 shrink-0">
            <label className="mb-1 block text-sm text-neutral-300">&nbsp;</label>
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={odd}
              onChange={(e) => setOdd(e.target.value)}
              placeholder="Odd"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
          </div>
        ) : mode === "active" ? (
          <>
            <div className="w-28 shrink-0">
              <label className="mb-1 block text-sm text-neutral-300">&nbsp;</label>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={entryOdd}
                onChange={(e) => setEntryOdd(e.target.value)}
                placeholder="Odd entrada"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="w-24 shrink-0">
              <label className="mb-1 block text-sm text-neutral-300">&nbsp;</label>
              <input
                type="number"
                step="1"
                min="0"
                max="150"
                value={entryMinute}
                onChange={(e) => setEntryMinute(e.target.value)}
                placeholder="Minuto"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
          </>
        ) : (
          <>
            <div className="w-24 shrink-0">
              <label className="mb-1 block text-sm text-neutral-300">&nbsp;</label>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={oddMin}
                onChange={(e) => setOddMin(e.target.value)}
                placeholder="Odd mín."
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="w-24 shrink-0">
              <label className="mb-1 block text-sm text-neutral-300">&nbsp;</label>
              <input
                type="number"
                step="1"
                min="1"
                value={alertMinute}
                onChange={(e) => setAlertMinute(e.target.value)}
                placeholder="Alerta min."
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
          </>
        )}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Razão (opcional)"
        className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
      />
      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="url"
          value={sofascoreUrl}
          onChange={(e) => setSofascoreUrl(e.target.value)}
          placeholder="Link SofaScore (opcional)"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <input
          type="url"
          value={bookmakerUrl}
          onChange={(e) => setBookmakerUrl(e.target.value)}
          placeholder="Link da casa de apostas (opcional)"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
      </div>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSubmit}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${
            betType === "live" ? "bg-sky-600 hover:bg-sky-500" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
        >
          {isPending ? "A guardar..." : "Adicionar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
