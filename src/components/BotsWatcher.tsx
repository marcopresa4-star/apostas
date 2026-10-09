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
      let body: { fired?: { id: string; silent: boolean; text: string; bot_name?: string }[] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return;
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
