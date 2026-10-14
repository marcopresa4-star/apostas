"use client";

import { useEffect, useState } from "react";

interface LineupPlayer {
  name: string;
  num: number | null;
  captain: boolean;
  sub: boolean;
}

interface LineupSide {
  formation: string;
  players: LineupPlayer[];
}

// Pitch with the XI dotted by formation line (no coordinates in the feed:
// lines come from "4-3-3", players in listed order). Shared shape with the
// lineups endpoint.
function Pitch({
  side,
  team,
  color,
}: {
  side: LineupSide;
  team: string;
  color: string;
}) {
  const starters = side.players.filter((p) => !p.sub).slice(0, 11);
  const parts = side.formation
    .split("-")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 10);
  // Lines from the goal out: goalkeeper, then formation lines reversed
  // (attack on top).
  const lines: LineupPlayer[][] = [];
  const pool = [...starters];
  const keeper = pool.shift();
  if (keeper) lines.push([keeper]);
  if (parts.length > 0) {
    const reversed = [...parts].reverse();
    for (let li = 0; li < reversed.length; li++) {
      // Last line takes leftovers (data sometimes lists 10 or 12).
      const want = li === reversed.length - 1 ? pool.length : Math.min(reversed[li], pool.length);
      const take = pool.splice(0, Math.max(want, 0));
      if (take.length > 0) lines.push(take);
    }
    if (pool.length > 0) lines[lines.length - 1].push(...pool);
  } else {
    while (pool.length > 0) {
      const last = lines[lines.length - 1];
      if (last && last.length < 5) last.push(pool.shift()!);
      else lines.push([pool.shift()!]);
    }
  }
  const W = 300;
  const H = 340;
  const yFor = (li: number): number => {
    if (lines.length === 1) return H * 0.5;
    return H * 0.9 - (li / (lines.length - 1)) * H * 0.68;
  };
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 truncate text-center text-xs font-semibold text-neutral-200">
        {team} <span className="font-normal text-neutral-500">{side.formation}</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg" role="img" aria-label={`Onze de ${team}`}>
        <defs>
          <linearGradient id={`pp-${team}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#166534" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill={`url(#pp-${team})`} />
        <g stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" fill="none">
          <rect x="8" y="8" width={W - 16} height={H - 16} />
          <line x1="8" y1={H / 2} x2={W - 8} y2={H / 2} />
          <circle cx={W / 2} cy={H / 2} r="34" />
          <rect x={W / 2 - 55} y="8" width="110" height="42" />
          <rect x={W / 2 - 55} y={H - 50} width="110" height="42" />
        </g>
        {lines.map((line, li) =>
          line.map((p, i) => {
            const cx = line.length === 1 ? W / 2 : ((i + 1) / (line.length + 1)) * W;
            const cy = yFor(li);
            return (
              <g key={`${p.name}-${p.num ?? i}`}>
                <title>{`${p.num !== null ? `#${p.num} ` : ""}${p.name}${p.captain ? " (C)" : ""}`}</title>
                <circle
                  cx={cx}
                  cy={cy}
                  r="13"
                  fill={color}
                  stroke={p.captain ? "#34d399" : "#0a0a0a"}
                  strokeWidth={p.captain ? 2.5 : 1.5}
                />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
                  {p.num ?? "–"}
                </text>
                <text x={cx} y={cy + 26} textAnchor="middle" fontSize="9" fill="#e5e5e5">
                  {(p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name) + (p.captain ? " (C)" : "")}
                </text>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

export default function PinnedLineups({
  eventId,
  homeName,
  awayName,
}: {
  eventId: number;
  homeName: string;
  awayName: string;
}) {
  const [sides, setSides] = useState<{ home: LineupSide | null; away: LineupSide | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch(`/api/sofascore/lineups?id=${eventId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { home?: LineupSide | null; away?: LineupSide | null } | null) => {
        if (stop) return;
        if (body && (body.home || body.away)) setSides({ home: body.home ?? null, away: body.away ?? null });
        else setFailed(true);
      })
      .catch(() => {
        if (!stop) setFailed(true);
      });
    return () => {
      stop = true;
    };
  }, [eventId]);

  if (failed) return <p className="mt-2 text-[11px] text-neutral-500">Sem onzes para este jogo.</p>;
  if (!sides) return <p className="mt-2 text-[11px] text-neutral-500">A ler os onzes…</p>;
  return (
    <div className="mt-2 border-t border-neutral-800 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        {sides.home ? (
          <Pitch side={sides.home} team={homeName} color="#0284c7" />
        ) : (
          <p className="flex-1 text-center text-[11px] text-neutral-500">Sem onze da casa.</p>
        )}
        {sides.away ? (
          <Pitch side={sides.away} team={awayName} color="#c2410c" />
        ) : (
          <p className="flex-1 text-center text-[11px] text-neutral-500">Sem onze de fora.</p>
        )}
      </div>
    </div>
  );
}
