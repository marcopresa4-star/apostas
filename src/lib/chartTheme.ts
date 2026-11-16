// One look for every chart: same grid, axis text, reference lines, cursor and
// tooltip surface, so the SVG charts read as a single family. Series colours
// follow the app's colour language (see globals.css, "colour language").
export const CHART = {
  grid: "rgba(255,255,255,0.07)",
  axis: "#96a3bb", // axis labels (same value as text-neutral-500 after the contrast bump)
  axisDim: "#7f8ba3",
  ref: "rgba(255,255,255,0.3)", // dashed reference lines
  cursor: "rgba(255,255,255,0.4)",
  dotRing: "#04070d", // matches the page background so dots look "cut out"
  // Series
  home: "#34d399", // emerald: the side we look at first
  away: "#38bdf8", // sky: the opponent / neutral information
  homeSoft: "#064e3b",
  awaySoft: "#0c4a6e",
  pos: "#34d399",
  neg: "#f87171",
  warn: "#fbbf24",
  scored: "#3987e5",
  conceded: "#d95926",
} as const;

// Hover tooltip surface shared by all charts (a Tailwind class string).
export const TOOLTIP_CLASS =
  "pointer-events-none absolute z-10 min-w-44 max-w-60 rounded-lg border border-white/[0.12] bg-[#0a1019]/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md";
