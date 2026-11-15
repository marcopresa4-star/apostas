// One hand-picked set of line icons (24px grid, 1.7 stroke) so the whole app
// speaks the same visual language instead of mixing system emojis.
export const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  live: "M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14",
  broadcast: "M3 7h18v12H3zM8 3l4 4 4-4",
  layout: "M3 4h8v16H3zM14 4h7v7h-7zM14 14h7v6h-7z",
  scale: "M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  rounds: "M5 5h14M5 10h14M5 15h9M5 20h6",
  calc: "M5 3h14v18H5zM8 7h8M8 12h2M14 12h2M8 16h2M14 16h2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bot: "M5 8h14v11H5zM12 4v4M9 13h.01M15 13h.01M9 16.5h6",
  plan: "M9 4h6v3H9zM6 5H5v16h14V5h-1M9 12h6M9 16h4",
  note: "M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5",
  gem: "M6 3h12l4 6-10 12L2 9zM2 9h20M9 3l-2 6 5 12 5-12-2-6",
  sparkle: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z",
  dice: "M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  tree: "M12 2l-5 7h3l-4 6h4l-3 5h14l-3-5h4l-4-6h3zM12 20v2",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  logout: "M9 4H4v16h5M16 8l4 4-4 4M20 12H9",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6L6 18",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  ball: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8l3.5 2.5-1.3 4H9.8l-1.3-4zM12 8V3M15.5 10.5L20 9M14.2 14.5L17 18M9.8 14.5L7 18M8.5 10.5L4 9",
  news: "M4 5h13v14H4zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7",
  panel: "M4 4h16v16H4zM9 4v16",
  arrow: "M5 12h14M13 6l6 6-6 6",
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
