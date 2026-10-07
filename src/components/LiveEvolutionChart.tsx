"use client";

import { useEffect, useMemo, useState } from "react";

// Live evolution chart for one synced game: one snapshot per minute poll
// (score, cards, cumulative stats, accumulated xG), drawn as history. The
// model series are recomputed per snapshot from the same inputs (never
// invented): what the model said at each minute. Missing readings leave gaps.
export interface EvoSnap {
  minute: number;
  hg: number;
  ag: number;
  rh: number;
  ra: number;
  stats: Record<string, { home: number | null; away: number | null }>;
  xgH: number | null;
  xgA: number | null;
}

export interface EvoModel {
  mais1: number | null;
  over25: number | null;
  btts: number | null;
}

type SeriesId =
  | "mais1" | "over25" | "btts"
  | "shH" | "shA" | "coH" | "coA" | "xgH" | "xgA"
  | "possH" | "possA" | "sotH" | "sotA";

interface Series {
  id: SeriesId;
  label: string;
  cat: string;
  axis: "count" | "pct";
  color: string;
  dash?: string;
  width?: number;
  get: (s: EvoSnap, m: EvoModel) => number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const pct1 = (p: number): string => `${(p * 100).toFixed(0)}%`;

function seriesDefs(homeName: string, awayName: string): Series[] {
  const stat = (name: string, side: "home" | "away") => (s: EvoSnap) => s.stats[name]?.[side] ?? null;
  const H = homeName || "Casa";
  const A = awayName || "Fora";
  return [
    { id: "mais1", label: "Mais 1 golo % (modelo)", cat: "Previsões", axis: "pct", color: "#fbbf24", width: 2.5, get: (s, m) => m.mais1 },
    { id: "over25", label: "Over 2,5 % (modelo)", cat: "Previsões", axis: "pct", color: "#fb923c", width: 2.5, get: (s, m) => m.over25 },
    { id: "btts", label: "BTTS % (modelo)", cat: "Previsões", axis: "pct", color: "#c084fc", width: 2.5, get: (s, m) => m.btts },
    { id: "shH", label: `Remates — ${H}`, cat: "Remates", axis: "count", color: "#34d399", get: (s) => stat("Remates", "home")(s) },
    { id: "shA", label: `Remates — ${A}`, cat: "Remates", axis: "count", color: "#38bdf8", dash: "5 3", get: (s) => stat("Remates", "away")(s) },
    { id: "coH", label: `Cantos — ${H}`, cat: "Cantos", axis: "count", color: "#34d399", get: (s) => stat("Cantos", "home")(s) },
    { id: "coA", label: `Cantos — ${A}`, cat: "Cantos", axis: "count", color: "#38bdf8", dash: "5 3", get: (s) => stat("Cantos", "away")(s) },
    { id: "xgH", label: `xG — ${H}`, cat: "xG", axis: "count", color: "#34d399", get: (s) => s.xgH },
    { id: "xgA", label: `xG — ${A}`, cat: "xG", axis: "count", color: "#38bdf8", dash: "5 3", get: (s) => s.xgA },
    { id: "possH", label: `Posse % — ${H}`, cat: "Posse", axis: "pct", color: "#34d399", get: (s) => num(s.stats["Posse de bola"]?.home) },
    { id: "possA", label: `Posse % — ${A}`, cat: "Posse", axis: "pct", color: "#38bdf8", dash: "5 3", get: (s) => num(s.stats["Posse de bola"]?.away) },
    {
      id: "sotH", label: `% remates à baliza — ${H}`, cat: "Remates", axis: "pct", color: "#34d399",
      get: (s) => {
        const t = stat("Remates", "home")(s);
        const o = stat("Remates à baliza", "home")(s);
        return t !== null && o !== null && t > 0 ? o / t : null;
      },
    },
    {
      id: "sotA", label: `% remates à baliza — ${A}`, cat: "Remates", axis: "pct", color: "#38bdf8", dash: "5 3",
      get: (s) => {
        const t = stat("Remates", "away")(s);
        const o = stat("Remates à baliza", "away")(s);
        return t !== null && o !== null && t > 0 ? o / t : null;
      },
    },
  ];
}

const ALL: SeriesId[] = [
  "mais1", "over25", "btts", "shH", "shA", "coH", "coA", "xgH", "xgA",
  "possH", "possA", "sotH", "sotA",
];

interface NamedFilter {
  name: string;
  series: SeriesId[];
}

const LS_KEY = "apostas:evoFilters";
const DEFAULT_NAME = "Padrão (mostrar tudo)";

// Goal markers from score changes between consecutive snapshots (side =
// whose total went up). Exported for tests.
export function goalMarkers(snaps: EvoSnap[]): { minute: number; home: boolean }[] {
  const goals: { minute: number; home: boolean }[] = [];
  for (let i = 1; i < snaps.length; i++) {
    if (snaps[i].hg > snaps[i - 1].hg) goals.push({ minute: snaps[i].minute, home: true });
    if (snaps[i].ag > snaps[i - 1].ag) goals.push({ minute: snaps[i].minute, home: false });
  }
  return goals;
}

function loadFilters(): { filters: NamedFilter[]; def: string } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { filters: [], def: DEFAULT_NAME };
    const parsed = JSON.parse(raw) as { filters?: NamedFilter[]; def?: string };
    const filters = Array.isArray(parsed.filters)
      ? parsed.filters.filter((f) => typeof f?.name === "string" && Array.isArray(f.series))
      : [];
    return { filters, def: typeof parsed.def === "string" ? parsed.def : DEFAULT_NAME };
  } catch {
    return { filters: [], def: DEFAULT_NAME };
  }
}

