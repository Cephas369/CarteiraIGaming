import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Database } from '../../src/database/database';
import { generateEndToEndId } from '../../src/pix/br-code';
import { PIX_SIGNATURE_HEADER, signPixPayload } from '../../src/pix/pix-signature';
import { PIX_DEAD_LETTER_QUEUE, PIX_DEPOSITS_QUEUE } from '../../src/pix/pix.constants';
import { PixWorkerModule } from '../../src/pix/pix-worker.module';
import { E2E_PIX_SECRET, E2E_PROVIDER_KEY } from './constants';

// respostas HTTP nos testes: o formato é verificado pelas próprias asserções
export type Json = any;

export interface HttpResult {
  status: number;
  body: Json;
  headers: Headers;
}

export type ProviderOperation = 'balance' | 'bet' | 'win' | 'rollback';

/** Cliente HTTP de verdade (fetch) contra a app escutando numa porta: passa por pipes, guards e filtros. */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }

  provider(operation: ProviderOperation, body: unknown, apiKey = E2E_PROVIDER_KEY): Promise<HttpResult> {
    return this.request('POST', `/provider/v1/${operation}`, body, { 'x-api-key': apiKey });
  }

  bet(playerId: string, transactionId: string, amount: number, extra: Record<string, unknown> = {}): Promise<HttpResult> {
    return this.provider('bet', { transactionId, playerId, roundId: `round-${transactionId}`, amount, currency: 'BRL', ...extra });
  }

  win(playerId: string, transactionId: string, amount: number, extra: Record<string, unknown> = {}): Promise<HttpResult> {
    return this.provider('win', { transactionId, playerId, roundId: `round-${transactionId}`, amount, currency: 'BRL', ...extra });
  }

  rollback(playerId: string, transactionId: string, referenceTransactionId: string): Promise<HttpResult> {
    return this.provider('rollback', { transactionId, playerId, referenceTransactionId });
  }

  async createWallet(playerId: string): Promise<void> {
    const res = await this.request('POST', '/wallets', { playerId });
    if (res.status !== 201 && res.status !== 200) throw new Error(`createWallet ${res.status}: ${JSON.stringify(res.body)}`);
  }

  async balance(playerId: string): Promise<number> {
    const res = await this.request('GET', `/wallets/${playerId}`);
    if (res.status !== 200) throw new Error(`balance ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.balance;
  }

  async createCharge(playerId: string, amount: number): Promise<{ txid: string; amount: number }> {
    const res = await this.request('POST', '/deposits/pix', { playerId, amount });
    if (res.status !== 201) throw new Error(`createCharge ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  /** Envia o webhook como o PSP: corpo cru + HMAC desse corpo exato. */
  sendPixWebhook(rawBody: string, signature = signPixPayload(rawBody, E2E_PIX_SECRET)): Promise<HttpResult> {
    const headers: Record<string, string> = signature ? { [PIX_SIGNATURE_HEADER]: signature } : {};
    return this.request('POST', '/webhooks/pix', rawBody, headers);
  }

  /** Depósito completo pelo caminho real: cobrança -> webhook assinado -> worker -> ledger. */
  async deposit(playerId: string, amount: number): Promise<string> {
    const before = await this.balance(playerId);
    const charge = await this.createCharge(playerId, amount);
    const endToEndId = generateEndToEndId();
    const res = await this.sendPixWebhook(pixWebhookBody({ endToEndId, txid: charge.txid, amount }));
    if (res.status !== 200) throw new Error(`webhook ${res.status}: ${JSON.stringify(res.body)}`);
    await waitFor(() => this.balance(playerId), (b) => b === before + amount);
    return endToEndId;
  }
}

export function pixWebhookBody({ endToEndId, txid, amount }: { endToEndId: string; txid: string; amount: number }): string {
  const valor = `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
  return JSON.stringify({ pix: [{ endToEndId, txid, valor, horario: new Date().toISOString() }] });
}

export interface Harness {
  app: INestApplication;
  api: ApiClient;
  db: Database;
  depositsQueue: Queue;
  deadLetterQueue: Queue;
  close(): Promise<void>;
}

/** Sobe API + worker no mesmo processo, escutando numa porta aleatória. */
export async function startApp(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, PixWorkerModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
  configureApp(app, { swagger: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  return {
    app,
    api: new ApiClient(baseUrl),
    db: app.get(Database),
    depositsQueue: app.get<Queue>(getQueueToken(PIX_DEPOSITS_QUEUE), { strict: false }),
    deadLetterQueue: app.get<Queue>(getQueueToken(PIX_DEAD_LETTER_QUEUE), { strict: false }),
    close: () => app.close(),
  };
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 15_000, intervalMs = 25 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await probe();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: condição não atingida em ${timeoutMs}ms (último valor: ${JSON.stringify(last)})`);
}

export async function waitForQueueIdle(queue: Queue): Promise<void> {
  await waitFor(
    () => queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'paused'),
    (counts) => Object.values(counts).every((n) => n === 0),
  );
}

export const uniquePlayer = (prefix = 'p'): string => `${prefix}-${randomUUID().slice(0, 8)}`;

export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** PRNG determinístico (mulberry32): carga "aleatória" reproduzível pelo seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
