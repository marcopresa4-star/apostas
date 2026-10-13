"use client";

import { useEffect, useRef } from "react";

// Global bot watcher: lives in the layout, so it polls on EVERY site page
// (not just /bots). Always polling: with no enabled bots the server answers
// an empty verdict immediately (one cheap query), so there is no stale
// enabled flag to miss — creating a bot just starts working, navigating
// never disarms it. Fired alerts raise a browser Notification (unless
// silent, or permission not granted) and broadcast for the in-site toast;
// the Bots page listens for the same broadcast and refreshes its list.
// Still needs a site tab open somewhere: closed browser = nothing runs.
export default function BotsWatcher() {
  const seen = useRef<Set<string>>(new Set());
  const stopRef = useRef(false);

  useEffect(() => {
    // Embedded panels (Vista Dinâmica iframes) don't poll: the top-level tab
    // already watches, and toasts inside a frame help nobody.
    try {
      if (new URLSearchParams(window.location.search).get("embed") === "1") return;
    } catch {
      // No URL access: poll normally.
    }
    stopRef.current = false;
    const check = async (): Promise<void> => {
      if (stopRef.current) return;
      let res: Response;
      try {
        res = await fetch("/api/bots/check", { method: "POST", cache: "no-store" });
      } catch {
        return;
      }
      // Logged out: nothing to watch on this tab ever.
      if (res.status === 401) {
        stopRef.current = true;
        return;
      }
      if (!res.ok) return;
      let body: { fired?: { id: string; silent: boolean; text: string; bot_name?: string }[]; games?: number };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return;
      }
      // Heartbeat so the Bots page can show the automatic pass is alive
      // (last pass time + games seen), without pressing anything.
      try {
        window.localStorage.setItem(
          "apostas:bots-watch",
          JSON.stringify({ at: Date.now(), games: typeof body.games === "number" ? body.games : null })
        );
      } catch {
        // Private mode: nothing persists.
      }
      // Cross-tab ping so other open tabs refresh their lists too (window
      // events never leave their own tab). Carries the alerts themselves so
      // every tab can toast, not just the one that found them.
      if ((body.fired ?? []).length > 0) {
        try {
          window.localStorage.setItem(
            "apostas:bots-ping",
            JSON.stringify({
              at: Date.now(),
              alerts: (body.fired ?? []).map((f) => ({ id: f.id, bot_name: f.bot_name, text: f.text })),
            })
          );
        } catch {
          // Private mode: same-tab listeners still work.
        }
      }
      for (const f of body.fired ?? []) {
        if (stopRef.current || seen.current.has(f.id)) continue;
        seen.current.add(f.id);
        if (!f.silent && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(f.text);
          } catch {
            // Permission revoked mid-session: the Bots page keeps the alert.
          }
        }
        // In-site toast on every page + live list refresh on /bots.
        if (!f.silent) {
          try {
            window.dispatchEvent(new CustomEvent("apostas:bot-alert", { detail: f }));
          } catch {
            // No listeners: the Bots page keeps the alert.
          }
        }
      }
    };
    void check();
    const t = setInterval(() => void check(), 60_000);
    return () => {
      stopRef.current = true;
      clearInterval(t);
    };
  }, []);

  return null;
}
