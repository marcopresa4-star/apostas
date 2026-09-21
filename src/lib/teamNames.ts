// The same club is written differently from one season to the next in the free
// data ("SL Benfica" then, "Sport Lisboa e Benfica" now), so its old games would
// not be found under today's name. This maps an old name to the current one when
// exactly one current club fits it, and leaves it alone otherwise: a missed link
// only hides old games, a wrong one would mix two clubs up.

// Words that are decoration of a club's name, not part of what it is called.
const NOISE = new Set([
  "fc", "cf", "sc", "ac", "afc", "cd", "ud", "sl", "sv", "fk", "ss", "ssc", "us", "as", "rc", "rcd", "cs",
  "sk", "if", "bk", "fsv", "vfb", "vfl", "tsg", "sd", "ca", "club", "de", "da", "do", "dos", "e", "la", "el",
  "the", "sport", "calcio", "1", "04", "05", "1846", "1899", "1909", "1910", "1913", "1919", "1903", "1948",
]);

function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t));
}

// Names the word matching cannot settle ("Sporting" also fits the club of Braga).
const KNOWN: Record<string, string> = {
  "Sporting CP": "Sporting Clube de Portugal",
};

const within = (small: string[], big: string[]) => small.length > 0 && small.every((t) => big.includes(t));

// Returns a function turning any name into the current one it stands for, or
// itself when it is already current or no single current name fits.
export function canonicalNames(current: string[]): (name: string) => string {
  const known = new Set(current);
  const cores = current.map((name) => ({ name, core: tokens(name) }));
  const cache = new Map<string, string>();
  return (name: string) => {
    if (known.has(name)) return name;
    if (KNOWN[name] && known.has(KNOWN[name])) return KNOWN[name];
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    const mine = tokens(name);
    const fits = cores.filter(({ core }) => within(mine, core) || within(core, mine));
    const result = fits.length === 1 ? fits[0].name : name;
    cache.set(name, result);
    return result;
  };
}
