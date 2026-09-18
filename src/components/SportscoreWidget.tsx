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
    <div className="h-48 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <iframe
        src={`https://sportscore.com/embed/match/football/${slug}/`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`${homeTeam} vs ${awayTeam}`}
        className="h-[820px] w-full border-0"
      />
    </div>
  );
}
