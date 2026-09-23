// Local SofaScore reader (CloakBrowser + Playwright). Runs ONLY on your machine,
// never on Vercel: stealth browsers need a ~200MB Chromium binary, a persistent
// profile and minutes of warm-up — none of that fits a serverless function.
//
// What it does:
//   1. Opens SofaScore once in a stealth Chromium (persistent profile in
//      ./.cloak-profile, so the Cloudflare clearance survives restarts).
//   2. Calls SofaScore's own public JSON API *inside* that page context, where
//      the clearance cookies + real TLS fingerprint apply:
//        GET /api/v1/sport/football/event/{id}
//        GET /api/v1/sport/football/event/{id}/incidents
//        GET /sport/football/events/live
//   3. Serves the raw JSON to the Next.js app on http://127.0.0.1:9323:
//        GET /health            -> { ok: true, ready: bool }
//        GET /event?id=12345678 -> { event, incidents } (cached 30s)
//        GET /live              -> { events: [...] }     (cached 60s)
//
// The Next.js side normalizes this into LiveGameState (src/lib/sofascore.ts)
// and proxies it through /api/sofascore/* — the browser never talks to the
// scraper directly.
//
// Setup (once):
//   cd scraper
//   npm install
//   npx cloakbrowser login     # free key via GitHub (latest Chromium 151 build).
//                              # Without a key it still works on the older free
//                              # build, which degrades as detections evolve.
//   npm start                  # first run opens a VISIBLE browser: solve the
//                              # Cloudflare check by hand if one appears, then
//                              # leave it running. The clearance is remembered.
//
// Then in the repo root .env.local:
//   SOFASCORE_SCRAPER_URL=http://127.0.0.1:9323
//
// Why CloakBrowser and not camofox-browser? For this project (one user, local,
// poll one match a minute) CloakBrowser is one Node process with a Playwright
// drop-in API and no server to manage. camofox-browser is the better pick only
// if you later want a shared box (Raspberry Pi / $5 VPS) serving several users
// or agents through its REST API on :9377, with VNC login and session
// isolation — heavier than needed here.

import http from "node:http";

const PORT = Number(process.env.SOFASCORE_PORT ?? 9323);
const WARM_URL = "https://www.sofascore.com/football";
const EVENT_TTL_MS = 30_000;
const LIVE_TTL_MS = 60_000;

const eventCache = new Map();
const liveCache = { at: 0, body: null };
// Tracker coverage per event id: checked once, kept for 10 minutes (coverage
// does not appear mid-game; without it the iframe shows a raw 404).
const trackerCache = new Map();

// Serializes shared-page work (navigations + DOM reads): a single page, one
// event at a time. API reads use the pool above and never touch this.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Which event the shared page is currently showing (null = homepage/other).
// The live minute is read from the rendered page (ground truth: exactly what
// SofaScore displays), not derived from timestamps — the API's description is
// often just "2nd half" and its period clock can stall (VAR, injury).
let pageEventId = null;

async function ensureEventPage(id, pagePath) {
  const p = await ensureBrowser();
  if (pageEventId === id && !p.isClosed()) return p;
  // The hash-only URL 404s: SofaScore needs the full slug/customId path, which
  // the event API itself provides (same slug as the pasted link).
  const url = pagePath
    ? `https://www.sofascore.com/football/match/${pagePath}#id:${id}`
    : `https://www.sofascore.com/football/match#/id:${id}`;
  await p
    .goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    })
    .catch(() => {});
  // SPA needs a moment to render the header after the navigation.
  await new Promise((r) => setTimeout(r, 2500));
  pageEventId = id;
  return p;
}

// Every "63'"-looking text on the page, with ancestor classes for context.
// Past incident minutes show up too ("11'", "45'"), so the caller picks the
// header one — the max alone is not safe ("90'" boundary labels exist).
async function domMinuteCandidates(p) {
  try {
    return await p.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.nodeValue || "").trim();
        if (!/^\d{1,3}(\+\d{1,2})?'$/.test(t)) continue;
        let el = node.parentElement;
        let cls = "";
        for (let i = 0; i < 4 && el; i++) {
          const c = typeof el.className === "string" ? el.className : "";
          if (c) cls += " " + c;
          el = el.parentElement;
        }
        out.push({ t, cls: cls.slice(0, 220) });
      }
      return out.slice(0, 40);
    });
  } catch {
    return [];
  }
}

