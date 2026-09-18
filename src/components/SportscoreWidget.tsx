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
      {/* Fixed to the exact visible height (not the widget's full ~900px,
          which would look absurdly tall and narrow at 3-per-row widths)
          with scrolling="no", so it shows a clean crop of just the
          scoreboard header — no scrollbar, nothing cut off mid-image. */}
      <iframe
        src={`https://sportscore.com/embed/match/football/${slug}/`}
        scrolling="no"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`${homeTeam} vs ${awayTeam}`}
        className="h-48 w-full border-0"
        style={{ overflow: "hidden" }}
      />
    </div>
  );
}
