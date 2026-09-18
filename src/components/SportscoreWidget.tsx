import { slugify } from "@/lib/slugify";

// Free, self-service embeddable match widget (no account/API key) — see
// https://sportscore.com/embed/. It resolves team-name slugs against its own
// database, so a wrong/unmatched slug just shows its own "not found" state
// rather than breaking anything here.
export default function SportscoreWidget({
  homeTeam,
  awayTeam,
}: {
  homeTeam: string;
  awayTeam: string;
}) {
  const slug = `${slugify(homeTeam)}-vs-${slugify(awayTeam)}`;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {/* Fixed to just the scoreboard header's natural height (teams,
          score, league name) — short enough to end before the 3D tracker
          starts, so nothing gets a half-cut preview. scrolling="no" plus
          overflow:hidden suppress the iframe's own (unstyleable,
          cross-origin) scrollbar entirely. */}
      <iframe
        src={`https://sportscore.com/embed/match/football/${slug}/`}
        scrolling="no"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`${homeTeam} vs ${awayTeam}`}
        className="h-36 w-full border-0"
        style={{ overflow: "hidden" }}
      />
    </div>
  );
}
