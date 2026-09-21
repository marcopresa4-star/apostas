// Manual adjustments for what the goals model cannot know: players missing,
// short rest, motivation. Each one turns into a factor on the team's strength.
//
// There is no data here to test the size of any of them (unlike the model
// itself, which was tested on 2025/26), so the numbers below are rough
// estimates and are shown on the page so they can be judged, and overridden
// with "Outro ajuste".

export type Motivation = "low" | "normal" | "high";

export interface TeamAdjust {
  injuries: number; // important players injured
  suspensions: number; // important players suspended
  restDays: number | null; // days since the last game; null = not filled in
  motivation: Motivation;
  other: number; // free adjustment, in percent
}

export const NO_ADJUST: TeamAdjust = {
  injuries: 0,
  suspensions: 0,
  restDays: null,
  motivation: "normal",
  other: 0,
};

export const EFFECTS = {
  // Every important player missing takes this share off the team's strength...
  perAbsence: 0.04,
  // ...up to this many, so a long list does not send the team to zero.
  maxAbsences: 6,
  // From fewer days of rest than this, each day short costs this much.
  fullRestDays: 5,
  perRestDayShort: 0.015,
  lowMotivation: 0.95,
  highMotivation: 1.05,
  maxOther: 30,
} as const;

export interface Part {
  label: string;
  factor: number;
}

// What each thing filled in does, only those that do something.
export function parts(a: TeamAdjust): Part[] {
  const out: Part[] = [];
  // A missing player counts the same whether injured or suspended, so they are
  // added up before being turned into a factor.
  const missing = a.injuries + a.suspensions;
  if (missing > 0) {
    const counted = Math.min(missing, EFFECTS.maxAbsences);
    const said = [
      a.injuries > 0 ? `${a.injuries} ${a.injuries === 1 ? "lesão" : "lesões"}` : "",
      a.suspensions > 0 ? `${a.suspensions} ${a.suspensions === 1 ? "castigo" : "castigos"}` : "",
    ].filter(Boolean);
    out.push({
      label: `${said.join(" e ")}${missing > counted ? ` (contam ${counted})` : ""}`,
      factor: 1 - EFFECTS.perAbsence * counted,
    });
  }
  if (a.restDays !== null && a.restDays < EFFECTS.fullRestDays) {
    // The same day of rest can only be short by so much: 0 days is not a game.
    const short = EFFECTS.fullRestDays - Math.max(1, a.restDays);
    out.push({
      label: `${a.restDays} ${a.restDays === 1 ? "dia" : "dias"} de descanso`,
      factor: 1 - EFFECTS.perRestDayShort * short,
    });
  }
  if (a.motivation === "low") out.push({ label: "motivação baixa", factor: EFFECTS.lowMotivation });
  if (a.motivation === "high") out.push({ label: "motivação alta", factor: EFFECTS.highMotivation });

  const other = Math.max(-EFFECTS.maxOther, Math.min(EFFECTS.maxOther, a.other));
  if (other !== 0) out.push({ label: `outro (${other > 0 ? "+" : ""}${other}%)`, factor: 1 + other / 100 });
  return out;
}

// The team's strength relative to its usual: 1 = no change.
export function teamFactor(a: TeamAdjust): number {
  return parts(a).reduce((product, p) => product * p.factor, 1);
}

export function isAdjusted(home: TeamAdjust, away: TeamAdjust): boolean {
  return parts(home).length > 0 || parts(away).length > 0;
}

// What the model is scaled by: the home side's goals go up by this ratio and
// the away side's down by it. Only the difference between the teams matters,
// so the same problem on both sides (or the same short rest) cancels out.
export function strengthRatio(home: TeamAdjust, away: TeamAdjust): number {
  return teamFactor(home) / teamFactor(away);
}

// The fields of the adjustments form, as they travel in the address.
export const ADJUST_KEYS = [
  "lesoes_casa",
  "lesoes_fora",
  "castigos_casa",
  "castigos_fora",
  "descanso_casa",
  "descanso_fora",
  "motivacao_casa",
  "motivacao_fora",
  "outro_casa",
  "outro_fora",
] as const;

function clampInt(value: string | undefined, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

// Reads one team's adjustments from the address parameters. Anything that is
// not a number, or out of range, is ignored or brought back into range: the
// address can be edited by hand.
export function adjustFromParams(params: Record<string, string | undefined>, side: "casa" | "fora"): TeamAdjust {
  const rest = Number.parseInt(params[`descanso_${side}`] ?? "", 10);
  const motivation: Motivation =
    params[`motivacao_${side}`] === "baixa" ? "low" : params[`motivacao_${side}`] === "alta" ? "high" : "normal";
  return {
    injuries: clampInt(params[`lesoes_${side}`], 0, EFFECTS.maxAbsences),
    suspensions: clampInt(params[`castigos_${side}`], 0, EFFECTS.maxAbsences),
    restDays: Number.isFinite(rest) ? Math.min(30, Math.max(0, rest)) : null,
    motivation,
    other: clampInt(params[`outro_${side}`], -EFFECTS.maxOther, EFFECTS.maxOther),
  };
}
