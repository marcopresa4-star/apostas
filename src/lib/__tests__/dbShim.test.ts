import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The shim runs against a scratch DB so tests never touch data/app.db.
process.env.LOCAL_DB_FILE = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), "tmp-shim-test-"))) + "/test.db";

import { LOCAL_USER_ID, getDb } from "../db";
import { insertChain, updateChain, upsertChain, fromChain } from "../dbShim";

describe("dbShim over SQLite", () => {
  beforeEach(() => {
    const db = getDb();
    for (const t of ["bots", "bot_alerts", "favorite_games", "user_notes", "teams", "competitions", "countries"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  });

  it("insert with declared select returns the row (single)", async () => {
    const db = getDb();
    db.prepare("insert into countries (id, name) values ('c1', 'Portugal')").run();
    const out = await insertChain("teams", { name: "Boavista", country_id: "c1" }).select("id, name, country_id").single();
    expect(out.error).toBeNull();
    const row = out.data as { id: string; name: string; country_id: string };
    expect(row.name).toBe("Boavista");
    expect(row.country_id).toBe("c1");
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unique violation maps to 23505 and reselect finds the row", async () => {
    const db = getDb();
    db.prepare("insert into countries (id, name) values ('c1', 'Portugal')").run();
    await insertChain("teams", { name: "Porto", country_id: "c1" }).then();
    const again = await insertChain("teams", { name: "Porto", country_id: "c1" }).then();
    expect(again.error?.code).toBe("23505");
    const reselect = await fromChain("teams").eq("name", "Porto").eq("country_id", "c1").single();
    expect(reselect.error).toBeNull();
    expect((reselect.data as { name: string }).name).toBe("Porto");
  });

  it("upsert onConflict updates non-key columns", async () => {
    await upsertChain("favorite_games", { user_id: LOCAL_USER_ID, event_id: 42, home: "A", away: "B", tournament: "Liga X" });
    await upsertChain(
      "favorite_games",
      { user_id: LOCAL_USER_ID, event_id: 42, home: "A2", away: "B2", tournament: "Liga Y" },
      { onConflict: "user_id,event_id" }
    );
    const db = getDb();
    const row = db.prepare("select home from favorite_games").get() as { home: string };
    expect(row.home).toBe("A2");
    const count = db.prepare("select count(*) n from favorite_games").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("booleans and JSON columns round-trip like Postgres", async () => {
    const ins = await insertChain("bots", {
      name: "check-golos",
      leagues: ["por1", "esp1"],
      stats: [{ key: "hg" }],
      enabled: true,
      min_odd: 1.8,
    });
    expect(ins.error).toBeNull();
    const db = getDb();
    const raw = db.prepare("select leagues, enabled from bots").get() as { leagues: string; enabled: number };
    expect(raw.leagues).toBe('["por1","esp1"]');
    expect(raw.enabled).toBe(1);
    const upd = await updateChain("bots", { enabled: false, silent: true }).eq("name", "check-golos");
    expect(upd.error).toBeNull();
    const raw2 = db.prepare("select enabled, silent from bots").get() as { enabled: number; silent: number };
    expect(raw2.enabled).toBe(0);
    expect(raw2.silent).toBe(1);
  });

  it("filters, order, limit", async () => {
    const db = getDb();
    db.prepare("insert into bots (id, user_id, name) values ('b1', ?, 'teste')").run(LOCAL_USER_ID);
    const ins = db.prepare(
      `insert into bot_alerts (id, user_id, bot_id, event_id, minute, home, away, hg, ag, market, text, hit)
       values (?, ?, 'b1', 7, ?, 'A', 'B', ?, 0, 'mais1', 'texto', ?)`
    );
    for (let i = 0; i < 5; i++) ins.run(`id${i}`, LOCAL_USER_ID, 55 + i, i, i === 0 ? 1 : i === 1 ? 0 : null);
    const open = await fromChain("bot_alerts").eq("user_id", LOCAL_USER_ID).is("hit", null).order("minute", { ascending: false }).limit(2);
    expect(open.error).toBeNull();
    expect((open.data as unknown[]).length).toBe(2);
    const hits = await fromChain("bot_alerts").eq("hit", true);
    expect((hits.data as unknown[]).length).toBe(1);
  });

  it("user_notes upsert with user_id-pk", async () => {
    await upsertChain("user_notes", { user_id: LOCAL_USER_ID, content: "primeira" });
    await upsertChain("user_notes", { user_id: LOCAL_USER_ID, content: "segunda" });
    const row = getDb().prepare("select content from user_notes").get() as { content: string };
    expect(row.content).toBe("segunda");
  });
});
