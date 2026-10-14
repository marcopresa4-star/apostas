"use client";

import { useEffect, useState } from "react";
import { slugify } from "@/lib/slugify";

interface MiniRow {
  table: string;
  position: number;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

const FORM_CLS = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

function Dots({ form }: { form: ("V" | "E" | "D")[] }) {
  if (form.length === 0) return null;
  return (
    <span className="inline-flex gap-0.5">
      {form.map((r, i) => (
        <span key={i} className={`flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-bold text-white ${FORM_CLS[r]}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

// Mini standings for a pinned live game: the two sides highlighted on top,
// then the table (top 8 plus both teams wherever they sit). Team matching is
// best-effort (exact, slug, unique containment): unmatched sides show the
// table without highlight, never a wrong team.
export default function PinnedMiniTable({
  eventId,
  homeName,
  awayName,
  formHome,
  formAway,
}: {
  eventId: number;
  homeName: string;
  awayName: string;
  formHome: ("V" | "E" | "D")[];
  formAway: ("V" | "E" | "D")[];
}) {
  const [rows, setRows] = useState<MiniRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch(`/api/sofascore/minitable?id=${eventId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { rows?: MiniRow[] } | null) => {
        if (stop) return;
        if (body && Array.isArray(body.rows)) setRows(body.rows);
        else setFailed(true);
      })
      .catch(() => {
        if (!stop) setFailed(true);
      });
    return () => {
      stop = true;
    };
  }, [eventId]);

  if (failed) return <p className="mt-2 text-[11px] text-neutral-500">Sem tabela para este jogo.</p>;
  if (rows === null) return <p className="mt-2 text-[11px] text-neutral-500">A ler a tabela…</p>;
  if (rows.length === 0) return <p className="mt-2 text-[11px] text-neutral-500">Sem tabela para este jogo.</p>;

  const match = (name: string): MiniRow | null => {
    const exact = rows.find((r) => r.team === name);
    if (exact) return exact;
    const needle = slugify(name);
    const slugHit = rows.find((r) => slugify(r.team) === needle);
    if (slugHit) return slugHit;
    const cands = rows.filter((r) => {
      const s = slugify(r.team);
      return s.includes(needle) || needle.includes(s);
    });
    return cands.length === 1 ? cands[0] : null;
  };
  const hm = match(homeName);
  const am = match(awayName);

  const card = (name: string, m: MiniRow | null, form: ("V" | "E" | "D")[], tone: string) => (
    <div className="min-w-0 flex-1 rounded-lg bg-neutral-900 px-3 py-2">
      <p className="truncate text-xs font-semibold text-neutral-100">{name}</p>
      {m ? (
        <>
          <p className="mt-0.5 tabular-nums">
            <span className={`text-lg font-bold ${tone}`}>{m.position}º</span>{" "}
            <span className="text-sm font-semibold text-neutral-200">{m.points} pts</span>
          </p>
          <p className="text-[10px] tabular-nums text-neutral-500">
            {m.wins}V {m.draws}E {m.losses}D · DG {m.goalsFor - m.goalsAgainst >= 0 ? "+" : ""}
            {m.goalsFor - m.goalsAgainst}
          </p>
          <div className="mt-1">
            <Dots form={form} />
          </div>
        </>
      ) : (
        <p className="mt-0.5 text-[11px] text-neutral-500">Fora da tabela lida</p>
      )}
    </div>
  );

  const top = rows.filter((r) => r.position >= 1).sort((a, b) => a.position - b.position);
  const shown = top;

  return (
    <div className="mt-2 border-t border-neutral-800 pt-2">
      <div className="flex gap-2">
        {card(homeName, hm, formHome, "text-sky-300")}
        <div className="flex shrink-0 flex-col items-center justify-center px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          <span>{hm && am ? Math.abs(hm.points - am.points) : "–"}</span>
          <span>pts</span>
        </div>
        {card(awayName, am, formAway, "text-orange-300")}
      </div>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg bg-neutral-900">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-neutral-500">
              <th className="px-2 py-1 text-right font-semibold">#</th>
              <th className="px-2 py-1 text-left font-semibold">Equipa</th>
              <th className="px-2 py-1 text-center font-semibold">J</th>
              <th className="px-2 py-1 text-center font-semibold">V</th>
              <th className="px-2 py-1 text-center font-semibold">E</th>
              <th className="px-2 py-1 text-center font-semibold">D</th>
              <th className="px-2 py-1 text-center font-semibold">Golos</th>
              <th className="px-2 py-1 text-center font-semibold">DG</th>
              <th className="px-2 py-1 text-right font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60">
            {shown.map((r) => {
              const hl = (hm && r.team === hm.team) || (am && r.team === am.team);
              return (
                <tr key={`${r.position}-${r.team}`} className={hl ? "bg-emerald-500/10 font-semibold text-neutral-100" : "text-neutral-400"}>
                  <td className="px-2 py-1 text-right tabular-nums">{r.position}</td>
                  <td className="max-w-32 truncate px-2 py-1">{r.team}</td>
                  <td className="px-2 py-1 text-center tabular-nums">{r.played}</td>
                  <td className="px-2 py-1 text-center tabular-nums">{r.wins}</td>
                  <td className="px-2 py-1 text-center tabular-nums">{r.draws}</td>
                  <td className="px-2 py-1 text-center tabular-nums">{r.losses}</td>
                  <td className="px-2 py-1 text-center tabular-nums">
                    {r.goalsFor}:{r.goalsAgainst}
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums">
                    {r.goalsFor - r.goalsAgainst >= 0 ? "+" : ""}
                    {r.goalsFor - r.goalsAgainst}
                  </td>
                  <td className="px-2 py-1 text-right font-bold tabular-nums text-neutral-100">{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
