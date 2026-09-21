"use client";

import { useRef } from "react";

// The league box of the pages that work on a whole league: choosing one loads
// the page for it at once. `keep` are other parameters to carry along.
export default function LeaguePicker({
  leagues,
  liga,
  action,
  keep = {},
}: {
  leagues: readonly { code: string; label: string }[];
  liga: string;
  action: string;
  keep?: Record<string, string>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} method="get" action={action} className="mb-5 max-w-md">
      <label className="mb-1 block text-sm text-neutral-300">Liga</label>
      <select
        name="liga"
        defaultValue={liga}
        onChange={() => formRef.current?.requestSubmit()}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500"
      >
        <option value="">Escolhe a liga...</option>
        {leagues.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </form>
  );
}
