// Backup do SQLite local: copia data/app.db para data/backups/ antes de
// qualquer operação com risco (restart do dev, updates grandes). Mantém os
// últimos backups — correr sempre que quiseres um ponto de restauro:
//   node scripts/backup-db.mjs
import fs from "node:fs";
import path from "node:path";

const dbFile = path.join(process.cwd(), "data", "app.db");
const dir = path.join(process.cwd(), "data", "backups");
const keep = 7;

if (!fs.existsSync(dbFile)) {
  console.error("sem base em data/app.db — nada a copiar");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.join(dir, `app-${stamp}.db`);
fs.copyFileSync(dbFile, out);
// WAL/shm: o snapshot do ficheiro principal chega para restauro do estado
// checkpointed; se houver um -wal vivo de um dev aberto, copia-o também.
for (const ext of ["-wal", "-shm"]) {
  const side = `${dbFile}${ext}`;
  if (fs.existsSync(side)) fs.copyFileSync(side, `${out}${ext}`);
}
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
  .sort()
  .reverse();
for (const old of files.slice(keep)) {
  fs.unlinkSync(path.join(dir, old));
  for (const ext of ["-wal", "-shm"]) {
    const side = path.join(dir, `${old}${ext}`);
    if (fs.existsSync(side)) fs.unlinkSync(side);
  }
}
console.log(`✓ backup: ${out} (mantidos os últimos ${keep})`);
