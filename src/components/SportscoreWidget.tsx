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
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
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
    </div>
  );
}
