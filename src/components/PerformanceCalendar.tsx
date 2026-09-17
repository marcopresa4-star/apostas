"use client";

import { useState } from "react";

interface DayStat {
  green: number;
  red: number;
}

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

function cellStyle(stat: DayStat | undefined) {
  const total = stat ? stat.green + stat.red : 0;
  if (total === 0) {
    return "border-neutral-800 bg-neutral-950 text-neutral-600";
  }
  if (stat!.green > stat!.red) return "border-emerald-700 bg-emerald-950 text-neutral-100";
  if (stat!.red > stat!.green) return "border-red-700 bg-red-950 text-neutral-100";
  return "border-neutral-700 bg-neutral-800 text-neutral-100";
}

export default function PerformanceCalendar({
  dayStats,
}: {
  dayStats: Record<string, DayStat>;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-lg px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold text-neutral-300">
          {MONTHS[viewMonth]} {viewYear}
        </h3>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-lg px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-500">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <span key={`blank-${idx}`} />;
          const iso = toISODate(viewYear, viewMonth, day);
          const stat = dayStats[iso];
          const total = stat ? stat.green + stat.red : 0;
          return (
            <div
              key={iso}
              title={total > 0 ? `${stat!.green} Green · ${stat!.red} Red` : undefined}
              className={`flex flex-col items-center justify-center rounded-lg border py-1.5 text-[11px] ${cellStyle(stat)}`}
            >
              <span className="font-medium">{day}</span>
              {total > 0 && (
                <span className="text-[9px] leading-tight">
                  <span className="text-emerald-400">{stat!.green}G</span>{" "}
                  <span className="text-red-400">{stat!.red}R</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
