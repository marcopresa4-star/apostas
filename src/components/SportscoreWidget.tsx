"use client";

import { useEffect, useState } from "react";
import { slugify } from "@/lib/slugify";
import SportscoreExtras from "./SportscoreExtras";

// Free, self-service embeddable match widget (no account/API key) — see
// https://sportscore.com/embed/. It identifies teams by its own slugs, which
// rarely match the names typed here, so the slug is resolved first through
// /api/sportscore/resolve (it tries name variants until Sportscore knows the
// match). `homeAliases`/`awayAliases` are other names the team goes by.
//
// Only the server can check slugs (Sportscore sends no CORS headers), and its
// host may be turned away by Cloudflare. When that happens the widget falls
// back to the plain slug from the typed names, which the browser loads by
// itself and which is exactly what worked before the resolver existed.
type Resolved = {
  key: string;
  slug: string | null;
  blocked?: boolean;
  homeSlug?: string | null;
  awaySlug?: string | null;
  competitionSlug?: string | null;
};

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

  const homeNames = [homeTeam, ...homeAliases].join("|");
  const awayNames = [awayTeam, ...awayAliases].join("|");
  const key = `${homeNames}~${awayNames}`;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ home: homeNames, away: awayNames });
    fetch(`/api/sportscore/resolve?${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { slug: null, blocked: true }))
      .then((data: Omit<Resolved, "key">) => setResolved({ key, ...data }))
      .catch((err) => {
        if (err.name !== "AbortError") setResolved({ key, slug: null, blocked: true });
      });
    return () => controller.abort();
  }, [key, homeNames, awayNames]);

  const current = resolved?.key === key ? resolved : null;
  const slug = current?.blocked
    ? `${slugify(homeTeam)}-vs-${slugify(awayTeam)}`
    : current
      ? current.slug
      : undefined;
  // When the server could not check anything the teams are looked up by their
  // typed names too, and there is no way to know the league's slug.
  const homeSlug = current?.blocked ? slugify(homeTeam) : (current?.homeSlug ?? null);
  const awaySlug = current?.blocked ? slugify(awayTeam) : (current?.awaySlug ?? null);
  const competitionSlug = current?.blocked ? null : (current?.competitionSlug ?? null);

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
          <SportscoreExtras
            matchSlug={slug}
            homeSlug={homeSlug}
            awaySlug={awaySlug}
            competitionSlug={competitionSlug}
            homeName={homeTeam}
            awayName={awayTeam}
          />
        </>
      ) : (
        <div className="px-4 py-10 text-center text-sm text-neutral-400">
          <p className="font-medium text-neutral-200">
            {homeTeam} vs {awayTeam}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {!current
              ? "A procurar o jogo..."
              : "Não encontrei este jogo no Sportscore. Pode ainda não estar listado, ou o nome da equipa é muito diferente do do site."}
          </p>
        </div>
      )}
    </div>
  );
}
