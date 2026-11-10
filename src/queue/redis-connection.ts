import type { ConnectionOptions } from 'bullmq';

/** Converte redis://user:pass@host:port/db em opções do ioredis (usado pelo BullMQ). */
export function redisConnectionOptions(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // exigido pelos Workers do BullMQ: comandos bloqueantes não podem ter limite de retry
    maxRetriesPerRequest: null,
  };
}
