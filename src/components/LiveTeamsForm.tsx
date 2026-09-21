"use client";

import { useRef } from "react";

const SELECT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";

// League and the two teams of the game being watched. Picking a league loads
// its teams at once; the teams are used when the button is pressed.
export default function LiveTeamsForm({
  leagues,
  liga,
  teams,
  casa,
  fora,
}: {
  leagues: readonly { code: string; label: string }[];
  liga: string;
  teams: string[];
  casa: string;
  fora: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function changeLeague() {
    const form = formRef.current;
    if (!form) return;
    for (const name of ["casa", "fora"]) {
      const select = form.elements.namedItem(name);
      if (select instanceof HTMLSelectElement) select.value = "";
    }
    form.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      method="get"
      action="/estatisticas/live"
      className="mb-5 space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm"
    >
      <div>
        <label className="mb-1 block text-sm text-neutral-300">Liga (opcional)</label>
        <select name="liga" defaultValue={liga} onChange={changeLeague} className={SELECT}>
          <option value="">Sem liga: usar valores típicos</option>
          {leagues.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {teams.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Equipa da casa</label>
              <select key={`casa-${liga}`} name="casa" defaultValue={casa} className={SELECT}>
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Equipa de fora</label>
              <select key={`fora-${liga}`} name="fora" defaultValue={fora} className={SELECT}>
                <option value="">Escolhe a equipa...</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
          >
            Usar estas equipas
          </button>
        </>
      )}
    </form>
  );
}
