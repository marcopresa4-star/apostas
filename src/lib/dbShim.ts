// A Supabase-shaped query layer over the local SQLite database. The rest of
// the app keeps its `.from("t").select().eq()…` code untouched — this shim
// implements the subset of the postgrest-js chain the codebase actually
// uses (filter kinds, order/limit, single/maybeSingle, insert/update/delete/
// upsert with onConflict, count) and decodes booleans/JSON per table.
// Only two call sites in the app use foreign-key embeds; both were rewritten
// to plain joins (see entityOptions.ts / (app)/actions.ts).
import { randomUUID } from "node:crypto";
import { LOCAL_USER_ID, TABLE_META, TABLES, getDb } from "./db";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

interface DbError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

interface QueryResult {
  data: unknown;
  error: DbError | null;
  count?: number | null;
}

type SqlOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "ilike" | "is";
const SQL_OPS = new Set<SqlOp>(["eq", "neq", "gt", "gte", "lt", "lte", "ilike", "is"]);

// Encode a JS value the way the SQLite schema stores it (booleans -> 0/1,
// objects/arrays -> JSON text).
function enc(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return v;
}

interface Row {
  [k: string]: unknown;
}

function decodeRow(table: string, row: Row): Row {
  const meta = TABLE_META[table] ?? {};
  for (const [k, v] of Object.entries(row)) {
    if (meta.bools?.includes(k)) {
      row[k] = v === 1 ? true : v === 0 ? false : v;
    } else if (meta.json?.includes(k) && typeof v === "string") {
      try {
        row[k] = JSON.parse(v);
      } catch {
        // Stored text is not JSON — hand it through untouched.
      }
    }
  }
  return row;
}

const PLAIN_COL = /^[a-z_][a-z0-9_]*$/;

function err(code: string, message: string): QueryResult {
  return { data: null, error: { code, message } };
}

class Chain {
  private conds: string[] = [];
  private args: unknown[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private selCols: string | null = "*";
  private returnSelect: string | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private exactCount = false;
  private failed: DbError | null = null;
  readonly promise: Promise<QueryResult>;

  constructor(
    private readonly table: string,
    private readonly op: "select" | "insert" | "upsert" | "update" | "delete",
    private values?: Record<string, unknown>,
    private conflict?: string
  ) {
    this.promise = Promise.resolve().then(() => this.run());
  }

  private checkCol(col: string): void {
    if (!PLAIN_COL.test(col)) {
      this.failed = { code: "42703", message: `column name not allowed: ${col}` };
      return;
    }
    const db = getDb();
    const meta = TABLE_META[this.table];
    const info = db.prepare(`select name from pragma_table_info(?)`).all(this.table) as { name: string }[];
    if (meta && !info.some((c) => c.name === col)) {
      this.failed = { code: "42703", message: `column ${this.table}.${col} does not exist` };
    }
  }

  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (this.failed) return this;
    if (this.op === "select") {
      this.selCols = cols ?? "*";
      if (opts?.count) this.exactCount = true;
    } else {
      this.returnSelect = cols ?? "*";
    }
    return this;
  }

