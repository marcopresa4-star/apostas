// Server-only reads of SofaScore's JSON API through the local CloakBrowser
// scraper (phase 1 of "SofaScore only": history for the model tabs). The app
// never calls SofaScore directly (Cloudflare 403s datacenter fetch); the
// scraper calls the same endpoints the SofaScore page calls, with clearance.
// Scraper offline -> throws ScraperOffline. Import from server code only:
// it uses a non-public env var and must never ship to the browser.
import "server-only";

const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export class ScraperOffline extends Error {
  constructor() {
    super("Scraper SofaScore desligado (scraper/npm start).");
  }
}

// The scraper is running but SofaScore is refusing its calls (Cloudflare 403,
// clearance expired). Nothing the app can fix: someone has to solve the
// challenge in the scraper's browser window. Extends ScraperOffline so every
// caller that already falls back to cache keeps doing it; pages that can tell
// the difference (Ao vivo) word the notice from this class.
export class ScraperBlocked extends ScraperOffline {
  constructor() {
    super();
    this.message = "O SofaScore está a recusar leituras (sessão Cloudflare expirada).";
    this.name = "ScraperBlocked";
  }
}

function encodeQuery(params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `?${q}` : "";
}

// GET /api/v1{path} through the scraper's /raw passthrough (local dev only).
// Returns null on 404 (unknown id, round past the end...), throws
// ScraperOffline when the scraper cannot be reached. opts.low marks background
// reads (bots monitoring): the scraper queues them behind the slots reserved
// for page views, so a long bot scan never starves the boards.
export async function sofaRaw<T = unknown>(
  path: string,
  params: Record<string, string> = {},
  opts: { low?: boolean } = {}
): Promise<T | null> {
  let raw: Response;
  try {
    raw = await fetch(
      `${SCRAPER}/raw?path=${encodeURIComponent(path)}${encodeQuery(params).replace(/^\?/, "&")}${opts.low ? "&low=1" : ""}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      }
    );
  } catch {
    throw new ScraperOffline();
  }
  if (raw.status === 404) return null;
  if (!raw.ok) {
    if (raw.status === 502) {
      const body = (await raw.json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === "blocked") throw new ScraperBlocked();
    }
    throw new Error(`SofaScore raw ${path} falhou (${raw.status}).`);
  }
  return (await raw.json()) as T;
}
