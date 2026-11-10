import { CanActivate, ExecutionContext, Injectable, RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import { DomainError } from '../common/errors';
import { PIX_SIGNATURE_HEADER, verifyPixSignature } from './pix-signature';

/** Roda antes da validação do corpo: payload sem assinatura válida nem chega a ser interpretado. */
@Injectable()
export class PixSignatureGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const valid =
      req.rawBody !== undefined &&
      verifyPixSignature(req.rawBody, req.header(PIX_SIGNATURE_HEADER), this.config.pixWebhookSecret);
    if (!valid) throw new DomainError('INVALID_SIGNATURE', 'assinatura do webhook ausente ou inválida');
    return true;
  }
}
