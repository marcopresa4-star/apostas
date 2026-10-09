import type { PlayedMatch } from "./footballModel";

// Recent-form rows for one team (last played games, most recent first),
// with half-time scores for the HT chips and comeback tags. Client-safe.
export interface FormRow {
  date: string;
  venue: "H" | "A";
  opp: string;
  hg: number;
  ag: number;
  hh: number | null;
  ha: number | null;
  gf: number;
  ga: number;
}

export function formRows(team: string, matches: PlayedMatch[], n = 10): FormRow[] {
  return matches
    .filter((m) => m.ft !== null && (m.team1 === team || m.team2 === team))
    .slice(-n)
    .reverse()
    .map((m) => {
      const home = m.team1 === team;
      const [hg, ag] = m.ft as [number, number];
      return {
        date: m.date,
        venue: home ? "H" : "A",
        opp: home ? m.team2 : m.team1,
        hg,
        ag,
        hh: m.ht ? m.ht[0] : null,
        ha: m.ht ? m.ht[1] : null,
        gf: home ? hg : ag,
        ga: home ? ag : hg,
      };
    });
}

export type FormResult = "V" | "E" | "D";

export function resultOf(gf: number, ga: number): FormResult {
  return gf > ga ? "V" : gf < ga ? "D" : "E";
}

// Special tags from the team's point of view. Null HT scores tag nothing.
export function formTags(r: FormRow): ("Reviravolta" | "Vantagem perdida")[] {
  if (r.hh === null || r.ha === null) return [];
  const hf = r.venue === "H" ? r.hh : r.ha;
  const ha = r.venue === "H" ? r.ha : r.hh;
  const out: ("Reviravolta" | "Vantagem perdida")[] = [];
  if (hf < ha && r.gf > r.ga) out.push("Reviravolta");
  if (hf > ha && r.gf <= r.ga) out.push("Vantagem perdida");
  return out;
}

export function formAverages(rows: FormRow[]): { scored: number; conceded: number; over: number } | null {
  if (rows.length === 0) return null;
  const scored = rows.reduce((s, r) => s + r.gf, 0) / rows.length;
  const conceded = rows.reduce((s, r) => s + r.ga, 0) / rows.length;
  const over = rows.filter((r) => r.hg + r.ag > 2.5).length / rows.length;
  return { scored, conceded, over };
}
