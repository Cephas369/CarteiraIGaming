export const E2E_PROVIDER = 'acme-games';
export const E2E_PROVIDER_KEY = 'e2e-provider-key';
export const E2E_PIX_SECRET = 'e2e-pix-webhook-secret-0123456789';

/** Postgres e Redis reais: por padrão os do docker compose (docker compose up -d postgres redis). */
export const E2E_DATABASE_ADMIN_URL =
  process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://wallet:wallet@127.0.0.1:55432/postgres';
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:56379/15';
export const E2E_DATABASE_NAME = 'wallet_e2e';
