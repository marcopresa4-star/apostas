"use client";

import { useEffect, useRef, useState } from "react";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function toISODate(year: number, month: number, day: number) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseISODate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

export default function DatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const today = new Date();
  const parsed = parseISODate(value);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function openPicker() {
    const p = parseISODate(value);
    setViewYear(p?.year ?? today.getFullYear());
    setViewMonth(p?.month ?? today.getMonth());
    setOpen(true);
  }

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const displayText = parsed
    ? `${String(parsed.day).padStart(2, "0")}/${String(parsed.month + 1).padStart(2, "0")}/${parsed.year}`
    : "";

  return (
    <div className="relative" ref={containerRef}>
      <label className="mb-1 block text-sm text-neutral-300">{label}</label>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left text-neutral-100 outline-none focus:border-emerald-500"
      >
        <span className={displayText ? "" : "text-neutral-500"}>
          {displayText || "Escolher data"}
        </span>
        <span aria-hidden className="text-neutral-500">
          📅
        </span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-72 max-w-[calc(100vw-2.5rem)] rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="rounded-lg px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-neutral-100">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="rounded-lg px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-neutral-500">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (day === null) return <span key={`blank-${idx}`} />;
              const iso = toISODate(viewYear, viewMonth, day);
              const isSelected = iso === value;
              const isToday =
                day === today.getDate() &&
                viewMonth === today.getMonth() &&
                viewYear === today.getFullYear();
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`rounded-lg py-1.5 text-sm transition ${
                    isSelected
                      ? "bg-emerald-600 text-white"
                      : isToday
                        ? "bg-neutral-800 text-emerald-400"
                        : "text-neutral-200 hover:bg-neutral-800"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              const iso = toISODate(today.getFullYear(), today.getMonth(), today.getDate());
              onChange(iso);
              setViewYear(today.getFullYear());
              setViewMonth(today.getMonth());
              setOpen(false);
            }}
            className="mt-2 w-full rounded-lg px-2 py-1.5 text-sm text-emerald-400 hover:bg-neutral-800"
          >
            Hoje
          </button>
        </div>
      )}
    </div>
  );
}
