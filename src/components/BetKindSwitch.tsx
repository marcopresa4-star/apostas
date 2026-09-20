"use client";

import { useState, type ReactNode } from "react";

const ACCENT = {
  emerald: "bg-emerald-600",
  sky: "bg-sky-600",
} as const;

// "Aposta simples | Múltipla" at the top of the new-bet pages. Both forms stay
// mounted and the other one is only hidden, so switching back and forth never
// loses what was already typed.
export default function BetKindSwitch({
  accent,
  simple,
  multiple,
  multipleHint,
}: {
  accent: keyof typeof ACCENT;
  simple: ReactNode;
  multiple: ReactNode;
  multipleHint: string;
}) {
  const [kind, setKind] = useState<"simple" | "multiple">("simple");

  const tab = (value: "simple" | "multiple", label: string) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      className={`rounded-md px-3 py-1.5 font-medium transition ${
        kind === value ? `${ACCENT[accent]} text-white` : "text-neutral-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-0.5 text-sm">
        {tab("simple", "Aposta simples")}
        {tab("multiple", "Múltipla")}
      </div>

      <div className={kind === "simple" ? "" : "hidden"}>{simple}</div>
      <div className={kind === "multiple" ? "" : "hidden"}>
        <p className="mb-4 text-sm text-neutral-500">{multipleHint}</p>
        {multiple}
      </div>
    </div>
  );
}
