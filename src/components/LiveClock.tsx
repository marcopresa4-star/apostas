"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export default function LiveClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    function update() {
      setTime(formatter.format(new Date()));
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  if (!time) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-sm tabular-nums text-neutral-200">
      <span aria-hidden>🕐</span>
      <span>{time}</span>
      <span className="text-xs text-neutral-500">PT</span>
    </div>
  );
}