const W = 640;
const H = 220;
const PADL = 34;
const PADR = 40;
const PADT = 10;
const PADB = 22;

export default function LiveEvolutionChart({
  snaps,
  modelAt,
  homeName,
  awayName,
}: {
  snaps: EvoSnap[];
  modelAt: (s: EvoSnap) => EvoModel;
  homeName: string;
  awayName: string;
}) {
  const defs = useMemo(() => seriesDefs(homeName, awayName), [homeName, awayName]);
  const byId = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const [filter, setFilter] = useState<string>(DEFAULT_NAME);
  const [hidden, setHidden] = useState<Set<SeriesId>>(new Set());
  const [filters, setFilters] = useState<NamedFilter[]>([]);
  const [defName, setDefName] = useState<string>(DEFAULT_NAME);
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formSet, setFormSet] = useState<Set<SeriesId>>(new Set(ALL));
  const [editing, setEditing] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const { filters: f, def } = loadFilters();
    setFilters(f);
    setDefName(def);
    setFilter(def);
  }, []);

  const persist = (f: NamedFilter[], d: string): void => {
    setFilters(f);
    setDefName(d);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ filters: f, def: d }));
    } catch {
      // Private mode: filters just don't persist.
    }
  };

  const base: SeriesId[] =
    filter === DEFAULT_NAME ? ALL : (filters.find((f) => f.name === filter)?.series ?? ALL);
  const visible = defs.filter((d) => base.includes(d.id) && !hidden.has(d.id));

  const models = useMemo(() => snaps.map((s) => modelAt(s)), [snaps, modelAt]);
  const xMax = Math.max(90, ...snaps.map((s) => s.minute));
  const x = (minute: number): number => PADL + (minute / xMax) * (W - PADL - PADR);
  const countMax = Math.max(
    1,
    ...visible
      .filter((d) => d.axis === "count")
      .flatMap((d) => snaps.map((s, i) => d.get(s, models[i]) ?? 0))
  );
  const yCount = (v: number): number => PADT + (1 - Math.min(1, v / (Math.ceil(countMax) || 1))) * (H - PADT - PADB);
  const yPct = (v: number): number => PADT + (1 - Math.min(1, Math.max(0, v))) * (H - PADT - PADB);

  // Goal markers: snapshots where a side's total went up.
  const goals = goalMarkers(snaps);

  const pathFor = (d: Series): string => {
    // Contiguous segments (gaps stay gaps), each drawn smooth (Catmull-Rom).
    const pts: { x: number; y: number }[] = [];
    const segs: string[] = [];
    const flush = (): void => {
      if (pts.length === 1) segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`);
      else if (pts.length === 2) segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`);
      else if (pts.length > 2) {
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
        segs.push(s);
      }
      pts.length = 0;
    };
    snaps.forEach((s, i) => {
      const v = d.get(s, models[i]);
      if (v === null || !Number.isFinite(v)) {
        flush();
        return;
      }
      pts.push({ x: x(s.minute), y: d.axis === "count" ? yCount(v) : yPct(v) });
    });
    flush();
    return segs.join(" ");
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    snaps.forEach((s, i) => {
      const dist = Math.abs(x(s.minute) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  };

  const hov = hover !== null ? snaps[hover] : null;
  const hovModel = hover !== null ? models[hover] : null;
  const cats = [...new Set(defs.map((d) => d.cat))];

  const toggleForm = (id: SeriesId): void =>
    setFormSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveForm = (): void => {
    const name = formName.trim().slice(0, 30);
    if (!name || formSet.size === 0) return;
    const entry = { name, series: [...formSet] as SeriesId[] };
    const next = editing && editing !== name ? filters.filter((f) => f.name !== editing) : filters.filter((f) => f.name !== name);
    next.push(entry);
    persist(next, defName);
    setFilter(name);
    setHidden(new Set());
    setFormOpen(false);
    setFormName("");
    setEditing(null);
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-300">Evolução ao vivo</h3>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setHidden(new Set());
          }}
          title="Filtro de legenda"
          className="max-w-56 truncate rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none"
        >
          <option value={DEFAULT_NAME}>{DEFAULT_NAME}</option>
          {filters.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
              {f.name === defName ? " ★" : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-[11px] text-neutral-500">
        Um ponto por leitura (1/min): o que o jogo mostrava e o que o modelo dizia. O início é reconstruído
        (remates, golos e modelo); posse e cantos só contam da tua entrada.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div>
          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full"
              role="img"
              aria-label="Evolução ao vivo"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
              onClick={onMove}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f}
                  x1={PADL}
                  x2={W - PADR}
                  y1={PADT + f * (H - PADT - PADB)}
                  y2={PADT + f * (H - PADT - PADB)}
                  stroke="#27272a"
                  strokeWidth="1"
                />
              ))}
              <line x1={x(45)} x2={x(45)} y1={PADT} y2={H - PADB} stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
              <text x={x(45)} y={yPct(0) - 14} textAnchor="middle" fontSize="9" fill="#71717a">
                INT
              </text>
              {[0, 15, 30, 45, 60, 75, 90].map(
                (t) =>
                  t <= xMax && (
                    <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="9" fill="#71717a">
                      {t}
                    </text>
                  )
              )}
              {[0, 25, 50, 75, 100].map((q) => (
                <text key={q} x={W - PADR + 4} y={yPct(q / 100) + 3} fontSize="9" fill="#71717a">
                  {q}
                </text>
              ))}
              {[0, 0.5, 1].map((f) => {
                const v = Math.max(1, Math.round(countMax * f));
                return (
                  <text key={f} x={PADL - 4} y={yCount(v) + 3} textAnchor="end" fontSize="9" fill="#71717a">
                    {v}
                  </text>
                );
              })}
              {goals.map((gl, i) => (
                <line
                  key={i}
                  x1={x(gl.minute)}
                  x2={x(gl.minute)}
                  y1={PADT}
                  y2={H - PADB}
                  stroke={gl.home ? "#34d399" : "#38bdf8"}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.3"
                />
              ))}
              {visible.map((d) => (
                <path
                  key={d.id}
                  d={pathFor(d)}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={d.width ?? 1.25}
                  strokeDasharray={d.dash ?? undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {hov && (
                <line x1={x(hov.minute)} x2={x(hov.minute)} y1={PADT} y2={H - PADB} stroke="#fafafa" strokeWidth="1" opacity="0.5" />
              )}
            </svg>
            {hov && hovModel && (
              <div
                className="pointer-events-none absolute z-10 min-w-40 max-w-60 rounded-lg border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-xs shadow-xl"
                style={{ left: `${Math.min(70, (x(hov.minute) / W) * 100)}%`, top: "4%" }}
              >
                <p className="font-semibold text-neutral-100">
                  {hov.minute}&apos; · {hov.hg}–{hov.ag}
                </p>
                {visible
                  .map((d) => ({ d, v: d.get(hov, hovModel) }))
                  .filter((r): r is { d: Series; v: number } => r.v !== null)
                  .slice(0, 7)
                  .map(({ d, v }) => (
                    <p key={d.id} className="truncate text-[11px] text-neutral-300">
                      <span style={{ color: d.color }}>●</span> {d.label}:{" "}
                      {d.axis === "pct" ? pct1(v) : v.toFixed(2).replace(".", ",")}
                    </p>
                  ))}
                {visible.filter((d) => d.get(hov, hovModel) !== null).length > 7 && (
                  <p className="text-[10px] text-neutral-500">
                    +{visible.filter((d) => d.get(hov, hovModel) !== null).length - 7} mais…
                  </p>
                )}
                {goals.some((gl) => gl.minute === hov.minute) && (
                  <p className="text-[11px] text-neutral-200">
                    ⚽ Golo — {goals.find((gl) => gl.minute === hov.minute)?.home ? homeName : awayName}, ~{hov.minute}&apos;
                  </p>
                )}
              </div>
            )}
          </div>
          {goals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {goals.map((gl, i) => (
                <span key={i} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-300">
                  ⚽ {gl.minute}&apos; ({gl.home ? homeName : awayName})
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Séries</p>
          <div className="space-y-1">
            {defs
              .filter((d) => base.includes(d.id))
              .map((d) => {
                const off = hidden.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                    title={off ? "Mostrar série" : "Esconder série (não mexe no filtro)"}
                    className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px] transition hover:bg-neutral-800/60"
                  >
                    <svg width="26" height="8" aria-hidden>
                      <line x1="0" x2="26" y1="4" y2="4" stroke={off ? "#52525b" : d.color} strokeWidth={d.width ?? 1.5} strokeDasharray={d.dash ?? undefined} strokeLinecap="round" />
                    </svg>
                    <span className={`min-w-0 flex-1 truncate ${off ? "text-neutral-600 line-through" : "text-neutral-300"}`}>
                      {d.label}
                    </span>
                    <span className={off ? "text-neutral-700" : "text-neutral-500"}>{off ? "○" : "◉"}</span>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200">
          Filtros de legenda
        </summary>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
            <span className="text-neutral-200">
              {DEFAULT_NAME} <span className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">Padrão</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setFilter(DEFAULT_NAME);
                setHidden(new Set());
              }}
              className="text-neutral-400 hover:text-neutral-200"
            >
              Usar
            </button>
          </div>
          {filters.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-200">
                {f.name}
                {f.name === defName && <span className="ml-1 text-neutral-500">★</span>}
                <span className="block truncate text-[10px] text-neutral-500">
                  {f.series.map((id) => byId.get(id)?.label ?? id).join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" onClick={() => { setFilter(f.name); setHidden(new Set()); }} className="text-neutral-400 hover:text-neutral-200">
                  Usar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(f.name);
                    setFormName(f.name);
                    setFormSet(new Set(f.series));
                    setFormOpen(true);
                  }}
                  className="text-neutral-400 hover:text-neutral-200"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...f.series] as SeriesId[];
                    persist([...filters.filter((x) => x.name !== f.name), { name: `${f.name} (cópia)`, series: next }], defName);
                  }}
                  className="text-neutral-400 hover:text-neutral-200"
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (defName === f.name) return;
                    if (!confirm(`Apagar o filtro "${f.name}"?`)) return;
                    persist(
                      filters.filter((x) => x.name !== f.name),
                      defName
                    );
                    if (filter === f.name) setFilter(DEFAULT_NAME);
                  }}
                  title={defName === f.name ? "O padrão não se apaga: escolhe outro padrão primeiro" : "Apagar com confirmação"}
                  className="text-neutral-400 hover:text-red-300"
                >
                  Apagar
                </button>
                {defName !== f.name && (
                  <button
                    type="button"
                    onClick={() => persist(filters, f.name)}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    Padrão
                  </button>
                )}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormName("");
              setFormSet(new Set(ALL));
              setFormOpen(true);
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            + Novo filtro
          </button>
          {formOpen && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nome do filtro…"
                maxLength={30}
                className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500"
              />
              {cats.map((cat) => (
                <div key={cat} className="mb-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{cat}</p>
                  <div className="flex flex-wrap gap-1">
                    {defs
                      .filter((d) => d.cat === cat)
                      .map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleForm(d.id)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                            formSet.has(d.id)
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                              : "border-neutral-800 text-neutral-500"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setFormSet(new Set(ALL))} className="text-xs text-neutral-400 hover:text-neutral-200">
                  Selecionar tudo
                </button>
                <button type="button" onClick={() => setFormSet(new Set())} className="text-xs text-neutral-400 hover:text-neutral-200">
                  Limpar
                </button>
                <span className="flex-1" />
                <button type="button" onClick={() => setFormOpen(false)} className="text-xs text-neutral-400 hover:text-neutral-200">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveForm}
                  disabled={formName.trim() === "" || formSet.size === 0}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
