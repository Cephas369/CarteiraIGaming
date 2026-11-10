import Redis from 'ioredis';
import { Client, Pool } from 'pg';
import { runMigrations } from '../../src/database/migrator';
import {
  E2E_DATABASE_ADMIN_URL,
  E2E_DATABASE_NAME,
  E2E_PIX_SECRET,
  E2E_PROVIDER,
  E2E_PROVIDER_KEY,
  E2E_REDIS_URL,
} from './constants';

/**
 * Banco novo a cada execução: DROP/CREATE de um database dedicado e as mesmas migrações
 * de produção. Nada de mock nem SQLite: os testes rodam contra Postgres de verdade, com
 * os mesmos locks, constraints e triggers.
 */
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: E2E_DATABASE_ADMIN_URL, connectionTimeoutMillis: 5_000 });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Postgres de teste indisponível em ${E2E_DATABASE_ADMIN_URL} (${(error as Error).message}). ` +
        'Suba com: docker compose up -d postgres redis',
    );
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${E2E_DATABASE_NAME}`);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(E2E_DATABASE_ADMIN_URL);
  databaseUrl.pathname = `/${E2E_DATABASE_NAME}`;
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }

  const redis = new Redis(E2E_REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb(); // só o db de teste (/15), nunca o de desenvolvimento
  } finally {
    redis.disconnect();
  }

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl.toString(),
    DB_POOL_MAX: '20',
    REDIS_URL: E2E_REDIS_URL,
    QUEUE_PREFIX: 'e2e',
    PIX_WEBHOOK_SECRET: E2E_PIX_SECRET,
    GAME_PROVIDER_KEYS: `${E2E_PROVIDER}:${E2E_PROVIDER_KEY}`,
    DEV_ENDPOINTS: 'true',
  });
}
