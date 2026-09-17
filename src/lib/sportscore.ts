import { slugify } from "./slugify";

// Best-effort scrape of sportscore.com's public embed widget (the same one
// used for the Ao vivo agora cards) to get the real live status/minute/score
// for a match. There is no JSON API, so this parses the small, stable HTML
// the widget renders. If the page shape ever changes, every regex here
// simply fails to match and callers get null — never an error.
export interface SportscoreLiveData {
  isLive: boolean;
  minuteLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export async function fetchSportscoreLiveData(
  homeTeam: string,
  awayTeam: string
): Promise<SportscoreLiveData | null> {
  const slug = `${slugify(homeTeam)}-vs-${slugify(awayTeam)}`;

  try {
    const res = await fetch(`https://sportscore.com/embed/match/football/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 20 },
    });
    if (!res.ok && res.status !== 404) return null;

    const html = await res.text();

    const scoreMatch = html.match(/<div class="score">(\d+)<span class="sep">:<\/span>(\d+)<\/div>/);
    if (!scoreMatch) return null;

    const isLive = html.includes('data-is-live="1"');

    let minuteLabel: string | null = null;
    if (isLive) {
      const liveStatus = html.match(/<div class="status live">[\s\S]*?LIVE\s*·\s*([^<]+)<\/div>/);
      minuteLabel = liveStatus ? liveStatus[1].trim() : null;
    }

    return {
      isLive,
      minuteLabel,
      homeScore: Number(scoreMatch[1]),
      awayScore: Number(scoreMatch[2]),
    };
  } catch {
    return null;
  }
}
