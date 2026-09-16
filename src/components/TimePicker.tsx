"use client";

import { useEffect, useRef, useState } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function Segment({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-center text-neutral-100 outline-none focus:border-emerald-500"
      >
        {value || "--"}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-48 w-16 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-neutral-800 ${
                opt === value ? "bg-emerald-600 text-white" : "text-neutral-200"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value ? value.split(":") : ["", ""];

  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-300">{label}</label>
      <div className="flex items-center gap-2">
        <Segment options={HOURS} value={hour} onChange={(h) => onChange(`${h}:${minute || "00"}`)} />
        <span className="text-neutral-500">:</span>
        <Segment options={MINUTES} value={minute} onChange={(m) => onChange(`${hour || "00"}:${m}`)} />
      </div>
    </div>
  );
}
