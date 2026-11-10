import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import { DomainError } from '../common/errors';

export const PROVIDER_API_KEY_HEADER = 'x-api-key';

interface ProviderRequest extends Request {
  provider?: string;
}

/** Autentica o provedor de jogo pela API key e anexa o código dele à requisição. */
@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ProviderRequest>();
    const apiKey = req.header(PROVIDER_API_KEY_HEADER);
    const provider = apiKey ? this.config.providerForApiKey(apiKey) : undefined;
    if (!provider) throw new DomainError('INVALID_API_KEY', 'API key do provedor ausente ou inválida');
    req.provider = provider;
    return true;
  }
}

/** Código do provedor autenticado (as chaves de idempotência são por provedor). */
export const ProviderCode = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const provider = ctx.switchToHttp().getRequest<ProviderRequest>().provider;
  if (!provider) throw new Error('ProviderCode usado sem ProviderAuthGuard');
  return provider;
});
