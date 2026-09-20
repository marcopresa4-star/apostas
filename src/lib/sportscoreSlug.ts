import { slugify } from "./slugify";

// Sportscore identifies teams by its own slugs ("fc-barcelona", "sporting-cp",
// "paris-saint-germain"), which rarely match what people type ("Barcelona",
// "Sporting", "PSG"). We can't list its slugs (the sitemap and search sit
// behind Cloudflare), so we generate likely variants of each name and let the
// resolver probe them against the embed, which answers 404 for unknown slugs.

// Everyday short names -> the slugs Sportscore is likely to use, best guess first.
const KNOWN: Record<string, string[]> = {
  "man-united": ["manchester-united"],
  "man-utd": ["manchester-united"],
  "man-city": ["manchester-city"],
  spurs: ["tottenham-hotspur"],
  tottenham: ["tottenham-hotspur"],
  wolves: ["wolverhampton-wanderers"],
  newcastle: ["newcastle-united"],
  "west-ham": ["west-ham-united"],
  leeds: ["leeds-united"],
  brighton: ["brighton-hove-albion"],
  leicester: ["leicester-city"],
  "nott-m-forest": ["nottingham-forest"],
  "nottm-forest": ["nottingham-forest"],
  nottingham: ["nottingham-forest"],
  forest: ["nottingham-forest"],
  psg: ["paris-saint-germain"],
  paris: ["paris-saint-germain"],
  lyon: ["olympique-lyonnais", "olympique-lyon"],
  bayern: ["fc-bayern-munich", "fc-bayern-munchen", "bayern-munich"],
  "bayern-munich": ["fc-bayern-munich", "fc-bayern-munchen"],
  "bayern-munchen": ["fc-bayern-munich", "fc-bayern-munchen"],
  dortmund: ["borussia-dortmund"],
  leverkusen: ["bayer-04-leverkusen", "bayer-leverkusen"],
  gladbach: ["borussia-monchengladbach"],
  inter: ["internazionale", "inter-milan"],
  milan: ["ac-milan"],
  juve: ["juventus"],
  napoli: ["ssc-napoli"],
  roma: ["as-roma"],
  lazio: ["ss-lazio"],
  atletico: ["atletico-madrid"],
  "atl-madrid": ["atletico-madrid"],
  athletic: ["athletic-club"],
  "athletic-bilbao": ["athletic-club"],
  betis: ["real-betis"],
  lille: ["losc-lille"],
  monaco: ["as-monaco"],
  nice: ["ogc-nice"],
  rennes: ["stade-rennais"],
  leipzig: ["rb-leipzig"],
  frankfurt: ["eintracht-frankfurt"],
  stuttgart: ["vfb-stuttgart"],
  barca: ["fc-barcelona"],
  barcelona: ["fc-barcelona"],
  real: ["real-madrid"],
  sporting: ["sporting-cp"],
  "sporting-lisboa": ["sporting-cp"],
  benfica: ["sl-benfica"],
  porto: ["fc-porto"],
  ajax: ["afc-ajax"],
  psv: ["psv-eindhoven"],
  // Sportscore tags Brazilian clubs with their state.
  flamengo: ["flamengo-rj"],
  fluminense: ["fluminense-rj"],
  botafogo: ["botafogo-rj"],
  palmeiras: ["palmeiras-sp"],
  corinthians: ["corinthians-sp"],
  "sao-paulo": ["sao-paulo-sp"],
  gremio: ["gremio-rs"],
  internacional: ["internacional-rs"],
  cruzeiro: ["cruzeiro-mg"],
};

// Prefixes/suffixes clubs are commonly written with or without.
const CLUB_TOKENS = new Set([
  "fc", "cf", "sc", "ac", "afc", "cd", "ud", "sl", "sv", "fk", "ss", "ssc", "us", "as", "rc",
  "rcd", "cs", "sk", "if", "bk", "fsv", "vfb", "vfl", "tsg", "club",
]);

const WORD_SWAPS: Record<string, string> = {
  man: "manchester",
  utd: "united",
  munich: "munchen",
  st: "saint",
};

// Marks a reserve, youth or women's side: "Porto B", "Arsenal W", "Ajax U21".
const SIDE_TOKENS = /^(b|c|ii|iii|w|women|womens|youth|reserves|res|jr|u\d{2})$/;

const MAX_PER_TEAM = 8;

function coreTokens(slug: string): string[] {
  let tokens = slug.split("-").filter(Boolean);
  while (tokens.length > 1 && CLUB_TOKENS.has(tokens[0])) tokens = tokens.slice(1);
  while (tokens.length > 1 && CLUB_TOKENS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  return tokens;
}

function variantsOf(name: string): string[] {
  const base = slugify(name);
  if (!base) return [];

  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };

  for (const known of KNOWN[base] ?? []) add(known);
  add(base);

  const swapped = base.split("-").map((t) => WORD_SWAPS[t] ?? t);
  add(swapped.join("-"));

  // Same name without its FC/CF/... decoration, then with the common ones put back.
  const core = coreTokens(base).join("-");
  add(core);
  for (const known of KNOWN[core] ?? []) add(known);
  add(`fc-${core}`);
  add(`${core}-fc`);
  add(`${core}-cf`);

  return out;
}

// Variants for a team given its display name plus any other names it goes by
// (the teams table keeps these in `aliases`, separated by " | "). The name
// itself comes first so its variants get probed before the aliases'.
export function slugCandidates(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const v of variantsOf(name)) if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_PER_TEAM);
}

// Home x away slug pairs, most likely first: a pair's rank is the sum of its
// two positions, so (0,0) goes first and (0,1)/(1,0) before (1,1).
export function pairCandidates(
  home: string[],
  away: string[]
): { home: string; away: string }[] {
  const pairs: { home: string; away: string; rank: number }[] = [];
  home.forEach((h, i) => away.forEach((a, j) => pairs.push({ home: h, away: a, rank: i + j })));
  pairs.sort((x, y) => x.rank - y.rank);
  return pairs.map(({ home: h, away: a }) => ({ home: h, away: a }));
}

// Sportscore answers 200 for some slugs that belong to a different team (its
// "porto" is the reserve side, "Porto B"), so once a slug works, the team
// names the embed displays are checked against what was asked for. Names match
// when they are the same club minus FC/CF decoration, or one contains the
// other ("Athletic Club" / "Athletic Bilbao") without the extra words marking
// a reserve, youth or women's side.
function sameTeam(displayed: string, variants: string[]): boolean {
  const shown = coreTokens(slugify(displayed));
  if (shown.length === 0) return false;
  return variants.some((variant) => {
    const want = coreTokens(variant);
    const [small, big] = shown.length <= want.length ? [shown, want] : [want, shown];
    if (!small.every((t) => big.includes(t))) return false;
    return big.filter((t) => !small.includes(t)).every((t) => !SIDE_TOKENS.test(t));
  });
}

// `displayed` are the two team names in the embed, in either order.
export function teamsMatch(
  displayed: [string, string],
  homeVariants: string[],
  awayVariants: string[]
): boolean {
  const [a, b] = displayed;
  return (
    (sameTeam(a, homeVariants) && sameTeam(b, awayVariants)) ||
    (sameTeam(a, awayVariants) && sameTeam(b, homeVariants))
  );
}
