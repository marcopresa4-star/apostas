// Best-effort integration with SofaScore's undocumented internal API.
// There is no official public API, so this can break or change shape at any
// time — every caller must treat a null result as "fall back to the
// kickoff-time heuristic in matchStatus.ts", never as an error to surface.

export type SofascoreStatus = "notstarted" | "inprogress" | "finished" | "unknown";

export interface SofascoreLiveData {
  status: SofascoreStatus;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

// SofaScore match URLs carry the numeric event id somewhere in the path or
// fragment (e.g. ".../team-a-team-b/AbCdEf#id:12345678" or ".../match/12345678").
// Taking the last long digit run in the URL covers both shapes.
export function extractSofascoreEventId(url: string): string | null {
  const matches = url.match(/\d{6,}/g);
  if (!matches) return null;
  return matches[matches.length - 1];
}

export async function fetchSofascoreLiveData(sofascoreUrl: string): Promise<SofascoreLiveData | null> {
  const eventId = extractSofascoreEventId(sofascoreUrl);
  if (!eventId) return null;

  try {
    const res = await fetch(`https://api.sofascore.com/api/v1/event/${eventId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const event = json?.event;
    if (!event) return null;

    const rawStatus = event.status?.type;
    const status: SofascoreStatus =
      rawStatus === "inprogress" || rawStatus === "notstarted" || rawStatus === "finished"
        ? rawStatus
        : "unknown";

    let minute: number | null = null;
    if (status === "inprogress" && event.time?.currentPeriodStartTimestamp) {
      const elapsedInPeriod = Date.now() / 1000 - event.time.currentPeriodStartTimestamp;
      // A period1 score already means the 2nd half is running — SofaScore
      // resets the period timestamp at half-time, so add the ~45' back on.
      const secondHalf = event.homeScore?.period1 !== undefined && event.awayScore?.period1 !== undefined;
      minute = Math.max(0, Math.floor(elapsedInPeriod / 60) + (secondHalf ? 45 : 0));
    }

    return {
      status,
      minute,
      homeScore: typeof event.homeScore?.current === "number" ? event.homeScore.current : null,
      awayScore: typeof event.awayScore?.current === "number" ? event.awayScore.current : null,
    };
  } catch {
    return null;
  }
}
