// The widgets on the Dashboard follow an order you arrange by hand. It is kept
// as a list of item keys, and widgets that are not in it (a game that just went
// live) go after the ones that are, in their usual order.
export function sortByOrder(keys: string[], order: string[]): string[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  // The sort is stable, so widgets without a rank keep their usual order.
  return [...keys].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
}

export type Move = "first" | "earlier" | "later";

// The new order after moving `key`, or null if it can't move that way.
export function moveKey(sorted: string[], key: string, to: Move): string[] | null {
  const from = sorted.indexOf(key);
  const target = to === "first" ? 0 : to === "earlier" ? from - 1 : from + 1;
  if (from < 0 || target < 0 || target >= sorted.length || target === from) return null;
  const next = [...sorted];
  next.splice(from, 1);
  next.splice(target, 0, key);
  return next;
}
