"use client";

import { useEffect, useRef } from "react";

// Logs the shown suggestion once per game for continuous calibration (the
// Calibração tab settles it when the result arrives). Fire-and-forget: a
// failed beacon never disturbs the report.
export default function CalibrationLogger({
  league,
  home,
  away,
  gameDate,
  picks,
}: {
  league: string;
  home: string;
  away: string;
  gameDate: string;
  picks: { key: string; group: string; label: string; p: number; base: number; fair: number }[];
}) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const id = `${league}|${home}|${away}|${gameDate}`;
    if (sent.current === id || picks.length === 0) return;
    sent.current = id;
    fetch("/api/calibration/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ league, home, away, match_date: gameDate, picks }),
    }).catch(() => {});
  }, [league, home, away, gameDate, picks]);
  return null;
}
