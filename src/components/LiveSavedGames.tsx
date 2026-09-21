"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useNow } from "@/lib/useNow";
import {
  OVER_MINUTES,
  clearGames,
  clockMinute,
  gamesFrom,
  rawSnapshot,
  removeGame,
} from "@/lib/liveStore";

// The games watched in this browser, to pick one up again with a click. Nothing
// opens by itself: coming back to the page shows an empty calculator and this list.
export default function LiveSavedGames() {
  const now = useNow(30_000);
  // Removing a game changes the storage, which nothing announces in this tab.
  const [version, setVersion] = useState(0);
  const raw = useSyncExternalStore(
    (notify) => {
      window.addEventListener("storage", notify);
      return () => window.removeEventListener("storage", notify);
    },
    rawSnapshot,
    () => null
  );

  const games = raw === null ? [] : gamesFrom(raw);

  if (raw === null || games.length === 0) return null;
  void version;

  return (
    <section className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">Jogos que estavas a ver</h2>
        <button
          type="button"
          onClick={() => {
            clearGames();
            setVersion((v) => v + 1);
          }}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          Limpar tudo
        </button>
      </div>
      <ul className="divide-y divide-neutral-800">
        {games.map((g) => {
          const minute = now ? clockMinute(g, now.getTime()) : g.minute;
          const over = g.running && minute >= OVER_MINUTES;
          return (
            <li key={g.key} className="flex items-center justify-between gap-3 py-2">
              <Link href={g.href} className="min-w-0 flex-1 hover:text-amber-300">
                <p className="truncate text-sm font-medium text-neutral-100">
                  {g.home} <span className="text-neutral-500">vs</span> {g.away}
                </p>
                <p className="text-xs text-neutral-400">
                  {g.homeGoals}–{g.awayGoals} · {over ? "provavelmente terminou" : `${minute}'`}
                  {g.running && !over && <span className="ml-1.5 text-amber-400">· minuto a andar</span>}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => {
                  removeGame(g.key);
                  setVersion((v) => v + 1);
                }}
                title="Esquecer este jogo"
                className="rounded p-1 text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-neutral-500">
        Ficam guardados só neste navegador e desaparecem passadas 12 horas.
      </p>
    </section>
  );
}
