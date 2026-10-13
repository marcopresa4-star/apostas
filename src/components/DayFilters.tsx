"use client";

import { useRef, useState } from "react";

// Filter bar for the day board: selects submit on change, the team search on
// Enter/button. Plain GET, so filtered views stay linkable. The selects stay
// uncontrolled (the submitted values always come from the DOM); only the
// country is mirrored to state to narrow the league list (key remount resets
// the league choice when it changes).
export default function DayFilters({
  day,
  countries,
  leagues,
  initial,
}: {
  day: string;
  countries: string[];
  leagues: { code: string; label: string; country: string }[];
  initial: { pais: string; liga: string; equipa: string; diretos: string; matriz: string };
}) {
  const [pais, setPais] = useState(initial.pais);
  const [diretos, setDiretos] = useState(initial.diretos === "1" ? "1" : "0");
  const [matriz, setMatriz] = useState(initial.matriz === "1" ? "1" : "0");
  const formRef = useRef<HTMLFormElement>(null);
  const field =
    "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500";
  const visibleLeagues = leagues.filter((l) => pais === "" || l.country === pais);
  return (
    <form
      ref={formRef}
      method="get"
      action="/estatisticas/jogos-dia"
      onChange={(e) => {
        // The league select applies at once; the team box waits for Enter.
        // The country select submits deferred (below), after its league reset.
        if (e.target instanceof HTMLSelectElement && e.target.name === "liga") e.currentTarget.requestSubmit();
      }}
      className="mb-4 flex max-w-4xl flex-wrap items-center gap-2"
    >
      <input type="hidden" name="data" value={day} />
      <input type="hidden" name="diretos" value={diretos} />
      <input type="hidden" name="matriz" value={matriz} />
      <span className="flex overflow-hidden rounded-lg border border-neutral-700">
        <button
          type="button"
          onClick={() => {
            setDiretos("0");
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          title="Todos os jogos do dia"
          className={`px-3 py-1.5 text-sm transition ${diretos === "0" ? "bg-emerald-600 font-medium text-white" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"}`}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => {
            setDiretos("1");
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          title="Só jogos a decorrer"
          className={`px-3 py-1.5 text-sm transition ${diretos === "1" ? "bg-red-600 font-medium text-white" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"}`}
        >
          ● Em direto
        </button>
      </span>
      <span className="flex overflow-hidden rounded-lg border border-neutral-700">
        <button
          type="button"
          onClick={() => {
            setMatriz("0");
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          title="Lista de jogos"
          className={`px-3 py-1.5 text-sm transition ${matriz === "0" ? "bg-emerald-600 font-medium text-white" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"}`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => {
            setMatriz("1");
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          title="Matriz de probabilidades por jogo (carrega os históricos: demora)"
          className={`px-3 py-1.5 text-sm transition ${matriz === "1" ? "bg-emerald-600 font-medium text-white" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"}`}
        >
          Matriz
        </button>
      </span>
      <select
        name="pais"
        defaultValue={initial.pais}
        onChange={(e) => {
          setPais(e.target.value);
          // Let the league select remount empty first, then submit with it.
          setTimeout(() => formRef.current?.requestSubmit(), 0);
        }}
        className={field}
      >
        <option value="">Todos os países</option>
        {countries.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select key={pais} name="liga" defaultValue={pais === initial.pais ? initial.liga : ""} className={field}>
        <option value="">Todas as ligas</option>
        {visibleLeagues.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <input
        type="search"
        name="equipa"
        defaultValue={initial.equipa}
        placeholder="Filtrar por equipa…"
        className={`${field} w-56 max-w-full placeholder:text-neutral-600`}
      />
      <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
        Filtrar
      </button>
    </form>
  );
}
