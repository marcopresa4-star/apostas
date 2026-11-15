"use client";

import { useEffect } from "react";

// React tags every host element it hydrated with an internal fiber key. Writing
// --mx/--my before that — a page still streaming in, while the layout's effect
// is already listening — makes the client DOM differ from the server HTML and
// shows up as a hydration mismatch.
function hydrated(el: Element): boolean {
  return Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
}

// Feeds the cursor position (relative to the hovered tile) into --mx/--my so
// the CSS can paint a soft light that follows the mouse. Only .tile paints it
// (globals.css), so nothing else is touched.
export default function Spotlight() {
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const card = target.closest<HTMLElement>(".tile");
      if (!card) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!hydrated(card)) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
