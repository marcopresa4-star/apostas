"use client";

import { useState } from "react";
import CompactTicketList from "./CompactTicketList";
import MultipleCard from "./MultipleCard";
import { formatCount } from "@/lib/betResult";
import type { PickImageItem } from "./PickImages";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";
import type { MultipleRow } from "@/lib/multiples";

interface DayStat {
  green: number;
  red: number;
}

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
  bet_type: BetType;
  stage: PickStage;
  odd: number | null;
  odd_min: number | null;
  entry_odd: number | null;
  sofascore_url?: string | null;
  bookmaker_url?: string | null;
  is_published?: boolean;
}

interface DayTicket {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  competition: { name: string } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: Pick[];
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

function cellStyle(stat: DayStat | undefined, hasTickets: boolean, isSelected: boolean) {
  const total = stat ? stat.green + stat.red : 0;
  let base: string;
  if (total === 0) {
    base = "border-neutral-800 bg-neutral-950 text-neutral-600";
  } else if (stat!.green > stat!.red) {
    base = "border-emerald-700 bg-emerald-950 text-neutral-100";
  } else if (stat!.red > stat!.green) {
    base = "border-red-700 bg-red-950 text-neutral-100";
  } else {
    base = "border-neutral-700 bg-neutral-800 text-neutral-100";
  }
  if (isSelected) base += " ring-2 ring-sky-400";
  if (hasTickets) base += " cursor-pointer hover:brightness-125";
  return base;
}

export default function PerformanceCalendar({
  dayStats,
  ticketsByDay,
  multiplesByDay = {},
  imagesByPick = {},
  readOnly = false,
}: {
  dayStats: Record<string, DayStat>;
  ticketsByDay: Record<string, DayTicket[]>;
  multiplesByDay?: Record<string, MultipleRow[]>;
  imagesByPick?: Record<string, PickImageItem[]>;
  readOnly?: boolean;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  function prevMonth() {
    setSelected(null);
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    setSelected(null);
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

  const selectedTickets = selected ? (ticketsByDay[selected] ?? []) : [];
  const selectedMultiples = selected ? (multiplesByDay[selected] ?? []) : [];

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
          const hasTickets =
            (ticketsByDay[iso] ?? []).length > 0 || (multiplesByDay[iso] ?? []).length > 0;
          return (
            <button
              key={iso}
              type="button"
              disabled={!hasTickets}
              onClick={() => setSelected((prev) => (prev === iso ? null : iso))}
              title={
                total > 0
                  ? `${formatCount(stat!.green)} Green · ${formatCount(stat!.red)} Red`
                  : undefined
              }
              className={`flex flex-col items-center justify-center rounded-lg border py-1.5 text-[11px] transition ${cellStyle(stat, hasTickets, selected === iso)}`}
            >
              <span className="font-medium">{day}</span>
              {total > 0 && (
                <span className="text-[9px] leading-tight">
                  <span className="text-emerald-400">{formatCount(stat!.green)}G</span>{" "}
                  <span className="text-red-400">{formatCount(stat!.red)}R</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-200">
              {new Date(`${selected}T00:00:00`).toLocaleDateString("pt-PT", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-neutral-500 hover:text-white"
            >
              Fechar ✕
            </button>
          </div>
          {selectedTickets.length === 0 && selectedMultiples.length === 0 ? (
            <p className="text-sm text-neutral-500">Sem apostas neste dia.</p>
          ) : (
            <div className="space-y-3">
              {selectedMultiples.map((multiple) => (
                <MultipleCard key={multiple.id} multiple={multiple} readOnly />
              ))}
              {selectedTickets.length > 0 && (
                <CompactTicketList
                  tickets={selectedTickets}
                  imagesByPick={imagesByPick}
                  readOnly={readOnly}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
