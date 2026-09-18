"use client";

export type LiveMode = "watching" | "active";

// Shared by every form that creates a live pick: is it an idea you are only
// watching, or a bet you already entered (which then needs the real odd)?
export default function LiveModeToggle({
  value,
  onChange,
  small = false,
}: {
  value: LiveMode;
  onChange: (mode: LiveMode) => void;
  small?: boolean;
}) {
  const size = small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-0.5">
      <button
        type="button"
        onClick={() => onChange("watching")}
        className={`rounded-md font-medium transition ${size} ${
          value === "watching" ? "bg-amber-600 text-white" : "text-neutral-400 hover:text-white"
        }`}
      >
        👀 A vigiar
      </button>
      <button
        type="button"
        onClick={() => onChange("active")}
        className={`rounded-md font-medium transition ${size} ${
          value === "active" ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-white"
        }`}
      >
        ✅ Já entrei
      </button>
    </div>
  );
}
