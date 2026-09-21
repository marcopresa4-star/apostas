"use client";

import { useEffect, useState } from "react";
import { slugify } from "@/lib/slugify";
import SportscoreTeach from "./SportscoreTeach";

// Free, self-service embeddable match widget (no account/API key) — see
// https://sportscore.com/embed/. It identifies teams by its own slugs, which
// rarely match the names typed here, so the slug is resolved first through
// /api/sportscore/resolve (it tries name variants until Sportscore knows the
// match). `homeAliases`/`awayAliases` are other names the team goes by.
//
// When no variant of the names works, what Sportscore calls the clubs can be
// taught by pasting the address of one of its match pages (SportscoreTeach).
// That is remembered per club, and comes back from the resolver as `hints`.
//
// Only the server can check slugs (Sportscore sends no CORS headers), and its
// host may be turned away by Cloudflare. When that happens the widget is built
// from what was taught, or else from the plain typed names, and loaded by the
// browser without any check.
interface Hints {
  home: string | null;
  away: string | null;
}
type Resolved = { key: string; slug: string | null; blocked?: boolean; hints?: Hints };

export default function SportscoreWidget({
  homeTeam,
  awayTeam,
  homeAliases = [],
  awayAliases = [],
}: {
  homeTeam: string;
  awayTeam: string;
  homeAliases?: string[];
  awayAliases?: string[];
}) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  // Bumped after teaching, to look the game up again.
  const [reload, setReload] = useState(0);
  const [teaching, setTeaching] = useState(false);

  const homeNames = [homeTeam, ...homeAliases].join("|");
  const awayNames = [awayTeam, ...awayAliases].join("|");
  const key = `${homeNames}~${awayNames}`;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ home: homeNames, away: awayNames });
    fetch(`/api/sportscore/resolve?${query}`, {
      signal: controller.signal,
      // The browser may hold an older answer for the same address.
      cache: reload > 0 ? "no-store" : "default",
    })
      .then((res) => (res.ok ? res.json() : { slug: null, blocked: true }))
      .then((data: Omit<Resolved, "key">) => {
        setResolved({ key, slug: data.slug, blocked: data.blocked, hints: data.hints });
        setTeaching(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setResolved({ key, slug: null, blocked: true });
      });
    return () => controller.abort();
  }, [key, homeNames, awayNames, reload]);

  const current = resolved?.key === key ? resolved : null;
  const slug = current?.blocked
    ? `${current.hints?.home ?? slugify(homeTeam)}-vs-${current.hints?.away ?? slugify(awayTeam)}`
    : current
      ? current.slug
      : undefined;

  const teach = (
    <SportscoreTeach
      homeNames={homeNames.split("|")}
      awayNames={awayNames.split("|")}
      onSaved={() => setReload((n) => n + 1)}
    />
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {slug ? (
        <>
          {/* Tall enough to fit the whole widget (scoreboard + 3D tracker +
              stats) without its own internal scroll. scrolling="no" stays on
              as a safety net in case a match has more stat rows than usual. */}
          <iframe
            src={`https://sportscore.com/embed/match/football/${slug}/`}
            scrolling="no"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`${homeTeam} vs ${awayTeam}`}
            className="h-[900px] w-full border-0"
            style={{ overflow: "hidden" }}
          />
          {/* With the server cut off nothing tells whether the widget loaded,
              so the way to fix it is always at hand. */}
          {current?.blocked && (
            <div className="border-t border-neutral-800 px-3 py-2">
              {teaching ? (
                teach
              ) : (
                <button
                  type="button"
                  onClick={() => setTeaching(true)}
                  className="text-xs text-neutral-500 hover:text-neutral-300 hover:underline"
                >
                  O widget não aparece? Ensinar o nome do jogo
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-neutral-400">
          <p className="font-medium text-neutral-200">
            {homeTeam} vs {awayTeam}
          </p>
          {!current ? (
            <p className="mt-1 text-xs text-neutral-500">A procurar o jogo...</p>
          ) : (
            <>
              <p className="mt-1 mb-4 text-xs text-neutral-500">
                Não encontrei este jogo no Sportscore. Pode ainda não estar listado, ou o nome da
                equipa é muito diferente do do site.
              </p>
              {teach}
            </>
          )}
        </div>
      )}
    </div>
  );
}
