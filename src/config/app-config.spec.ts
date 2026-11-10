import { AppConfig } from './app-config';

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  PIX_WEBHOOK_SECRET: 'a-secret-with-16-chars',
  GAME_PROVIDER_KEYS: 'acme:key-a, other:key-b',
};

describe('AppConfig', () => {
  it('resolve o provedor pela API key', () => {
    const config = AppConfig.fromEnv(baseEnv);
    expect(config.providerForApiKey('key-a')).toBe('acme');
    expect(config.providerForApiKey('key-b')).toBe('other');
    expect(config.providerForApiKey('key-c')).toBeUndefined();
    expect(config.providerForApiKey('')).toBeUndefined();
  });

  it('aplica defaults', () => {
    const config = AppConfig.fromEnv(baseEnv);
    expect(config.port).toBe(3000);
    expect(config.devEndpoints).toBe(false);
  });

  it('falha no boot com configuração inválida', () => {
    expect(() => AppConfig.fromEnv({ ...baseEnv, PIX_WEBHOOK_SECRET: 'curto' })).toThrow(/PIX_WEBHOOK_SECRET/);
    expect(() => AppConfig.fromEnv({ ...baseEnv, GAME_PROVIDER_KEYS: 'sem-dois-pontos' })).toThrow(/GAME_PROVIDER_KEYS/);
    expect(() => AppConfig.fromEnv({ ...baseEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