  eq(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" = ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  neq(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" != ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  gt(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" > ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  gte(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" >= ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  lt(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" < ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  lte(col: string, value: unknown): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`"${col}" <= ?`);
      this.args.push(enc(value));
    }
    return this;
  }

  is(col: string, value: null | boolean): this {
    this.checkCol(col);
    if (!this.failed) {
      if (value === null) this.conds.push(`"${col}" IS NULL`);
      else if (typeof value === "boolean") this.conds.push(`"${col}" = ${value ? 1 : 0}`);
      else this.failed = { code: "22P02", message: `.is só aceita null ou booleano neste shim` };
    }
    return this;
  }

  in(col: string, list: unknown[]): this {
    this.checkCol(col);
    if (!this.failed) {
      if (list.length === 0) {
        this.conds.push("1 = 0");
      } else {
        this.conds.push(`"${col}" IN (${list.map(() => "?").join(",")})`);
        this.args.push(...list.map(enc));
      }
    }
    return this;
  }

  ilike(col: string, pattern: string): this {
    this.checkCol(col);
    if (!this.failed) {
      this.conds.push(`lower("${col}") LIKE lower(?)`);
      this.args.push(pattern);
    }
    return this;
  }

  // The codebase's .or() uses plain "col.op.value" clauses joined by commas.
  or(expr: string): this {
    if (this.failed) return this;
    const parts: string[] = [];
    try {
      for (const clause of expr.split(",")) {
        const trimmed = clause.trim();
        const dot = trimmed.indexOf(".");
        const opDot = trimmed.indexOf(".", dot + 1);
        if (dot < 1 || opDot < 0) throw new Error();
        const col = trimmed.slice(0, dot);
        const op = trimmed.slice(dot + 1, opDot) as SqlOp;
        const value = trimmed.slice(opDot + 1);
        if (!SQL_OPS.has(op)) throw new Error();
        this.checkCol(col);
        if (this.failed) throw new Error();
        if (op === "is") {
          if (value !== "null") throw new Error();
          parts.push(`"${col}" IS NULL`);
        } else if (op === "ilike") {
          parts.push(`lower("${col}") LIKE lower(?)`);
          this.args.push(value);
        } else {
          const sym = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
          parts.push(`"${col}" ${sym} ?`);
          this.args.push(enc(value));
        }
      }
    } catch {
      this.failed = { code: "22P02", message: `.or() expressão não suportada: ${expr}` };
      return this;
    }
    if (parts.length > 0) this.conds.push(`(${parts.join(" OR ")})`);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.checkCol(col);
    if (!this.failed) {
      this.orders.push(`"${col}" ${opts?.ascending === false ? "DESC" : "ASC"}`);
    }
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(_from: number, to: number): this {
    if (this.failed) return this;
    if (this.limitN === null) this.limitN = to - _from + 1;
    return this;
  }

  returns(): this {
    return this;
  }

  single(): this {
    this.wantSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  then<T1 = QueryResult, T2 = never>(
    onFulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return this.promise.then(
      onFulfilled as ((v: QueryResult) => T1 | PromiseLike<T1>) | null,
      onRejected as ((r: unknown) => T2 | PromiseLike<T2>) | null
    ) as Promise<T1 | T2>;
  }

  catch(onRejected?: (reason: unknown) => QueryResult): Promise<QueryResult> {
    return this.promise.catch(onRejected) as Promise<QueryResult>;
  }

  private buildWhere(): string {
    if (this.conds.length === 0) return "";
    return ` WHERE ${this.conds.join(" AND ")}`;
  }

  private decode(data: unknown[]): { data: unknown; error: DbError | null } {
    let rows = (data as Row[]).map((r) => decodeRow(this.table, r));
    // Column projection, mirroring PostgREST's select subset. FK-embeds never
    // reach here (those call sites use plain joins now).
    const cols = (this.selCols ?? "*").split(",").map((c) => c.trim());
    if (cols.length > 0 && cols.every((c) => PLAIN_COL.test(c)) && !cols.includes("*")) {
      rows = rows.map((r) => {
        const out: Row = {};
        for (const c of cols) out[c] = r[c];
        return out;
      });
    }
    if (this.wantSingle || this.wantMaybeSingle) {
      if (rows.length === 0) {
        if (this.wantMaybeSingle) return { data: null, error: null };
        return { data: null, error: { code: "PGRST116", message: "The result contains 0 rows" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  private run(): QueryResult {
    if (this.failed) return { data: null, error: this.failed };
    if (!TABLES.has(this.table)) return err("42P01", `tabela ${this.table} não existe`);
    const db = getDb();
    try {
      if (this.op === "select") {
        const withCount = this.exactCount;
        const sql =
          (withCount ? `SELECT COUNT(*) AS n FROM "${this.table}"` : `SELECT * FROM "${this.table}"`) +
          this.buildWhere() +
          (this.orders.length > 0 ? ` ORDER BY ${this.orders.join(", ")}` : "") +
          (this.limitN !== null ? ` LIMIT ${Math.max(0, this.limitN)}` : "");
        const out = db.prepare(sql).all(...this.args) as Row[];
        if (withCount) return { data: null, error: null, count: Number((out[0] as { n: number }).n) };
        const dec = this.decode(out);
        return dec as QueryResult;
      }
      if (this.op === "insert" || this.op === "upsert") {
        const meta = TABLE_META[this.table] ?? {};
        const row = { ...(this.values ?? {}) };
        // RLS-era default: every table defaulted user_id to auth.uid().
        const info = db.prepare("select name from pragma_table_info(?)").all(this.table) as { name: string }[];
        if (row.user_id === undefined && info.some((c) => c.name === "user_id")) row.user_id = LOCAL_USER_ID;
        if (meta.idDefaults && (row.id === undefined || row.id === null) && info.some((c) => c.name === "id")) {
          row.id = randomUUID();
        }
        for (const t of meta.timestamps ?? []) if (row[t] === undefined) row[t] = new Date().toISOString();
        const cols = Object.keys(row).filter((k) => row[k] !== undefined);
        if (cols.length === 0) return err("22P02", "insert sem colunas");
        for (const c of cols) {
          const info = db.prepare("select name from pragma_table_info(?)").all(this.table) as { name: string }[];
          if (!info.some((x) => x.name === c)) return err("42703", `coluna ${this.table}.${c} não existe`);
        }
        const sql = `INSERT INTO "${this.table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})${
          this.op === "upsert" ? buildOnConflict(this.table, cols, this.conflict) : ""
        }`;
        db.prepare(sql).run(...cols.map((c) => enc(row[c])));
        if (this.returnSelect) {
          // Last inserted row, projected the way the caller asked.
          const sel = this.returnSelect.split(",").map((c) => c.trim());
          if (sel.some((c) => !PLAIN_COL.test(c))) return err("42703", "select com embeds não suportado no insert");
          const got = db.prepare(`SELECT * FROM "${this.table}" WHERE rowid = (SELECT MAX(rowid) FROM "${this.table}")`).get() as Row | undefined;
          let outRow: Row | undefined = got;
          if (outRow) {
            outRow = decodeRow(this.table, { ...outRow });
            const proj: Row = {};
            for (const c of sel) proj[c] = (outRow as Row)[c];
            outRow = proj;
          }
          if (!outRow) return err("PGRST116", "row not returned");
          return { data: outRow, error: null };
        }
        return { data: null, error: null, count: null };
      }
      if (this.op === "update" || this.op === "delete") {
        const meta = TABLE_META[this.table] ?? {};
        const where = this.buildWhere();
        if (this.op === "update") {
          const row = { ...(this.values ?? {}) };
          for (const t of meta.timestamps ?? []) if (row[t] === undefined) delete row[t];
          const cols = Object.keys(row).filter((k) => row[k] !== undefined);
          if (cols.length === 0) return err("22P02", "update sem colunas");
          for (const c of cols) {
            const info = db.prepare("select name from pragma_table_info(?)").all(this.table) as { name: string }[];
            if (!info.some((x) => x.name === c)) return err("42703", `coluna ${this.table}.${c} não existe`);
          }
          const setSql = cols.map((c) => `"${c}" = ?`).join(", ");
          if (this.returnSelect) {
            const out = db.prepare(`UPDATE "${this.table}" SET ${setSql}${where} RETURNING *`).all(...cols.map((c) => enc(row[c])), ...this.args) as Row[];
            return this.decode(out) as QueryResult;
          }
          db.prepare(`UPDATE "${this.table}" SET ${setSql}${where}`).run(...cols.map((c) => enc(row[c])), ...this.args);
          return { data: null, error: null, count: null };
        }
        if (this.returnSelect) {
          const out = db.prepare(`DELETE FROM "${this.table}"${where} RETURNING *`).all(...this.args) as Row[];
          return this.decode(out) as QueryResult;
        }
        db.prepare(`DELETE FROM "${this.table}"${where}`).run(...this.args);
        return { data: null, error: null, count: null };
      }
      return err("22000", `operação ${this.op} não implementada`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed")) return err("23505", msg);
      if (msg.includes("FOREIGN KEY constraint failed")) return err("23503", msg);
      return err("XDB01", msg);
    }
  }
}

// ON CONFLICT needs the exact unique declaration; upserts in the codebase
// always pass onConflict naming the key columns (PK/unique angle). Without
// one, fall back to a first-key-guess over the row's columns.
function buildOnConflict(table: string, cols: string[], conflict?: string): string {
  void table;
  const target = (conflict
    ? conflict.split(",").map((c) => c.trim())
    : cols.filter((c) => ["user_id", "key", "event_id"].includes(c))
  ).filter((c) => cols.includes(c));
  const setters = cols.filter((c) => !target.includes(c));
  if (setters.length === 0) return " ON CONFLICT DO NOTHING";
  return ` ON CONFLICT (${target.map((c) => `"${c}"`).join(",")}) DO UPDATE SET ${setters
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ")}`;
}

export function fromChain(table: string): Chain {
  return new Chain(table, "select");
}

// The `.from(t)` shape the codebase knows: a builder that can select, insert,
// upsert, update or delete — exactly like postgrest-js' PostgrestQueryBuilder.
export class Builder {
  constructor(private readonly table: string) {}

  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): Chain {
    return new Chain(this.table, "select").select(cols, opts);
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): Chain {
    const row = Array.isArray(values) ? values[0] ?? {} : values;
    return new Chain(this.table, "insert", row);
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }): Chain {
    const row = Array.isArray(values) ? values[0] ?? {} : values;
    return new Chain(this.table, "upsert", row, opts?.onConflict);
  }

  update(values: Record<string, unknown>): Chain {
    return new Chain(this.table, "update", values);
  }

  delete(): Chain {
    return new Chain(this.table, "delete");
  }
}

// The client the call sites see. Shaped as the supabase-js minimal surface
// (auth/from) — cast keeps every existing call site's types happy.
export function createDbClient(): Promise<SupabaseClient> {
  const client = {
    auth: {
      async getUser() {
        const store = await cookies();
        const token = store.get(SESSION_COOKIE)?.value;
        if (!(await verifySessionToken(token))) return { data: { user: null }, error: null };
        return {
          data: { user: { id: LOCAL_USER_ID, email: "admin@local", role: "admin" } },
          error: null,
        };
      },
      async signOut() {
        try {
          (await cookies()).delete(SESSION_COOKIE);
        } catch {
          // Read-only context: the proxy clears nothing, the caller handles it.
        }
        return { error: null };
      },
    },
    from(table: string): Builder {
      if (!TABLES.has(table)) throw new Error(`tabela ${table} não existe`);
      return new Builder(table);
    },
  };
  return Promise.resolve(client as unknown as SupabaseClient);
}

export { LOCAL_USER_ID };

// Convenience for direct writers (insert behind .from() chains handles most
// flows; the helpers below serve the two places rewritten away from embeds).
export function insertChain(table: string, values: Record<string, unknown>): Chain {
  return new Chain(table, "insert", values);
}

export function updateChain(table: string, values: Record<string, unknown>): Chain {
  return new Chain(table, "update", values);
}

export function upsertChain(
  table: string,
  values: Record<string, unknown>,
  opts?: { onConflict?: string }
): Chain {
  return new Chain(table, "upsert", values, opts?.onConflict);
}

export function deleteChain(table: string): Chain {
  return new Chain(table, "delete");
}
