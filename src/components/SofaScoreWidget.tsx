"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { LiveGameState } from "@/lib/sportscoreLive";

interface MomentumPoint {
  minute: number;
  value: number;
}

interface Incident {
  minute: number;
  kind: "goal" | "red" | "yellow" | "sub" | "info";
  home: boolean;
  text: string;
}

// Shots and xG per 15-minute block, from the same shotmap feed as the xG
// race: who pressed when. Goal blocks get a ⚽, the count on each bar is the
// shots in the block.
function PressureChart({ shots, home, away }: { shots: XgShot[]; home: string; away: string }) {
  const W = 640;
  const H = 150;
  const PAD = 28;
  if (shots.length === 0) return null;
  const BLOCKS = [0, 15, 30, 45, 60, 75];
  const rows = BLOCKS.map((start) => {
    const inBlock = shots.filter((s) => s.minute >= start && (start === 75 ? s.minute <= 130 : s.minute < start + 15));
    const of = (isHome: boolean) => {
      const own = inBlock.filter((s) => s.home === isHome);
      return {
        shots: own.length,
        xg: own.reduce((n, s) => n + s.xg, 0),
        goals: own.filter((s) => s.goal).length,
      };
    };
    return { start, home: of(true), away: of(false) };
  });
  const top = Math.max(0.5, ...rows.flatMap((r) => [r.home.xg, r.away.xg]));
  const slot = (W - PAD * 2) / BLOCKS.length;
  const barW = Math.min(34, slot / 2 - 6);
  const y = (v: number) => H - PAD - (v / top) * (H - PAD * 2 - 18);
  const label = (start: number) => (start === 75 ? "75'+ " : `${start}–${start + 15}'`);
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-sky-300">{home}</span>
        <span className="text-neutral-500">Pressão (remates e xG por 15&apos;)</span>
        <span className="font-medium text-red-300">{away}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Pressão de ${home} contra ${away} por período`}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD} y1={y(top * f)} x2={W - PAD} y2={y(top * f)} stroke="#262626" strokeWidth="1" />
        ))}
        {rows.map((r, i) => {
          const cx = PAD + slot * i + slot / 2;
          return (
            <g key={r.start}>
              {r.home.xg > 0 && (
                <rect x={cx - barW - 2} y={y(r.home.xg)} width={barW} height={Math.max(1.5, H - PAD - y(r.home.xg))} rx="2" fill="#38bdf8" opacity="0.85" />
              )}
              {r.away.xg > 0 && (
                <rect x={cx + 2} y={y(r.away.xg)} width={barW} height={Math.max(1.5, H - PAD - y(r.away.xg))} rx="2" fill="#f87171" opacity="0.85" />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="#737373">
                {label(r.start)}
              </text>
              {(r.home.goals > 0 || r.away.goals > 0) && (
                <text x={cx} y={12} textAnchor="middle" fontSize="11">
                  ⚽{r.home.goals + r.away.goals > 1 ? r.home.goals + r.away.goals : ""}
                </text>
              )}
              {(r.home.shots > 0 || r.away.shots > 0) && (
                <text x={cx} y={y(Math.max(r.home.xg, r.away.xg)) - 4} textAnchor="middle" fontSize="9" fill="#a3a3a3">
                  {r.home.shots + r.away.shots} rem.
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface StatRow {
  name: string;
  home: string;
  away: string;
}

// Goal/red/kickoff/full-time alerts (sound + browser notification) for the
// watched games. Toggled in the panel header, stored in this browser; each
// widget reads it when its minute poll brings news.
export const ALERTS_KEY = "apostas:alerts";

export function alertsOn(): boolean {
  try {
    return window.localStorage.getItem(ALERTS_KEY) === "1";
  } catch {
    return false;
  }
}

function beep(high: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = high ? [660, 880] : [440];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    // No audio: the notification (if permitted) still fires.
  }
}

function alertUser(title: string, body: string, high: boolean): void {
  beep(high);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    // Notifications blocked: the beep already fired.
  }
}

interface LineupPlayer {
  name: string;
  pos: string;
  num: number | null;
  rating: number | null;
  goals: number;
  xg: number;
  minutes: number;
  captain: boolean;
  sub: boolean;
}

interface LineupSide {
  formation: string;
  players: LineupPlayer[];
}

// Starting XIs with live ratings (collapsed: the widget is long enough).
// Rating chip: green 7+, amber 6+, red below. Goals and xG next to the name,
// used subs ("▲") and missing players as footnotes.
function Lineups({
  home,
  away,
  homeName,
  awayName,
  missing,
}: {
  home: LineupSide;
  away: LineupSide;
  homeName: string;
  awayName: string;
  missing: { name: string; home: boolean }[];
}) {
  const chip = (r: number | null): string =>
    r === null
      ? "bg-neutral-800 text-neutral-500"
      : r >= 7
        ? "bg-emerald-600/20 text-emerald-300"
        : r >= 6
          ? "bg-amber-600/20 text-amber-300"
          : "bg-red-600/20 text-red-300";
  const column = (side: LineupSide, team: string, color: string) => {
    const starters = side.players.filter((p) => !p.sub);
    const used = side.players.filter((p) => p.sub && p.minutes > 0);
    return (
      <div className="min-w-0 flex-1">
        <p className={`mb-1.5 truncate text-xs font-medium ${color}`}>
          {team} {side.formation && <span className="font-normal text-neutral-500">· {side.formation}</span>}
        </p>
        <ul className="space-y-1">
          {starters.map((p) => (
            <li key={p.name} className="flex items-center gap-1.5 text-xs">
              <span className={`w-7 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${chip(p.rating)}`}>
                {p.rating !== null ? p.rating.toFixed(1).replace(".", ",") : "–"}
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-200">
                {p.num !== null && <span className="mr-1 text-neutral-600">{p.num}</span>}
                {p.name}
                {p.captain && <span className="ml-1 text-[10px] text-amber-400">C</span>}
                {p.goals > 0 && <span className="ml-1 text-[10px]">⚽{p.goals > 1 ? p.goals : ""}</span>}
              </span>
              {p.xg >= 0.15 && (
                <span className="shrink-0 text-[10px] text-neutral-500">xG {p.xg.toFixed(2).replace(".", ",")}</span>
              )}
            </li>
          ))}
        </ul>
        {used.length > 0 && (
          <p className="mt-1.5 truncate text-[11px] text-neutral-500">
            <span className="text-emerald-400">▲</span> {used.map((p) => p.name).join(", ")}
          </p>
        )}
      </div>
    );
  };
  const missingHome = missing.filter((m) => m.home).map((m) => m.name);
  const missingAway = missing.filter((m) => !m.home).map((m) => m.name);
  return (
    <details className="border-t border-neutral-800 px-4 py-2.5">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300">
        Onzes e notas
      </summary>
      <div className="mt-2 flex gap-4">
        {column(home, homeName, "text-sky-300")}
        {column(away, awayName, "text-red-300")}
      </div>
      {(missingHome.length > 0 || missingAway.length > 0) && (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Ausentes:{" "}
          {[
            missingHome.length > 0 ? `${homeName} (${missingHome.join(", ")})` : "",
            missingAway.length > 0 ? `${awayName} (${missingAway.join(", ")})` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </details>
  );
}

interface XgShot {
  minute: number;
  home: boolean;
  xg: number;
  goal: boolean;
}

// Cumulative xG race chart (SofaScore shotmap: every shot has its minute and
// xG): solid step lines for what each side actually created, dashed straight
// lines for the pre-match projection (expected goals spread over 90') when
// the caller knows it. Under it, each side vs its own projection pace.
// Dynamic bits: lines draw in on mount, goal shots get a dot, a dashed cursor
// marks the current minute, and hovering the chart reads each side's xG at
// that minute in the caption below.
function XgChart({
  shots,
  home,
  away,
  minute,
  expectedHome,
  expectedAway,
}: {
  shots: XgShot[];
  home: string;
  away: string;
  minute: number | null;
  expectedHome: number | null;
  expectedAway: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const PAD = 28;
  if (shots.length === 0) return null;
  const total = (isHome: boolean) => shots.filter((s) => s.home === isHome).reduce((n, s) => n + s.xg, 0);
  const totalHome = total(true);
  const totalAway = total(false);
  const top = Math.max(1, totalHome, totalAway, expectedHome ?? 0, expectedAway ?? 0) * 1.08;
  const lastMinute = Math.max(90, ...shots.map((s) => s.minute));
  const x = (m: number) => PAD + (Math.min(m, lastMinute) / lastMinute) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / top) * (H - PAD * 2);
  // Step-after path: flat until the shot's minute, then up by its xG.
  const race = (isHome: boolean): string => {
    let d = `M${x(0).toFixed(1)},${y(0).toFixed(1)}`;
    let acc = 0;
    for (const s of shots) {
      if (s.home !== isHome) continue;
      acc += s.xg;
      d += ` H${x(s.minute).toFixed(1)} V${y(acc).toFixed(1)}`;
    }
    d += ` H${x(lastMinute).toFixed(1)}`;
    return d;
  };
  // Cumulative xG of one side up to (and including) a minute.
  const atMinute = (isHome: boolean, m: number): number =>
    shots.filter((s) => s.home === isHome && s.minute <= m).reduce((n, s) => n + s.xg, 0);
  // Where each side's line sits at the end (for the value dots).
  const endOf = (isHome: boolean): { m: number; v: number } => {
    const own = shots.filter((s) => s.home === isHome);
    const last = own[own.length - 1];
    return { m: last ? last.minute : 0, v: own.reduce((n, s) => n + s.xg, 0) };
  };
  const endHome = endOf(true);
  const endAway = endOf(false);
  const pace = (expected: number): string =>
    `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${x(90).toFixed(1)},${y(expected).toFixed(1)}`;
  const ticks = [15, 30, 45, 60, 75, 90].filter((t) => t <= lastMinute);
  const fmt = (v: number) => v.toFixed(2).replace(".", ",");
  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const m = ((frac * W - PAD) / (W - PAD * 2)) * lastMinute;
    setHover(Math.round(Math.max(0, Math.min(lastMinute, m))));
  };
  const vsPace = (actual: number, expected: number | null): string | null => {
    if (expected === null || minute === null || minute <= 0) return null;
    const proj = (expected * Math.min(minute, 90)) / 90;
    if (proj < 0.05) return null;
    const pct = Math.round(((actual - proj) / proj) * 100);
    return pct >= 0 ? `${pct}% acima do esperado` : `${-pct}% abaixo do esperado`;
  };
  const homeNote = vsPace(totalHome, expectedHome);
  const awayNote = vsPace(totalAway, expectedAway);
  const caption =
    hover !== null ? (
      <>
        <span className="font-semibold text-neutral-200">{hover}&apos;</span>
        {" · "}
        <span className="text-sky-300">{fmt(atMinute(true, hover))}</span>
        {" – "}
        <span className="text-red-300">{fmt(atMinute(false, hover))}</span>
      </>
    ) : (
      [homeNote && `${home} ${homeNote}`, awayNote && `${away} ${awayNote}`].filter(Boolean).join(" · ") || (
        <span className="text-neutral-600">Passa o rato para ver o xG a cada minuto</span>
      )
    );
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-sky-300">
          {home} <span className="ml-1 font-bold text-neutral-100">{fmt(totalHome)}</span>
        </span>
        <span className="text-neutral-500">xG (acumulado)</span>
        <span className="font-medium text-red-300">
          <span className="mr-1 font-bold text-neutral-100">{fmt(totalAway)}</span>
          {away}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label={`xG acumulado de ${home} contra ${away}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD} y1={y(top * f)} x2={W - PAD} y2={y(top * f)} stroke="#262626" strokeWidth="1" />
        ))}
        <text x={PAD - 4} y={y(top) + 3} textAnchor="end" fontSize="10" fill="#737373">
          {top.toFixed(2).replace(".", ",")}
        </text>
        {expectedHome !== null && (
          <path d={pace(expectedHome)} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.55" />
        )}
        {expectedAway !== null && (
          <path d={pace(expectedAway)} fill="none" stroke="#f87171" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.55" />
        )}
        {/* Soft glow under each line, then the crisp line on top. */}
        <path d={race(false)} fill="none" stroke="#f87171" strokeWidth="6" opacity="0.18" strokeLinecap="round" />
        <path d={race(true)} fill="none" stroke="#38bdf8" strokeWidth="6" opacity="0.18" strokeLinecap="round" />
        <path d={race(false)} pathLength={1} className="xg-draw" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={race(true)} pathLength={1} className="xg-draw" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Goal shots get a white-ringed dot on their side's line. */}
        {shots.flatMap((s, i) =>
          s.goal
            ? [
                <circle
                  key={i}
                  cx={x(s.minute)}
                  cy={y(atMinute(s.home, s.minute))}
                  r="4.5"
                  fill={s.home ? "#38bdf8" : "#f87171"}
                  stroke="#0a0a0a"
                  strokeWidth="1.5"
                />,
              ]
            : []
        )}
        {/* Value dots where each race ends. */}
        <circle cx={x(endHome.m)} cy={y(endHome.v)} r="3.5" fill="#38bdf8" stroke="#0a0a0a" strokeWidth="1.5" />
        <circle cx={x(endAway.m)} cy={y(endAway.v)} r="3.5" fill="#f87171" stroke="#0a0a0a" strokeWidth="1.5" />
        {/* Current-minute cursor. */}
        {minute !== null && minute > 0 && (
          <g>
            <line x1={x(minute)} y1={PAD - 6} x2={x(minute)} y2={H - PAD} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={x(minute)} cy={PAD - 8} r="2.5" fill="#a3a3a3" opacity="0.9" />
          </g>
        )}
        {/* Hover cursor + dots on both lines. */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} y1={PAD - 6} x2={x(hover)} y2={H - PAD} stroke="#737373" strokeWidth="1" opacity="0.8" />
            <circle cx={x(hover)} cy={y(atMinute(true, hover))} r="3.5" fill="#38bdf8" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={y(atMinute(false, hover))} r="3.5" fill="#f87171" stroke="#0a0a0a" strokeWidth="1.5" />
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={H - PAD + 4} x2={x(t)} y2={H - PAD + 8} stroke="#525252" strokeWidth="1" />
            <text x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="#737373">
              {t}&apos;
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 min-h-4 text-center text-[11px] text-neutral-400">{caption}</p>
    </div>
  );
}

