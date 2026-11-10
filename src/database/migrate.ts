import { runMigrations } from './migrator';
import { createPool } from './pool';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não definido');
  const pool = createPool({ connectionString, max: 1, applicationName: 'carteira-igaming-migrate' });
  try {
    const applied = await runMigrations(pool, undefined, (msg) => console.log(msg));
    console.log(applied.length ? `${applied.length} migração(ões) aplicada(s)` : 'schema já está atualizado');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
