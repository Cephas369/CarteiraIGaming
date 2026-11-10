import { Pool } from 'pg';

export interface PoolSettings {
  connectionString: string;
  max?: number;
  applicationName?: string;
}

export function createPool({ connectionString, max = 20, applicationName = 'carteira-igaming' }: PoolSettings): Pool {
  return new Pool({
    connectionString,
    max,
    application_name: applicationName,
    // Ninguém espera um lock de carteira para sempre: depois de 5s o provedor recebe 503 e reenvia.
    lock_timeout: 5_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
    connectionTimeoutMillis: 5_000,
  });
}
