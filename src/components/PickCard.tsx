"use client";

import { useState, useTransition } from "react";
import StatusBadge, { STATUS_BORDER } from "./StatusBadge";
import StatusButtons from "./StatusButtons";
import PickImages, { type PickImageItem } from "./PickImages";
import CategoryCombobox, { type TagItem } from "./CategoryCombobox";
import { updatePick, createBetCategory, setPickPublished } from "@/app/(app)/actions";
import type { BetStatus, BetType } from "@/lib/database.types";

interface PickCardProps {
  pick: {
    id: string;
    selection: string;
    reason: string | null;
    status: BetStatus;
    bet_type: BetType;
    odd: number | null;
    odd_min: number | null;
    alert_minute: number | null;
    sofascore_url: string | null;
    bookmaker_url: string | null;
    is_published: boolean;
    category: { id: string; name: string } | null;
  };
  images: PickImageItem[];
  initialCategories: TagItem[];
}

export default function PickCard({ pick, images, initialCategories }: PickCardProps) {
  const [editing, setEditing] = useState(false);
  const [isTogglingPublish, startPublishTransition] = useTransition();
  const [betType, setBetType] = useState<BetType>(pick.bet_type);
  const [odd, setOdd] = useState(pick.odd !== null ? String(pick.odd) : "");
  const [oddMin, setOddMin] = useState(pick.odd_min !== null ? String(pick.odd_min) : "");
  const [alertMinute, setAlertMinute] = useState(
    pick.alert_minute !== null ? String(pick.alert_minute) : ""
  );
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<TagItem | null>(pick.category);
  const [reason, setReason] = useState(pick.reason ?? "");
  const [sofascoreUrl, setSofascoreUrl] = useState(pick.sofascore_url ?? "");
  const [bookmakerUrl, setBookmakerUrl] = useState(pick.bookmaker_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleTogglePublish() {
    startPublishTransition(async () => {
      await setPickPublished(pick.id, !pick.is_published);
    });
  }

  function addCategory(item: TagItem) {
    setCategories((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]));
  }

  function cancelEdit() {
    setBetType(pick.bet_type);
    setOdd(pick.odd !== null ? String(pick.odd) : "");
    setOddMin(pick.odd_min !== null ? String(pick.odd_min) : "");
    setAlertMinute(pick.alert_minute !== null ? String(pick.alert_minute) : "");
    setCategory(pick.category);
    setReason(pick.reason ?? "");
    setSofascoreUrl(pick.sofascore_url ?? "");
    setBookmakerUrl(pick.bookmaker_url ?? "");
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    setError(null);
    if (!category?.id) {
      setError("Seleciona ou cria o tipo de aposta.");
      return;
    }
    startTransition(async () => {
      try {
        await updatePick({
          pickId: pick.id,
          selection: category.name,
          reason,
          betType,
          odd: odd.trim() ? Number(odd) : null,
          oddMin: oddMin.trim() ? Number(oddMin) : null,
          alertMinute: alertMinute.trim() ? Number(alertMinute) : null,
          sofascoreUrl,
          bookmakerUrl,
          categoryId: category.id,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return (
    <div className={`rounded-lg border-l-4 bg-neutral-950 p-3 ${STATUS_BORDER[pick.status]}`}>
      {editing ? (
        <div className="mb-2 space-y-2">
          <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setBetType("pre_jogo")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                betType === "pre_jogo" ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-white"
              }`}
            >
              Pré-jogo
            </button>
            <button
              type="button"
              onClick={() => setBetType("live")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                betType === "live" ? "bg-sky-600 text-white" : "text-neutral-400 hover:text-white"
              }`}
            >
              Live
            </button>
          </div>
          <div className="flex gap-2">
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
            ) : (
              <>
                <div className="w-20 shrink-0">
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
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {isPending ? "A guardar..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-medium text-emerald-300">
              {pick.bet_type === "live" && (
                <span className="mr-2 inline-flex items-center rounded-full bg-sky-950 px-2 py-0.5 text-[10px] font-semibold text-sky-300 align-middle">
                  LIVE
                </span>
              )}
              {pick.selection}
              {pick.bet_type === "pre_jogo" && pick.odd !== null && (
                <span className="ml-2 text-xs font-normal text-neutral-400">
                  @ {pick.odd.toFixed(2)}
                </span>
              )}
              {pick.bet_type === "live" && pick.odd_min !== null && (
                <span className="ml-2 text-xs font-normal text-neutral-400">
                  entra a partir de {pick.odd_min.toFixed(2)}
                </span>
              )}
              {pick.bet_type === "live" && pick.alert_minute !== null && (
                <span className="ml-2 text-xs font-normal text-amber-400">
                  🔔 min {pick.alert_minute}
                </span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {pick.is_published && (
                <span
                  title="Visível na Comunidade"
                  className="rounded-full bg-violet-950 px-2 py-0.5 text-[10px] font-semibold text-violet-300"
                >
                  📢 Publicado
                </span>
              )}
              <StatusBadge status={pick.status} />
            </div>
          </div>
          {pick.category && pick.category.name !== pick.selection && (
            <p className="mb-1.5 text-xs text-neutral-500">🏷️ {pick.category.name}</p>
          )}
          {pick.reason && <p className="mb-2 text-sm text-neutral-300">{pick.reason}</p>}
          {(pick.sofascore_url || pick.bookmaker_url) && (
            <div className="mb-2 flex flex-wrap gap-3">
              {pick.sofascore_url && (
                <a
                  href={pick.sofascore_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:underline"
                >
                  📊 SofaScore
                </a>
              )}
              {pick.bookmaker_url && (
                <a
                  href={pick.bookmaker_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:underline"
                >
                  🎰 Casa de apostas
                </a>
              )}
            </div>
          )}
          <PickImages pickId={pick.id} images={images} />
          <div className="mb-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Editar aposta
            </button>
            <button
              type="button"
              disabled={isTogglingPublish}
              onClick={handleTogglePublish}
              className={`text-xs disabled:opacity-50 ${
                pick.is_published
                  ? "text-violet-400 hover:text-violet-300"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {isTogglingPublish
                ? "..."
                : pick.is_published
                  ? "Retirar da Comunidade"
                  : "Publicar na Comunidade"}
            </button>
          </div>
        </>
      )}

      {!editing && <StatusButtons pickId={pick.id} status={pick.status} />}
    </div>
  );
}