// The scoreboard minute: the smallest container holding BOTH team names (name
// or short name) is the scoreboard — the first such in document order, since
// the scoreboard sits above lineups/H2H. Its clock text is the displayed
// minute. Scoped on purpose: the rest of the page is full of other minutes
// (incident list, chart axes) that must not win.
// The live clock ticks as "75:10" (mm:ss), not "75'": both shapes count, and
// the max wins (scorer lines like "E. Bello 38'" sit in the same box but never
// pass the running clock).
async function scoreboardMinute(p, names) {
  try {
    const clean = (names ?? []).map((n) => String(n || "").trim()).filter(Boolean);
    if (clean.length === 0) return null;
    return await p.evaluate((wants) => {
      const toMin = (t) => {
        const m = /^(\d{1,3})(?:\+(\d{1,2}))?'$/.exec(t);
        if (m) return Math.min(130, Number(m[1]) + (m[2] ? Number(m[2]) : 0));
        const c = /^(\d{1,3}):([0-5]\d)$/.exec(t);
        if (c) return Math.min(130, Number(c[1]));
        return null;
      };
      const lower = wants.map((w) => w.toLowerCase());
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.nodeValue || "").trim().toLowerCase();
        if (!t) continue;
        const idx = lower.findIndex((w) => t.includes(w));
        if (idx >= 0) hits.push({ node, idx });
      }
      for (const { node } of hits) {
        let box = node.parentElement;
        for (let i = 0; i < 10 && box; i++) {
          const text = (box.innerText || "").toLowerCase();
          // Both clubs named in this box: the scoreboard (first hit in
          // document order wins — lineups/H2H come later).
          if (lower.every((w) => text.includes(w))) {
            const found = [...text.matchAll(/(\d{1,3}(?:\+\d{1,2})?'|\d{1,3}:[0-5]\d)/g)]
              .map((m) => toMin(m[1]))
              .filter((v) => v !== null);
            if (found.length >= 1 && found.length <= 6) return Math.max(...found);
            break; // both names but no clean minute: don't climb to the whole page
          }
          box = box.parentElement;
        }
      }
      return null;
    }, clean);
  } catch {
    return null;
  }
}

// The displayed live minute: a header/scoreboard candidate wins; else the max
// plausible one. Null when the page shows no minute (not started, finished).
function pickDisplayMinute(candidates) {
  const toMin = (t) => {
    const m = /^(\d{1,3})(?:\+(\d{1,2}))?'$/.exec(t);
    if (!m) return null;
    return Math.min(130, Number(m[1]) + (m[2] ? Number(m[2]) : 0));
  };
  const header = candidates.filter((c) =>
    /header|score|status|clock|time|live|match/i.test(c.cls)
  );
  const pool = header.length > 0 ? header : candidates;
  let best = null;
  for (const c of pool) {
    const v = toMin(c.t);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

let ctx = null;
let page = null;
let ready = false;
let launchError = null;

async function launch() {
  const { launchPersistentContext } = await import("cloakbrowser");
  ctx = await launchPersistentContext({
    userDataDir: "./.cloak-profile",
    // Headless by default (no window). Headed only passes Cloudflare more
    // reliably on a brand-new profile; if a challenge ever needs solving by
    // hand, run once with SOFASCORE_HEADLESS=0, solve it, then go back.
    headless: process.env.SOFASCORE_HEADLESS !== "0",
    humanize: true,
    // Fixed fingerprint: every restart with a fresh random seed looks like a
    // new device from the same IP (bot-like). A stable seed reads as a
    // returning visitor. Override with SOFASCORE_FINGERPRINT if ever needed.
    args: [`--fingerprint=${process.env.SOFASCORE_FINGERPRINT ?? "424242"}`],
  });
  page = null;
  // Never accumulate tabs (a past bug reopened hundreds of session tabs and
  // drowned the browser): one shared tab, everything else closed.
  try {
    const tabs = ctx.pages();
    for (const t of tabs.slice(1)) await t.close().catch(() => {});
  } catch {
    // A missing tab here is harmless; calls recover per-tab below.
  }
}

// The visible browser window can be closed by hand (or crash): recover by
// reopening a page in the same persistent profile instead of dying.
async function ensureBrowser() {
  if (page && !page.isClosed()) return page;
  if (!ctx) await launch();
  try {
    page = ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
    if (!page.url() || page.url() === "about:blank") {
      await page.goto(WARM_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    }
    ready = true;
    return page;
  } catch {
    // Context/browser itself is gone: relaunch from scratch once.
    ctx = null;
    page = null;
    await launch();
    page = (await ctx.pages())[0] ?? (await ctx.newPage());
    await page.goto(WARM_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    ready = true;
    return page;
  }
}

// Same fetch the SofaScore page itself does: clearance cookies included.
const API_BASE = "https://www.sofascore.com/api/v1";

// Reads share the one warmed page, strictly one at a time. (A tab pool was
// tried and reverted: the browser intermittently stops creating new tabs,
// which hung everything with no error. Serial is slow but predictable; the
// app caches aggressively so repeats are instant.)
//
// Nothing here may hang forever: every Playwright call races a timeout, so a
// wedged renderer fails fast (502) instead of freezing the whole queue.
const OP_TIMEOUT_MS = 25_000;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Reads share parked tabs (2 at a time) instead of going strictly serial:
// season loads are hundreds of independent reads. Tabs park on SofaScore once
// and never navigate again (parallel *navigations* look bot-like and get
// challenged); they share the context, so clearance cookies and the captcha
// token apply to all. Navigations + DOM reads keep the single shared page
// behind `enqueue`. Creation is guarded so a burst can't pile up tabs.
const API_SLOTS = 2;
const slots = [];
let creating = false;

async function acquire() {
  for (;;) {
    const free = slots.find((s) => !s.busy && s.page && !s.page.isClosed());
    if (free) {
      free.busy = true;
      return free;
    }
    if (slots.length < API_SLOTS && !creating) {
      creating = true;
      try {
        await ensureBrowser();
        const page = await withTimeout(ctx.newPage(), OP_TIMEOUT_MS, "newPage");
        await withTimeout(
          page.goto(WARM_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
          35_000,
          "park"
        );
        const slot = { page, busy: true };
        slots.push(slot);
        return slot;
      } finally {
        creating = false;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function release(slot, dead = false) {
  if (dead || !slot.page || slot.page.isClosed()) {
    slot.page = null;
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    return;
  }
  slot.busy = false;
}

async function apiGet(path, retried = false) {
  const slot = await acquire();
  try {
    const url = `${API_BASE}${path}`;
    // The page authenticates its own calls with the captcha JWT it keeps in
    // localStorage ("sofa.captcha.token", minted by its challenge flow):
    // without it the API answers 403 {"reason":"challenge"}. Same call,
    // same headers the page sends.
    const result = await withTimeout(
      slot.page.evaluate(async (u) => {
        let captcha = null;
        try {
          captcha = JSON.parse(localStorage.getItem("sofa.captcha.token") || "null");
        } catch {
          // No token yet: the call below will say 403 and trigger a reload.
        }
        const res = await fetch(u, {
          credentials: "include",
          signal: AbortSignal.timeout(15_000),
          ...(captcha ? { headers: { "x-captcha": captcha } } : {}),
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // Cloudflare challenge pages are HTML, not JSON.
        }
        return { status: res.status, json, snippet: text.slice(0, 200) };
      }, url),
      OP_TIMEOUT_MS,
      `fetch ${path}`
    );
    if ((result.status === 403 || result.status === 401) && !retried) {
      // Token stale or not minted yet: reloading re-runs the page's own
      // challenge/token flow (usually transparent), then retry once.
      release(slot);
      await enqueue(async () => {
        const p = await ensureBrowser();
        await withTimeout(
          p.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}),
          OP_TIMEOUT_MS + 10_000,
          "reload"
        ).catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));
      });
      return apiGet(path, true);
    }
    release(slot);
    if (result.status === 403 || result.status === 401) {
      // reason "challenge": Cloudflare wants one interactive solve in the
      // visible window — then these same calls pass again.
      throw Object.assign(new Error(`SofaScore answered ${result.status} (clearance expired?)`), {
        code: "blocked",
        snippet: result.snippet,
      });
    }
    if (result.status === 404) {
      throw Object.assign(new Error("Event not found on SofaScore"), { code: "notfound" });
    }
    if (result.status < 200 || result.status >= 300 || !result.json) {
      throw Object.assign(new Error(`SofaScore answered ${result.status}`), { code: "upstream" });
    }
    return result.json;
  } catch (err) {
    // Dead or wedged tab (closed window, crashed/stuck renderer): drop it and
    // try once more. Never hang the queue: withTimeout bounds every wait.
    if (!retried && /closed|crash|target|timeout/i.test(String(err?.message ?? err))) {
      release(slot, true);
      return apiGet(path, true);
    }
    release(slot);
    throw err;
  }
}

function send(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      return send(res, 200, { ok: true, ready, launchError: launchError ? String(launchError) : null });
    }
    if (url.pathname === "/event") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: "id is required" });
      const hit = eventCache.get(id);
      if (hit && Date.now() - hit.at < EVENT_TTL_MS) return send(res, 200, hit.body);
      const [eventBody, incidentsBody] = await Promise.all([
        apiGet(`/event/${id}`),
        apiGet(`/event/${id}/incidents`).catch((err) =>
          err?.code === "notfound" ? { incidents: [] } : Promise.reject(err),
        ),
      ]);
      // Displayed minute, straight from the rendered page. Needs the page on
      // this event (one navigation per match; later polls reuse it). Never
      // fatal: without it the app falls back to the API-derived minute.
      let displayMinute = null;
      let domCandidates = [];
      try {
        const ev = eventBody?.event ?? eventBody;
        const slug = typeof ev?.slug === "string" ? ev.slug : "";
        const custom = typeof ev?.customId === "string" ? ev.customId : "";
        const pagePath = slug && custom ? `${slug}/${custom}` : slug || null;
        const teamNames = [ev?.homeTeam?.name, ev?.homeTeam?.shortName, ev?.awayTeam?.name, ev?.awayTeam?.shortName];
        await enqueue(async () => {
          const p = await ensureEventPage(id, pagePath);
          domCandidates = await domMinuteCandidates(p);
          // Scoped scoreboard read first (exact), page-wide heuristics second.
          displayMinute = (await scoreboardMinute(p, teamNames)) ?? pickDisplayMinute(domCandidates);
        });
      } catch {
        // Page read failed: API data below is still good.
      }
      const body = {
        event: eventBody?.event ?? eventBody,
        incidents: incidentsBody?.incidents ?? [],
        displayMinute,
        domCandidates: domCandidates.slice(0, 12),
      };
      // Tracker coverage (for the widget fallback): HEAD inside the page.
      try {
        const cached = trackerCache.get(id);
        if (!cached || Date.now() - cached.at > 10 * 60_000) {
          const ok = await enqueue(async () => {
            const p = await ensureBrowser();
            return p.evaluate(async (eventId) => {
              try {
                const r = await fetch(
                  `https://www.sofascore.com/api/v1/event/${eventId}/live-match-tracker/en/invert-teams/false`,
                  { method: "HEAD", credentials: "include" }
                );
                return r.status === 200;
              } catch {
                return false;
              }
            }, id);
          });
          trackerCache.set(id, { at: Date.now(), ok });
        }
        body.hasTracker = (trackerCache.get(id) ?? {}).ok ?? null;
      } catch {
        body.hasTracker = null;
      }
      eventCache.set(id, { at: Date.now(), body });
      return send(res, 200, body);
    }
    if (url.pathname === "/graph") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: "id is required" });
      try {
        const body = await apiGet(`/event/${id}/graph`);
        return send(res, 200, body);
      } catch (err) {
        const code = err?.code;
        if (code === "notfound") return send(res, 404, { error: "notfound" });
        return send(res, 502, { error: code ?? "upstream" });
      }
    }
    // Temporary probe: what the rendered event page looks like (URL, title,
    // header HTML) to calibrate the minute extraction.
    if (url.pathname === "/debug-event") {      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: "id is required" });
      const evBody = await apiGet(`/event/${id}`).catch((err) => ({ _error: String(err?.message ?? err) }));
      const ev = evBody?.event ?? evBody;
      const slug = typeof ev?.slug === "string" ? ev.slug : "";
      const custom = typeof ev?.customId === "string" ? ev.customId : "";
      const p = await ensureEventPage(id, slug && custom ? `${slug}/${custom}` : slug || null);
      const cands = await domMinuteCandidates(p);
      const teamNames = [ev?.homeTeam?.name, ev?.homeTeam?.shortName, ev?.awayTeam?.name, ev?.awayTeam?.shortName];
      const sbMinute = await scoreboardMinute(p, teamNames);
      const info = await p
        .evaluate(() => {
          const header =
            document.querySelector("header")?.outerHTML ??
            document.body.innerHTML;
          const links = [...document.querySelectorAll("a[href]")]
            .map((a) => a.getAttribute("href"))
            .filter((h) => h && /widget|embed|share/i.test(h));
          const buttons = [...document.querySelectorAll("button")]
            .map((b) => (b.textContent || "").trim())
            .filter((t) => t && /widget|embed|share|iframe/i.test(t));
          const frames = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src"));
          // Next.js dehydrated state: server-rendered pages (SEO) embed their
          // data here — API-independent when XHR is gated.
          let nextData = null;
          try {
            const el = document.getElementById("__NEXT_DATA__");
            if (el) {
              const parsed = JSON.parse(el.textContent || "{}");
              const props = parsed.props?.pageProps ?? {};
              nextData = { keys: Object.keys(props), hasEvent: Boolean(props.event) };
            }
          } catch (e) {
            nextData = { parseError: String(e?.message ?? e).slice(0, 100) };
          }
          // Where the page keeps its API clearance (the x-captcha JWT its own
          // calls carry): localStorage / cookies / well-known keys.
          let storage = null;
          try {
            const ls = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              const v = localStorage.getItem(k) || "";
              ls[k] = v.length > 120 ? `${v.slice(0, 60)}…(${v.length})` : v;
            }
            storage = { localStorage: ls, cookieNames: document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean) };
          } catch (e) {
            storage = { storageError: String(e?.message ?? e).slice(0, 100) };
          }
          return {
            url: location.href,
            title: document.title,
            bodyText: document.body.innerText.slice(0, 1500),
            headerHtml: header.slice(0, 4000),
            widgetLinks: [...new Set(links)].slice(0, 10),
            widgetButtons: [...new Set(buttons)].slice(0, 10),
            iframes: [...new Set(frames)].slice(0, 10),
            nextData,
            storage,
          };
        })
        .catch((err) => ({ evaluateError: String(err?.message ?? err) }));
      return send(res, 200, { ...info, picked: pickDisplayMinute(cands), scoreboard: sbMinute, candidates: cands.slice(0, 20) });
    }
    // Temporary probe: load a candidate widget URL in a throwaway tab (same
    // profile/clearance, shared page untouched) and report what renders.
    // .js responses come back whole (SofaScore's own client code: which API
    // host and headers it uses); pages are summarized.
    if (url.pathname === "/debug-widget") {
      const target = url.searchParams.get("u") || "";
      if (!/^https:\/\/(widgets\.sofascore\.com|www\.sofascore\.com\/(api|_next))\//.test(target) && !target.includes("/_fetchtest")) {
        return send(res, 400, { error: "only widgets.sofascore.com or sofascore api/_next URLs" });
      }
      await ensureBrowser();
      const probe = await ctx.newPage();
      let status = null;
      try {
        const response = await probe
          .goto(target, { waitUntil: "domcontentloaded", timeout: 25_000 })
          .catch(() => null);
        status = response?.status() ?? null;
        await new Promise((r) => setTimeout(r, 2500));
        const info = await probe
          .evaluate(async (targetUrl) => {
            const base = {
              url: location.href,
              title: document.title,
              text: document.body ? document.body.innerText.slice(0, 600) : "",
            };
            if (/\.js(\?|$)/.test(targetUrl)) {
              try {
                const r = await fetch(targetUrl);
                return { ...base, js: (await r.text()).slice(0, 200_000) };
              } catch (e) {
                return { ...base, jsError: String(e?.message ?? e) };
              }
            }
            if (targetUrl.includes("/_fetchtest")) {
              // Which combination reaches the API: www vs api host, with vs
              // without an explicit Accept header. Diagnostic only.
              const tries = [];
              for (const h of [
                "https://www.sofascore.com/api/v1/search/all?q=porto",
                "https://api.sofascore.com/api/v1/search/all?q=porto",
              ]) {
                for (const init of [{ credentials: "include" }, { credentials: "include", headers: { Accept: "application/json" } }]) {
                  try {
                    const r = await fetch(h, init);
                    tries.push({ url: h, accept: Boolean(init.headers), status: r.status, body: (await r.text()).slice(0, 120) });
                  } catch (e) {
                    tries.push({ url: h, accept: Boolean(init.headers), error: String(e?.message ?? e).slice(0, 120) });
                  }
                }
              }
              return { ...base, tries };
            }
            try {
              const r = await fetch(targetUrl, { method: "HEAD" });
              return {
                ...base,
                headers: {
                  status: r.status,
                  xfo: r.headers.get("x-frame-options"),
                  csp: r.headers.get("content-security-policy"),
                },
              };
            } catch (e) {
              return { ...base, headers: { fetchError: String(e?.message ?? e) } };
            }
          }, target)
          .catch((err) => ({ evaluateError: String(err?.message ?? err) }));
        const body = JSON.stringify({ http: status, ...info });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(body);
      } finally {
        await probe.close().catch(() => {});
      }
    }
    // Generic read of SofaScore's own JSON API inside the cleared page (local
    // development only): /raw?path=/search/all&query=benfica... The path must
    // stay inside /api/v1 and is passed to apiGet with its query string.
    if (url.pathname === "/raw") {
      const path = url.searchParams.get("path") || "";
      const rest = [...url.searchParams.entries()]
        .filter(([k]) => k !== "path")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      if (!/^\/[A-Za-z0-9/_-]+$/.test(path)) return send(res, 400, { error: "bad path" });
      try {
        const body = await apiGet(rest ? `${path}?${rest}` : path);
        return send(res, 200, body);
      } catch (err) {
        const code = err?.code;
        if (code === "notfound") return send(res, 404, { error: "notfound" });
        return send(res, 502, { error: code ?? "upstream", message: String(err?.message ?? err) });
      }
    }
    // Temporary probe: which API calls the page itself makes (and their
    // statuses): proves the data path independently of our fetch calls.
    if (url.pathname === "/debug-net") {
      const target = url.searchParams.get("u") || "https://www.sofascore.com/football";
      if (!/^https:\/\/www\.sofascore\.com\//.test(target)) {
        return send(res, 400, { error: "only sofascore pages" });
      }
      await ensureBrowser();
      const probe = await ctx.newPage();
      const calls = [];
      probe.on("request", (req) => {
        try {
          const u = req.url();
          if (/sofascore\.com\/api\//.test(u) && !/img\.sofascore/.test(u)) {
            const h = req.headers();
            calls.push({
              url: u.slice(0, 160),
              method: req.method(),
              headers: Object.fromEntries(
                Object.entries(h).filter(([k]) =>
                  /^(accept|referer|origin|user-agent|cookie|x-|sec-)/i.test(k)
                )
              ),
            });
          }
        } catch {
          // Listener must never throw.
        }
      });
      probe.on("response", async (resp) => {
        try {
          const u = resp.url();
          if (/sofascore\.com\/api\//.test(u)) {
            const hit = calls.find((c) => u.startsWith(c.url.slice(0, 120)));
            if (hit) hit.status = resp.status();
            else calls.push({ url: u.slice(0, 160), status: resp.status() });
          }
        } catch {
          // Listener must never throw.
        }
      });
      try {
        await probe.goto(target, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 12_000));
        return send(res, 200, { calls: calls.slice(0, 40) });
      } finally {
        await probe.close().catch(() => {});
      }
    }
    if (url.pathname === "/live") {      if (liveCache.body && Date.now() - liveCache.at < LIVE_TTL_MS) return send(res, 200, liveCache.body);
      const body = await apiGet("/sport/football/events/live");
      const out = { events: Array.isArray(body?.events) ? body.events : [] };
      liveCache.body = out;
      liveCache.at = Date.now();
      return send(res, 200, out);
    }
    return send(res, 404, { error: "unknown endpoint" });
  } catch (err) {
    const code = err?.code;
    if (code === "notfound") return send(res, 404, { error: "notfound" });
    if (code === "blocked")
      return send(res, 502, {
        error: "blocked",
        hint: "Abre a janela do browser do scraper e resolve o desafio Cloudflare, depois tenta de novo.",
      });
    return send(res, 502, { error: "upstream", message: String(err?.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sofascore-scraper] http://127.0.0.1:${PORT} (warming up browser in background…)`);
});

// Warm up in the background so the first /event call is fast. A visible
// window opens on first run: that is where a Cloudflare check is solved once.
ensureBrowser().catch((err) => {
  launchError = err;
  console.error("[sofascore-scraper] browser failed to start:", err?.message ?? err);
});
