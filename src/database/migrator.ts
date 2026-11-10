import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

// Chave arbitrária do advisory lock: impede duas instâncias de migrarem ao mesmo tempo.
const MIGRATION_LOCK_KEY = 7_340_211;

export const DEFAULT_MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Migrador mínimo: aplica, em ordem, os arquivos .sql ainda não registrados em
 * schema_migrations. Cada arquivo roda na sua própria transação (DDL é transacional no Postgres).
 */
export async function runMigrations(
  pool: Pool,
  dir: string = DEFAULT_MIGRATIONS_DIR,
  log: (msg: string) => void = () => undefined,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migração ${file} falhou: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`migração aplicada: ${file}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
