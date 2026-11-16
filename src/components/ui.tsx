"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

// Live view of a data-* attribute on <html> (theme, nav mode).
export function useHtmlAttr(name: string): string | null {
  return useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb);
      o.observe(document.documentElement, { attributes: true, attributeFilter: [`data-${name}`] });
      return () => o.disconnect();
    },
    () => document.documentElement.getAttribute(`data-${name}`),
    () => null,
  );
}

// A number that counts up to its value.
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  duration = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (t: number): void => {
      const p = reduce ? 1 : Math.min(1, (t - t0) / duration);
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className="tabular-nums">
      {v.toFixed(decimals).replace(".", ",")}
      {suffix}
    </span>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string; // tailwind bg class
  text?: string; // tailwind text class for the legend
}

// One bar split in coloured parts (1X2, V/E/D…): the share is each value over the total.
export function ProbBar({ slices, className = "" }: { slices: Slice[]; className?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        {slices.map((s) => (
          <div
            key={s.label}
            className={`bar-grow h-full ${s.color}`}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label} ${Math.round((s.value / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums">
        {slices.map((s) => (
          <span key={s.label} className={s.text ?? "text-neutral-400"}>
            {s.label} <b className="font-semibold">{Math.round((s.value / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// Circular gauge, 0–100.
export function Ring({
  value,
  size = 64,
  label,
  color = "#34d399",
}: {
  value: number;
  size?: number;
  label?: string;
  color?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.9155" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.2" />
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          stroke={color}
          strokeWidth="3.2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${v} 100`}
          className="ring-draw"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <span className="absolute text-[13px] font-bold tabular-nums text-neutral-100">{label ?? `${Math.round(v)}%`}</span>
    </div>
  );
}

// Tiny trend line for tables and tiles.
export function Sparkline({ values, width = 84, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "#34d399" : "#f87171";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="chart-draw" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={color} />
    </svg>
  );
}

// Round club badge: the real crest when the SofaScore team id is known (falls
// back by itself if the image fails), otherwise initials on a colour derived
// from the name.
export function Crest({ name, size = 28, teamId }: { name: string; size?: number; teamId?: number }) {
  const [failed, setFailed] = useState(false);
  if (teamId && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://api.sofascore.app/api/v1/team/${teamId}/image`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        style={{ width: size, height: size }}
      />
    );
  }
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const words = name.replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white ring-1 ring-white/25"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(145deg, hsl(${h} 70% 48%), hsl(${(h + 40) % 360} 65% 28%))`,
        boxShadow: `0 4px 14px -4px hsl(${h} 80% 50% / 0.6)`,
      }}
    >
      {initials}
    </span>
  );
}

// Shared "nothing here" panel.
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="glass flex flex-col items-center px-6 py-12 text-center">
      <span className="empty-orb mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/30">
        {icon}
      </span>
      <p className="font-display text-base font-semibold text-neutral-100">{title}</p>
      {children && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-neutral-400">{children}</p>}
      {action &&
        (action.href ? (
          <Link href={action.href} className="btn-glow mt-5 inline-flex min-h-10 items-center rounded-xl px-5 py-2 text-sm">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="btn-glow mt-5 inline-flex min-h-10 items-center rounded-xl px-5 py-2 text-sm">
            {action.label}
          </button>
        ))}
    </div>
  );
}

// Colour language (see globals.css v6): emerald = value/win/active, red = live/
// loss/risk, amber = followed/attention, sky = information.
const BADGE = {
  value: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/40 badge-glow",
  win: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  loss: "bg-red-500/15 text-red-300 ring-red-500/30",
  warn: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  neutral: "bg-white/[0.06] text-neutral-300 ring-white/10",
} as const;

export function Badge({ kind = "neutral", children }: { kind?: keyof typeof BADGE; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${BADGE[kind]}`}>
      {children}
    </span>
  );
}

// Skeleton blocks shaped like the real content, so loading does not jump.
export function SkeletonCard({ className = "h-24" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="glass space-y-2 p-4" aria-busy="true" aria-label="A carregar">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-8 w-8 !rounded-full" />
          <div className="skeleton h-4 flex-1" style={{ maxWidth: `${60 + ((i * 17) % 35)}%` }} />
          <div className="skeleton ml-auto h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="glass p-4" aria-busy="true" aria-label="A carregar gráfico">
      <div className="skeleton mb-3 h-4 w-48" />
      <div className="skeleton h-44" />
    </div>
  );
}

// A number that flashes green when it goes up and red when it goes down, so a
// live change is noticed without staring. Respects reduced motion (CSS).
export function Flash({ value, children, className = "" }: { value: number; children?: React.ReactNode; className?: string }) {
  const [prev, setPrev] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  if (value !== prev) {
    setPrev(value);
    setDir(value > prev ? "up" : "down");
  }
  return (
    <span key={dir ? `${dir}-${value}` : "idle"} className={`num ${dir ? `flash-${dir}` : ""} ${className}`}>
      {children ?? value}
    </span>
  );
}