// Attack-momentum chart (SofaScore style: above the line = home pushing,
// below = away), drawn from /api/sofascore/graph. The fill is split by side
// (blue above, red below), the line draws itself in, a dashed cursor marks
// the current minute, and hovering reads the pressure at that minute.
function MomentumChart({
  points,
  home,
  away,
  minute,
}: {
  points: MomentumPoint[];
  home: string;
  away: string;
  minute: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const PAD = 28;
  if (points.length === 0) return null;
  const maxMinute = Math.max(90, ...points.map((p) => p.minute));
  const maxAbs = Math.max(10, ...points.map((p) => Math.abs(p.value)));
  const x = (m: number) => PAD + (Math.min(m, maxMinute) / maxMinute) * (W - PAD * 2);
  const y = (v: number) => H / 2 - (v / maxAbs) * (H / 2 - PAD);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  // One fill polygon per side, cutting segments at the zero crossings so blue
  // never dips below the line nor red above it.
  const sideFill = (above: boolean): string => {
    const inside = (v: number) => (above ? v > 0 : v < 0);
    let d = "";
    let open = false;
    const close = (m: number) => {
      d += ` L${x(m).toFixed(1)},${(H / 2).toFixed(1)} Z`;
      open = false;
    };
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i > 0) {
        const q = points[i - 1];
        if (inside(q.value) !== inside(p.value)) {
          const t = Math.abs(q.value) / (Math.abs(q.value) + Math.abs(p.value) || 1);
          const mc = q.minute + t * (p.minute - q.minute);
          if (open) close(mc);
          if (inside(p.value)) {
            d += ` M${x(mc).toFixed(1)},${(H / 2).toFixed(1)} L${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`;
            open = true;
          }
          continue;
        }
      }
      if (inside(p.value)) {
        d += open
          ? ` L${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`
          : ` M${x(p.minute).toFixed(1)},${(H / 2).toFixed(1)} L${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`;
        open = true;
      } else if (open) {
        close(p.minute);
      }
    }
    if (open) close(points[points.length - 1].minute);
    return d;
  };
  const ticks = [15, 30, 45, 60, 75, 90].filter((t) => t <= maxMinute);
  const nearest = (m: number): MomentumPoint =>
    points.reduce((a, b) => (Math.abs(b.minute - m) < Math.abs(a.minute - m) ? b : a));
  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const m = ((frac * W - PAD) / (W - PAD * 2)) * maxMinute;
    setHover(Math.round(Math.max(0, Math.min(maxMinute, m))));
  };
  const hp = hover !== null ? nearest(hover) : null;
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-sky-300">{home}</span>
        <span className="text-neutral-500">Momentum</span>
        <span className="font-medium text-red-300">{away}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label={`Momentum de ${home} contra ${away}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#525252" strokeWidth="1" />
        <path d={sideFill(true)} fill="#38bdf8" opacity="0.28" />
        <path d={sideFill(false)} fill="#f87171" opacity="0.28" />
        <path d={line} pathLength={1} className="chart-draw" fill="none" stroke="#e5e5e5" strokeWidth="1.5" />
        {minute !== null && minute > 0 && (
          <line
            x1={x(minute)}
            y1={PAD - 14}
            x2={x(minute)}
            y2={H - PAD}
            stroke="#a3a3a3"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.7"
          />
        )}
        {hp !== null && (
          <g>
            <line x1={x(hp.minute)} y1={PAD - 14} x2={x(hp.minute)} y2={H - PAD} stroke="#737373" strokeWidth="1" opacity="0.8" />
            <circle cx={x(hp.minute)} cy={y(hp.value)} r="3.5" fill="#e5e5e5" stroke="#0a0a0a" strokeWidth="1.5" />
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={H - PAD + 4} x2={x(t)} y2={H - PAD + 8} stroke="#525252" strokeWidth="1" />
            <text x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="#737373">
              {t}&apos;
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 min-h-4 text-center text-[11px] text-neutral-400">
        {hp !== null ? (
          <>
            <span className="font-semibold text-neutral-200">{Math.round(hp.minute)}&apos;</span>
            {" · pressão "}
            {hp.value >= 0 ? (
              <span className="text-sky-300">{home}</span>
            ) : (
              <span className="text-red-300">{away}</span>
            )}
          </>
        ) : (
          <span className="text-neutral-600">Passa o rato para ver a pressão a cada minuto</span>
        )}
      </p>
    </div>
  );
}

const INCIDENT_ICON = { goal: "⚽", red: "🟥", yellow: "🟨", sub: "🔄", info: "·" } as const;

// Live 2D match tracker from SofaScore (attack momentum / live map), the same
// frame the SofaScore match page itself embeds:
//   https://www.sofascore.com/api/v1/event/{id}/live-match-tracker/en/invert-teams/false
// It sends no X-Frame-Options / CSP frame-ancestors, so it embeds directly.
// Around it: live scoreboard, momentum chart, recent incidents and match
// statistics — all through /api/sofascore/*, refreshed every minute.
export default function SofaScoreWidget({
  eventId,
  home,
  away,
  expectedHome,
  expectedAway,
}: {
  eventId: number;
  home?: string;
  away?: string;
  // Pre-match expected goals (the live calculator knows them): dashed
  // projection lines. Without them the chart shows actual xG only.
  expectedHome?: number | null;
  expectedAway?: number | null;
}) {
  const [state, setState] = useState<LiveGameState | null>(null);
  const [hasTracker, setHasTracker] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<Incident[]>([]);
  const [momentum, setMomentum] = useState<MomentumPoint[] | null>(null);
  const [stats, setStats] = useState<StatRow[] | null>(null);
  const [xg, setXg] = useState<XgShot[] | null>(null);
  const [lineups, setLineups] = useState<{
    home: LineupSide | null;
    away: LineupSide | null;
    missing: { name: string; home: boolean }[];
  } | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sofascore/event?id=${eventId}`, { cache: "no-store" });
        if (stop || !res.ok) return;
        const body = await res.json();
        if (body?.state) setState(body.state as LiveGameState);
        if (typeof body?.hasTracker === "boolean" && !stop) setHasTracker(body.hasTracker);
        if (Array.isArray(body?.recent) && !stop) setRecent(body.recent as Incident[]);
      } catch {
        // Offline scraper: the tracker below still tries on its own.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [eventId]);

  // Momentum + statistics + xG load once each, then refresh on a slow poll
  // (graphs redrawn every minute would flicker).
  useEffect(() => {
    let stop = false;
    const loadGraph = () => {
      fetch(`/api/sofascore/graph?id=${eventId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { points?: MomentumPoint[] } | null) => {
          if (!stop && body && Array.isArray(body.points)) setMomentum(body.points);
        })
        .catch(() => {});
      fetch(`/api/sofascore/statistics?id=${eventId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { stats?: StatRow[] } | null) => {
          if (!stop && body && Array.isArray(body.stats)) setStats(body.stats);
        })
        .catch(() => {});
      fetch(`/api/sofascore/shotmap?id=${eventId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { shots?: XgShot[] } | null) => {
          if (!stop && body && Array.isArray(body.shots)) setXg(body.shots);
        })
        .catch(() => {});
      fetch(`/api/sofascore/lineups?id=${eventId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (body: { home?: LineupSide | null; away?: LineupSide | null; missing?: { name: string; home: boolean }[] } | null) => {
            if (!stop && body && (body.home || body.away)) setLineups({ home: body.home ?? null, away: body.away ?? null, missing: body.missing ?? [] });
          }
        )
        .catch(() => {});
    };
    loadGraph();
    const id = setInterval(loadGraph, 120_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [eventId]);

  const homeName = home || state?.homeName || "Casa";
  const awayName = away || state?.awayName || "Fora";
  // Alerts compare each poll against the previous one: goals, red cards,
  // kickoff and full time. The first reading only sets the baseline.
  const prevAlert = useRef<{ score: string; redsHome: number; redsAway: number; phase: string } | null>(null);
  useEffect(() => {
    if (!state) return;
    const score =
      state.homeGoals !== null && state.awayGoals !== null ? `${state.homeGoals}–${state.awayGoals}` : "?";
    const prev = prevAlert.current;
    prevAlert.current = { score, redsHome: state.reds.home, redsAway: state.reds.away, phase: state.phase };
    if (!prev || !alertsOn()) return;
    const title = `${homeName} ${score === "?" ? "" : score} ${awayName}`.trim();
    if (score !== "?" && score !== prev.score && prev.score !== "?") {
      alertUser(`⚽ Golo! ${title}`, `Novo resultado no jogo que estás a seguir.`, true);
    } else if (state.reds.home > prev.redsHome || state.reds.away > prev.redsAway) {
      const who = state.reds.home > prev.redsHome ? homeName : awayName;
      alertUser(`🟥 Vermelho (${who})`, `Expulsão no jogo que estás a seguir.`, false);
    } else if (state.phase === "live" && prev.phase !== "live") {
      alertUser(`▶ Começou: ${homeName} vs ${awayName}`, `O jogo começou.`, false);
    } else if (state.phase === "finished" && prev.phase !== "finished") {
      alertUser(`⏱ Fim: ${title}`, `Resultado final no jogo que estás a seguir.`, false);
    }
  }, [state, homeName, awayName]);
  const score =
    state && state.homeGoals !== null && state.awayGoals !== null
      ? `${state.homeGoals}–${state.awayGoals}`
      : null;
  const xgTotal = (isHome: boolean): number =>
    (xg ?? []).filter((s) => s.home === isHome).reduce((n, s) => n + s.xg, 0);
  const phase =
    !state || state.phase === "live"
      ? state?.minute !== null && state?.minute !== undefined
        ? `${state.minute}'`
        : "Em direto"
      : state.phase === "halftime"
        ? "Intervalo"
        : state.phase === "finished"
          ? "Terminado"
          : state.phase === "upcoming"
            ? "Por começar"
            : state.raw.statusText || "";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-neutral-800 bg-gradient-to-b from-neutral-800/50 to-transparent px-4 py-2.5">
        <p className="min-w-0 truncate text-right text-sm font-semibold text-sky-200">
          {homeName}
          {state && state.reds.home > 0 && <span aria-label={`${state.reds.home} vermelho`} className="ml-1 text-xs">🟥</span>}
        </p>
        <div className="flex flex-col items-center px-1">
          {score !== null ? (
            <span key={score} className="score-pop text-2xl font-extrabold tabular-nums text-neutral-50">
              {score}
            </span>
          ) : (
            <span className="text-sm font-semibold text-neutral-500">vs</span>
          )}
          {xg !== null && xg.length > 0 && (
            <span className="text-[10px] tabular-nums text-neutral-500">
              xG {xgTotal(true).toFixed(2).replace(".", ",")}–{xgTotal(false).toFixed(2).replace(".", ",")}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-red-200">
            {state && state.reds.away > 0 && <span aria-label={`${state.reds.away} vermelho`} className="mr-1 text-xs">🟥</span>}
            {awayName}
          </p>
          {phase && (
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                state?.phase === "live"
                  ? "bg-red-500/15 text-red-300"
                  : state?.phase === "halftime"
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-neutral-800 text-neutral-400"
              }`}
            >
              {state?.phase === "live" && (
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              )}
              {phase}
            </span>
          )}
        </div>
      </div>

      {hasTracker !== false && (
        <div className="relative border-b border-neutral-800 bg-black">
          <iframe
            src={`https://www.sofascore.com/api/v1/event/${eventId}/live-match-tracker/en/invert-teams/false`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`SofaScore live tracker · evento ${eventId}`}
            className="h-[320px] w-full border-0"
            style={{ overflow: "hidden" }}
          />
          {/* Vignette + live pill float above the embed (it is cross-origin,
              so its inside cannot be restyled — this frames it instead). */}
          <div aria-hidden className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
          {state?.phase === "live" && (
            <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-red-300 ring-1 ring-red-500/40 backdrop-blur-sm">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              EM DIRETO{state.minute !== null && state.minute !== undefined ? ` · ${state.minute}'` : ""}
            </span>
          )}
        </div>
      )}

      {momentum && momentum.length > 0 && (
        <div>
          <MomentumChart points={momentum} home={homeName} away={awayName} minute={state?.minute ?? null} />
          {hasTracker === false && (
            <p className="px-4 pb-1 text-center text-[11px] text-neutral-600">
              Sem mapa ao vivo para este jogo: só momentum.
            </p>
          )}
        </div>
      )}
      {xg !== null && xg.length > 0 && (
        <div className="border-t border-neutral-800">
          <XgChart
            shots={xg}
            home={homeName}
            away={awayName}
            minute={state?.minute ?? null}
            expectedHome={expectedHome ?? null}
            expectedAway={expectedAway ?? null}
          />
          <PressureChart shots={xg} home={homeName} away={awayName} />
        </div>
      )}
      {hasTracker === false && (!momentum || momentum.length === 0) && (
        <p className="px-4 py-8 text-center text-xs text-neutral-500">
          Sem mapa nem momentum para este jogo no SofaScore.
        </p>
      )}

      {lineups && lineups.home && lineups.away && (
        <Lineups home={lineups.home} away={lineups.away} homeName={homeName} awayName={awayName} missing={lineups.missing} />
      )}

      {recent.length > 0 && (
        <div className="border-t border-neutral-800 px-4 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Últimos eventos</p>
          <ul className="space-y-1">
            {recent.map((inc, i) => (
              <li key={`${inc.minute}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="w-8 shrink-0 text-right font-semibold text-neutral-400">{inc.minute}&apos;</span>
                <span aria-hidden>{INCIDENT_ICON[inc.kind] ?? "·"}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-200">
                  {inc.text}
                  <span className="ml-1.5 text-[10px] text-neutral-500">{inc.home ? homeName : awayName}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="border-t border-neutral-800 px-4 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Estatísticas</p>
          <dl className="space-y-1">
            {stats.map((row) => (
              <div key={row.name} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-right font-medium text-neutral-200">{row.home}</span>
                <span className="min-w-0 flex-1 truncate text-center text-neutral-500">{row.name}</span>
                <span className="w-14 shrink-0 font-medium text-neutral-200">{row.away}</span>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="border-t border-neutral-800 px-4 py-2.5 text-center">
        <a
          href={`https://www.sofascore.com/football/match/#/id:${eventId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-amber-400 hover:underline"
        >
          Abrir o jogo no SofaScore →
        </a>
      </div>
    </div>
  );
}
