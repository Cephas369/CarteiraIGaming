import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().min(1).default('wallet'),
  PIX_WEBHOOK_SECRET: z.string().min(16, 'PIX_WEBHOOK_SECRET precisa de pelo menos 16 caracteres'),
  // "provedor:chave,outro-provedor:outra-chave"
  GAME_PROVIDER_KEYS: z.string().min(1),
  DEV_ENDPOINTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

interface ProviderCredential {
  provider: string;
  keyDigest: Buffer;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Configuração tipada, validada uma única vez no boot. Se uma variável estiver
 * errada o processo nem sobe: falhar cedo é melhor do que falhar no meio de uma aposta.
 */
export class AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly redisUrl: string;
  readonly queuePrefix: string;
  readonly pixWebhookSecret: string;
  readonly devEndpoints: boolean;
  private readonly providers: ProviderCredential[];

  private constructor(env: z.infer<typeof envSchema>) {
    this.nodeEnv = env.NODE_ENV;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.dbPoolMax = env.DB_POOL_MAX;
    this.redisUrl = env.REDIS_URL;
    this.queuePrefix = env.QUEUE_PREFIX;
    this.pixWebhookSecret = env.PIX_WEBHOOK_SECRET;
    this.devEndpoints = env.DEV_ENDPOINTS;
    this.providers = parseProviderKeys(env.GAME_PROVIDER_KEYS);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Configuração inválida: ${issues}`);
    }
    return new AppConfig(parsed.data);
  }

  /** Resolve o provedor pela API key, comparando digests em tempo constante. */
  providerForApiKey(apiKey: string): string | undefined {
    const candidate = digest(apiKey);
    let match: string | undefined;
    for (const { provider, keyDigest } of this.providers) {
      if (timingSafeEqual(candidate, keyDigest)) match = provider;
    }
    return match;
  }
}

export function parseProviderKeys(raw: string): ProviderCredential[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0 || idx === pair.length - 1) {
        throw new Error(`GAME_PROVIDER_KEYS inválido perto de "${pair}" (formato: provedor:chave)`);
      }
      return { provider: pair.slice(0, idx), keyDigest: digest(pair.slice(idx + 1)) };
    });
  if (entries.length === 0) throw new Error('GAME_PROVIDER_KEYS não pode ser vazio');
  return entries;
}
