"use client";

import { useState, useTransition } from "react";
import { useNow } from "@/lib/useNow";
import { isMatchLive } from "@/lib/matchStatus";
import { moveKey, sortByOrder, type Move } from "@/lib/widgetOrder";
import { addWatchedMatch, removeWatchedMatch, createTeam } from "@/app/(app)/actions";
import SportscoreWidget from "./SportscoreWidget";
import EntityCombobox, { type ComboCountry, type ComboItem } from "./EntityCombobox";

interface Ticket {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  home_team: { name: string; aliases?: string | null } | null;
  away_team: { name: string; aliases?: string | null } | null;
}

// teams.aliases holds other names of a club separated by " | ".
function splitAliases(aliases: string | null | undefined): string[] {
  return aliases ? aliases.split("|").map((a) => a.trim()).filter(Boolean) : [];
}

interface WatchedMatch {
  id: string;
  home_team: string;
  away_team: string;
  home_aliases?: string | null;
  away_aliases?: string | null;
}

// The order you arranged the widgets in, as item keys ("t:<ticket id>" for a
// game from your bets, "w:<id>" for one you added by hand). It lives in this
// browser only: the widgets themselves come and go with the kickoff clock, so
// it is a layout preference, not data.
const ORDER_KEY = "apostas.liveWidgetOrder";

function loadOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function saveOrder(order: string[]) {
  try {
    if (order.length > 0) window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    else window.localStorage.removeItem(ORDER_KEY);
  } catch {
    // Private mode or blocked storage: the order just isn't remembered.
  }
}

type Item =
  | { key: string; kind: "ticket"; ticket: Ticket }
  | { key: string; kind: "watched"; watched: WatchedMatch };

// Computes "which matches are live" on the client, ticking every second —
// mirrors the same heuristic CompactTicketList uses for its "Em direto"
// badges, so this panel never drifts out of sync with them (a server-only
// snapshot would go stale the moment a match crosses into its live window
// without a full page reload).
export default function LiveWidgetsPanel({
  tickets,
  watched,
  countries,
  initialTeams,
}: {
  tickets: Ticket[];
  watched: WatchedMatch[];
  countries: ComboCountry[];
  initialTeams: ComboItem[];
}) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState(initialTeams);
  const [homeTeam, setHomeTeam] = useState<ComboItem | null>(null);
  const [awayTeam, setAwayTeam] = useState<ComboItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Nothing renders until the clock is ready, so reading storage here can
  // never disagree with the server's (empty) output.
  const [order, setOrder] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : loadOrder()
  );

  if (!now) return null;

  const liveTickets = tickets.filter(
    (t) => !t.live_ended && isMatchLive(t.match_date, t.match_time, now)
  );
  const hasAny = liveTickets.length > 0 || watched.length > 0;

  const items: Item[] = [
    ...liveTickets.map((ticket): Item => ({ key: `t:${ticket.id}`, kind: "ticket", ticket })),
    ...watched.map((w): Item => ({ key: `w:${w.id}`, kind: "watched", watched: w })),
  ];
  const sortedKeys = sortByOrder(
    items.map((item) => item.key),
    order
  );
  const position = new Map(sortedKeys.map((key, i) => [key, i]));

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

  function addTeam(item: ComboItem) {
    setTeams((prev) => (prev.some((t) => t.id === item.id) ? prev : [...prev, item]));
  }

  function handleAdd() {
    setError(null);
    if (!homeTeam?.id || !awayTeam?.id) {
      setError("Escolhe as duas equipas da lista, ou cria a que falta.");
      return;
    }
    if (homeTeam.id === awayTeam.id) {
      setError("A equipa da casa e a de fora têm de ser diferentes.");
      return;
    }
    startTransition(async () => {
      try {
        await addWatchedMatch(
          homeTeam.name,
          awayTeam.name,
          homeTeam.aliases ?? null,
          awayTeam.aliases ?? null
        );
        setHomeTeam(null);
        setAwayTeam(null);
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

      {/* z-20 on the form keeps the suggestion menus above the widgets' own
          controls (z-10). */}
      {open && (
        <div className="relative z-20 mb-4 flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <EntityCombobox
              label="Equipa da casa"
              placeholder="Ex: Real Madrid"
              createLabel="Criar equipa"
              searchTable="teams"
              items={teams}
              countries={countries}
              value={homeTeam}
              onSelect={setHomeTeam}
              createAction={createTeam}
              onCreated={addTeam}
            />
          </div>
          <div className="flex-1">
            <EntityCombobox
              label="Equipa de fora"
              placeholder="Ex: Barcelona"
              createLabel="Criar equipa"
              searchTable="teams"
              items={teams}
              countries={countries}
              value={awayTeam}
              onSelect={setAwayTeam}
              createAction={createTeam}
              onCreated={addTeam}
            />
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleAdd}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
          >
            {isPending ? "A adicionar..." : "Adicionar"}
          </button>
          {error && <p className="text-xs text-red-400 sm:w-full">{error}</p>}
        </div>
      )}

      {hasAny && (
        // Each widget keeps its place in the DOM and is only moved with CSS
        // `order`: moving an iframe in the DOM would reload it.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const pos = position.get(item.key) ?? 0;
            return (
              <div key={item.key} style={{ order: pos }} className="relative">
                {item.kind === "ticket" ? (
                  <SportscoreWidget
                    homeTeam={item.ticket.home_team?.name ?? ""}
                    awayTeam={item.ticket.away_team?.name ?? ""}
                    homeAliases={splitAliases(item.ticket.home_team?.aliases)}
                    awayAliases={splitAliases(item.ticket.away_team?.aliases)}
                  />
                ) : (
                  <>
                    <SportscoreWidget
                      homeTeam={item.watched.home_team}
                      awayTeam={item.watched.away_team}
                      homeAliases={splitAliases(item.watched.home_aliases)}
                      awayAliases={splitAliases(item.watched.away_aliases)}
                    />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRemove(item.watched.id)}
                      title="Remover"
                      className="absolute right-2 top-2 z-10 rounded-full bg-neutral-900/80 p-1.5 text-neutral-400 backdrop-blur transition hover:bg-red-950 hover:text-red-300 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </>
                )}
                {items.length > 1 && (
                  <div className="absolute left-2 top-2 z-10 flex overflow-hidden rounded-full bg-neutral-900/80 text-sm text-neutral-400 backdrop-blur">
                    <button
                      type="button"
                      disabled={pos === 0}
                      onClick={() => moveWidget(item.key, "first")}
                      title="Pôr em primeiro"
                      className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                    >
                      «
                    </button>
                    <button
                      type="button"
                      disabled={pos === 0}
                      onClick={() => moveWidget(item.key, "earlier")}
                      title="Mover para trás"
                      className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      disabled={pos === items.length - 1}
                      onClick={() => moveWidget(item.key, "later")}
                      title="Mover para a frente"
                      className="px-2 py-1 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                    >
                      ›
                    </button>
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
