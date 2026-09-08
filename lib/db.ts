import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { OFFLINE_STATUS, type Pool, type Snapshot, type IndexerStatus } from './types.ts';
let database: DatabaseSync;
export function db() {
  if (database) return database;
  const path = process.env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || './data/aerodrome.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS pools (address TEXT PRIMARY KEY, factory TEXT NOT NULL, block INTEGER NOT NULL, createdAt INTEGER NOT NULL, mintBlock INTEGER, mintAt INTEGER, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pools_block ON pools(block);
    CREATE INDEX IF NOT EXISTS pools_created ON pools(createdAt);
    CREATE INDEX IF NOT EXISTS pools_mint ON pools(mintBlock);
    CREATE INDEX IF NOT EXISTS pools_mint_time ON pools(mintAt);
    CREATE TABLE IF NOT EXISTS factories (address TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (address TEXT PRIMARY KEY, symbol TEXT NOT NULL, decimals INTEGER);
    CREATE TABLE IF NOT EXISTS anchors (block INTEGER PRIMARY KEY, hash TEXT NOT NULL);`);
  return database;
}
export function transaction<T>(fn: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const result = fn(); db().exec('COMMIT'); return result; }
  catch (e) { db().exec('ROLLBACK'); throw e; }
}
export function meta<T>(key: string, fallback: T): T {
  const row = db().prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : fallback;
}
export function setMeta(key: string, value: unknown) { db().prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, JSON.stringify(value)); }
export function savePool(pool: Pool) {
  const normalized = { ...pool, address: pool.address.toLowerCase(), factory: pool.factory.toLowerCase() };
  db().prepare('INSERT OR REPLACE INTO pools VALUES (?,?,?,?,?,?,?)').run(normalized.address, normalized.factory, pool.block, pool.createdAt, pool.mintBlock, pool.mintAt, JSON.stringify(normalized));
}
export function getPool(address: string): Pool | undefined {
  const row = db().prepare('SELECT body FROM pools WHERE address=?').get(address.toLowerCase()) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function firstMint(pool: Pool, mint: { block: number; at: number; tx: string; amount0: string; amount1: string }) {
  // Always compare with the latest persisted record: live and history scans can overlap.
  const current = getPool(pool.address) || pool;
  if (BigInt(mint.amount0) === 0n && BigInt(mint.amount1) === 0n) return;
  if (current.mintBlock !== null && current.mintBlock <= mint.block) return;
  savePool({ ...current, mintBlock: mint.block, mintAt: mint.at, mintTx: mint.tx, amount0: mint.amount0, amount1: mint.amount1 });
}
// Called inside the scan's transaction; readers never see a partly rewound database.
export function rewind(from: number) {
  db().prepare('DELETE FROM pools WHERE block>=?').run(from);
  for (const row of db().prepare('SELECT body FROM pools WHERE mintBlock>=?').all(from) as { body: string }[]) {
    savePool({ ...JSON.parse(row.body), mintBlock: null, mintAt: null, mintTx: null, amount0: null, amount1: null });
  }
  db().prepare('DELETE FROM anchors WHERE block>=?').run(from);
}
export function readStatus(): IndexerStatus { const control=meta('scanner-control',{enabled:true,updatedAt:0}); return { ...OFFLINE_STATUS, ...meta('status', {}), scanEnabled: control.enabled, controlUpdatedAt: control.updatedAt }; }
export function snapshot(): Snapshot {
  const connection = db();
  const status = readStatus();
  // All indexed rows are searchable in this lightweight, personal app.
  const pools = (connection.prepare('SELECT body FROM pools ORDER BY block DESC').all() as { body: string }[]).map(r => {
    const p = JSON.parse(r.body) as Pool;
    return { ...p, mintVerified: p.block >= status.liveStart || (p.mintBlock !== null && status.history >= p.mintBlock) };
  });
  const counts = connection.prepare('SELECT COUNT(*) AS total, COUNT(mintBlock) AS minted, SUM(createdAt>=?) AS today FROM pools').get(Math.floor(Date.now() / 1000) - 86400) as { total: number; minted: number; today: number | null };
  const factories = (connection.prepare('SELECT f.address, f.approved, COUNT(p.address) AS pools FROM factories f LEFT JOIN pools p ON p.factory=f.address GROUP BY f.address ORDER BY pools DESC').all() as { address: string; approved: number; pools: number }[]).map(f => ({ ...f, approved: !!f.approved }));
  const hour = Math.floor(Date.now() / 3600000);
  const countHours = (column: 'createdAt' | 'mintAt') => new Map((connection.prepare(`SELECT CAST(${column}/3600 AS INTEGER) AS hour, COUNT(*) AS n FROM pools WHERE ${column}>=? GROUP BY hour`).all((hour - 23) * 3600) as {hour:number;n:number}[]).map(r => [r.hour,r.n]));
  const created = countHours('createdAt'), minted = countHours('mintAt');
  const activity = Array.from({ length: 24 }, (_, i) => ({ hour: hour - 23 + i, created: created.get(hour - 23 + i) || 0, minted: minted.get(hour - 23 + i) || 0 }));
  return { pools, factories, stats: { ...counts, today: counts.today || 0, waiting: counts.total - counts.minted }, activity, status };
}
