import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { D1Database, D1PreparedStatement, D1Result } from '../../backend/src/types';

/** node:sqlite の上に D1 と同じ形のAPIを載せたテスト用DB */
export function createTestD1(): D1Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as any;
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const make = (sql: string, args: unknown[] = []): D1PreparedStatement => ({
    bind: (...v: unknown[]) => make(sql, v),
    first: async <T>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...args) as T[], success: true, meta: {} }) as D1Result<T>,
    run: async () => {
      const r = sqlite.prepare(sql).run(...args);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => make(sql),
    batch: async (stmts) => {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}
