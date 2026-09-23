"use client";

import { useState, useTransition } from "react";
import { useNow } from "@/lib/useNow";
import { parseSofascoreId } from "@/lib/sofascore";
import type { LiveGameState } from "@/lib/sportscoreLive";
import { moveKey, sortByOrder, type Move } from "@/lib/widgetOrder";
import { addWatchedMatch, removeWatchedMatch } from "@/app/(app)/actions";
import SofaScoreWidget from "./SofaScoreWidget";

interface WatchedMatch {
  id: string;
  home_team: string;
  away_team: string;
  sofascore_url?: string | null;
}

// The order you arranged the widgets in, as item keys ("w:<id>"). It lives in
// this browser only: the widgets themselves come and go, so it is a layout
// preference, not data.
const ORDER_KEY = "apostas.liveWidgetOrder";

function loadOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function saveOrder(order: string[]): void {
  try {
    if (order.length > 0) window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    else window.localStorage.removeItem(ORDER_KEY);
  } catch {
    // Private mode or blocked storage: the order just isn't remembered.
  }
}

interface Preview {
  home: string;
  away: string;
  state: LiveGameState | null;
}

// Games are added by SofaScore link only: the teams (and the live score)
// come from the event itself, so there is nothing to type or match.
export default function LiveWidgetsPanel({ watched }: { watched: WatchedMatch[] }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [sofaLink, setSofaLink] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Nothing renders until the clock is ready, so reading storage here can
  // never disagree with the server's (empty) output.
  const [order, setOrder] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : loadOrder()
  );

  if (!now) return null;

  const keys = watched.map((w) => `w:${w.id}`);
  const sortedKeys = sortByOrder(keys, order);
  const position = new Map(sortedKeys.map((key, i) => [key, i]));

  // The row fills up with the games: one takes the whole width, two or more
  // share it two per row, so every card stays wide.
  const columns = watched.length >= 2 ? "lg:grid-cols-2" : "";

  function moveWidget(key: string, to: Move) {
    const next = moveKey(sortedKeys, key, to);
    if (!next) return;
    setOrder(next);
    saveOrder(next);
  }

  function resetOrder() {
    setOrder([]);
    saveOrder([]);
  }

  async function resolve(link: string): Promise<Preview | null> {
    const id = parseSofascoreId(link);
    if (id === null) return null;
    try {
      const res = await fetch(`/api/sofascore/event?id=${id}`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = await res.json();
      const state = (body?.state ?? null) as LiveGameState | null;
      if (!state?.homeName || !state?.awayName) return null;
      return { home: state.homeName, away: state.awayName, state };
    } catch {
      return null;
    }
  }

  async function lookup(link: string) {
    if (parseSofascoreId(link) === null) {
      setPreview(null);
      return;
    }
    setLookingUp(true);
    try {
      setPreview(await resolve(link));
    } finally {
      setLookingUp(false);
    }
  }

  function handleAdd() {
    setError(null);
    const id = parseSofascoreId(sofaLink);
    if (id === null) {
      setError("Cola o link do jogo no SofaScore (tem “id:12345678” no fim).");
      return;
    }
    startTransition(async () => {
      try {
        const found = preview && preview.home ? preview : await resolve(sofaLink);
        if (!found?.home) throw new Error("Não consegui ler as equipas (scraper desligado?). Tenta de novo.");
        await addWatchedMatch(found.home, found.away, null, null, sofaLink);
        setSofaLink("");
        setPreview(null);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível adicionar.");
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      await removeWatchedMatch(id);
    });
  }

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-sky-400">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Ao vivo agora
        </h2>
        <div className="flex items-center gap-3">
          {order.length > 0 && (
            <button
              type="button"
              onClick={resetOrder}
              className="text-xs text-neutral-500 hover:text-neutral-300 hover:underline"
            >
              Repor ordem
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium text-sky-400 hover:underline"
          >
            {open ? "Cancelar" : "+ Adicionar jogo"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <label className="mb-1 block text-sm text-neutral-300">Link do jogo no SofaScore</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={sofaLink}
              onChange={(e) => {
                setSofaLink(e.target.value);
                setError(null);
                void lookup(e.target.value);
              }}
              placeholder="https://www.sofascore.com/.../id:12345678"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-sky-500"
            />
            <button
              type="button"
              disabled={isPending || lookingUp || parseSofascoreId(sofaLink) === null}
              onClick={handleAdd}
              className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
            >
              {isPending ? "A adicionar..." : "Adicionar"}
            </button>
          </div>
          {lookingUp && <p className="mt-2 text-xs text-neutral-500">A ler o jogo…</p>}
          {preview && (preview.home || preview.away) && (
            <p className="mt-2 text-xs text-neutral-300">
              {preview.home} <span className="text-neutral-500">vs</span> {preview.away}
              {preview.state && preview.state.homeGoals !== null && preview.state.awayGoals !== null && (
                <span className="ml-2 font-semibold text-neutral-100">
                  {preview.state.homeGoals}–{preview.state.awayGoals}
                  {preview.state.phase === "live" && preview.state.minute !== null && ` · ${preview.state.minute}'`}
                  {preview.state.phase === "halftime" && " · Intervalo"}
                  {preview.state.phase === "finished" && " · Terminado"}
                </span>
              )}
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      )}

      {watched.length > 0 && (
        // Each widget keeps its place in the DOM and is only moved with CSS
        // `order`: moving an iframe in the DOM would reload it.
        <div className={`grid grid-cols-1 gap-4 ${columns}`}>
          {watched.map((w) => {
            const key = `w:${w.id}`;
            const pos = position.get(key) ?? 0;
            const eventId = w.sofascore_url ? parseSofascoreId(w.sofascore_url) : null;
            return (
              <div key={key} style={{ order: pos }}>
                <div className="mb-1.5 flex items-center justify-between">
                  {watched.length > 1 ? (
                    <div className="flex overflow-hidden rounded-full border border-neutral-800 bg-neutral-900 text-sm text-neutral-400">
                      <button
                        type="button"
                        disabled={pos === 0}
                        onClick={() => moveWidget(key, "first")}
                        title="Pôr em primeiro"
                        className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                      >
                        «
                      </button>
                      <button
                        type="button"
                        disabled={pos === 0}
                        onClick={() => moveWidget(key, "earlier")}
                        title="Mover para trás"
                        className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        disabled={pos === watched.length - 1}
                        onClick={() => moveWidget(key, "later")}
                        title="Mover para a frente"
                        className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                      >
                        ›
                      </button>
                    </div>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleRemove(w.id)}
                    title="Remover"
                    className="rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:bg-red-950 hover:text-red-300 disabled:opacity-50"
                  >
                    Remover ✕
                  </button>
                </div>
                {eventId !== null ? (
                  <SofaScoreWidget eventId={eventId} home={w.home_team} away={w.away_team} />
                ) : (
                  <div className="w-full rounded-xl border border-dashed border-neutral-800 bg-neutral-900 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-neutral-200">
                      {w.home_team} <span className="text-neutral-500">vs</span> {w.away_team}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
