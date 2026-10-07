"use client";

import { useState, type ReactNode } from "react";

// Shared elegant two-series curve: smooth (Catmull-Rom) lines with a soft
// gradient area, end-of-line labels carrying the last value, a dashed
// reference line and one hover tooltip for both series. Used by the form and
// Elo charts so they read as one family.
export interface CurvePoint {
  value: number;
  date: string;
  tip: ReactNode;
}

export interface CurveSeries {
  name: string;
  color: string;
  soft: string;
  points: CurvePoint[];
}

// Catmull-Rom through the points, as cubic segments. Exported for tests.
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  let s = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    s += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return s;
}

const W = 560;
const H = 190;
const PADL = 44;
const PADR = 92;
const PADT = 12;
const PADB = 24;

export default function CurveChart({
  series,
  yFormat,
  refValue,
  refLabel,
  minSpan,
  aria,
}: {
  series: CurveSeries[];
  // Server-safe format key (functions can't cross the server/client boundary).
  yFormat: "int" | "comma2";
  refValue?: number;
  refLabel?: string;
  minSpan?: number;
  aria: string;
}) {
  const yLabel = (v: number): string =>
    yFormat === "int" ? String(Math.round(v)) : v.toFixed(2).replace(".", ",");
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.points.length));
  if (n < 2) return null;
  const vals = series.flatMap((s) => s.points.map((p) => p.value));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (refValue !== undefined) {
    lo = Math.min(lo, refValue);
    hi = Math.max(hi, refValue);
  }
  const span0 = hi - lo || 1;
  const pad = span0 * 0.18;
  lo -= pad;
  hi += pad;
  if (minSpan !== undefined && hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const x = (i: number): number => PADL + (n === 1 ? 0 : (i / (n - 1)) * (W - PADL - PADR));
  const y = (v: number): number => PADT + (1 - (v - lo) / (hi - lo || 1)) * (H - PADT - PADB);
  const dates = series.reduce((a, s) => (s.points.length > a.points.length ? s : a)).points;
  const dayMonth = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const gid = (k: string): string => `cc-${k}-${Math.abs(aria.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 997)}`;

  // End labels: stagger when the lines finish close together.
  const ends = series.map((s) => ({ s, v: s.points[s.points.length - 1].value }));
  const close = ends.length === 2 && Math.abs(y(ends[0].v) - y(ends[1].v)) < 16;
  const hov = hover !== null ? hover : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={aria}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={gid(`g${si}`)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.33, 0.66, 1].map((f) => {
          const v = hi - f * (hi - lo);
          return (
            <g key={f}>
              <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke="#262626" strokeWidth="1" />
              <text x={PADL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#737373">
                {yLabel(v)}
              </text>
            </g>
          );
        })}
        {refValue !== undefined && refValue >= lo && refValue <= hi && (
          <g>
            <line x1={PADL} x2={W - PADR} y1={y(refValue)} y2={y(refValue)} stroke="#525252" strokeWidth="1" strokeDasharray="5 4" opacity="0.8" />
            {refLabel && (
              <text x={W - PADR + 6} y={y(refValue) + 3} fontSize="9" fill="#8a8a8a">
                {refLabel}
              </text>
            )}
          </g>
        )}
        {series.map((s, si) => {
          const pts = s.points.map((p, i) => ({ x: x(i), y: y(p.value) }));
          const d = smoothPath(pts);
          const base = y(lo);
          return (
            <g key={si}>
              <path d={`${d} L${pts[pts.length - 1].x.toFixed(1)},${base.toFixed(1)} L${pts[0].x.toFixed(1)},${base.toFixed(1)} Z`} fill={`url(#${gid(`g${si}`)})`} />
              <path d={d} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" />
            </g>
          );
        })}
        {hov !== null && <line x1={x(hov)} x2={x(hov)} y1={PADT} y2={H - PADB} stroke="#fafafa" strokeWidth="1" opacity="0.35" />}
        {series.map((s, si) =>
          s.points.map((p, i) => (
            <circle
              key={`${si}-${i}`}
              cx={x(i)}
              cy={y(p.value)}
              r={hov === i ? 4 : 2.5}
              fill={s.color}
              stroke={hov === i ? "#fff" : s.soft}
              strokeWidth={hov === i ? 1.5 : 1}
            />
          ))
        )}
        {/* Wide invisible hit targets, one per index across both series. */}
        {dates.map((_, i) => (
          <circle
            key={`hit${i}`}
            cx={x(i)}
            cy={(H - PADB + PADT) / 2}
            r="14"
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {dates.map((d, i) =>
          i % Math.ceil(n / 5) === 0 ? (
            <text key={`${d.date}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#737373">
              {dayMonth(d.date)}
            </text>
          ) : null
        )}
        {ends.map(({ s, v }, si) => {
          const lastX = x(s.points.length - 1);
          const dy = close ? (si === 0 ? -8 : 8) : 0;
          return (
            <g key={si}>
              <circle cx={lastX} cy={y(v)} r="3.5" fill={s.color} stroke="#0a0a0a" strokeWidth="1.5" />
              <text x={lastX + 7} y={y(v) + dy + 3.5} fontSize="10.5" fontWeight="600" fill={s.color}>
                {s.name} · {yLabel(v)}
              </text>
            </g>
          );
        })}
      </svg>
      {hov !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-44 max-w-60 rounded-lg border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: `${Math.min(70, Math.max(0, (x(hov) / W) * 100 - 6))}%`, top: "4%" }}
        >
          <p className="mb-1 font-semibold text-neutral-100">{dayMonth(dates[hov]?.date ?? "")}</p>
          {series.map((s, si) => {
            const p = s.points[hov];
            if (!p) return null;
            return (
              <div key={si} className="mt-0.5">
                <p className="font-medium" style={{ color: s.color }}>
                  {s.name}
                </p>
                {p.tip}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
