// Europe/Lisbon wall time helpers (client-safe, pure). The server runs in
// UTC, so datetime-local values ("2026-09-25T11:00", no zone) must be
// converted with Lisbon's offset HERE, or every kickoff shifts an hour.

function lisbonParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

// Lisbon offset at an instant, in ms (added to UTC gives wall time).
function lisbonOffsetMs(utcMs: number): number {
  const wall = lisbonParts(new Date(utcMs));
  const asUtc = Date.UTC(
    Number(wall.year),
    Number(wall.month) - 1,
    Number(wall.day),
    Number(wall.hour) === 24 ? 0 : Number(wall.hour),
    Number(wall.minute)
  );
  return asUtc - utcMs;
}

// Stored ISO instant -> "YYYY-MM-DDTHH:MM" Lisbon wall (for datetime inputs).
export function lisbonWallInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const w = lisbonParts(d);
  const hour = w.hour === "24" ? "00" : w.hour;
  return `${w.year}-${w.month}-${w.day}T${hour}:${w.minute}`;
}

// "YYYY-MM-DDTHH:MM" Lisbon wall -> ISO instant, or null when unparseable.
export function lisbonISOFromInput(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes converge across DST edges.
  const instant = guess - lisbonOffsetMs(guess - lisbonOffsetMs(guess));
  const d = new Date(instant);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
