import { createHmac, timingSafeEqual } from 'node:crypto';

export const PIX_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * HMAC-SHA256 sobre o corpo CRU da requisição (os bytes exatos que chegaram).
 * Assinar o JSON re-serializado não funciona: ordem de chaves, espaços e escapes mudam
 * os bytes e a assinatura deixa de bater.
 */
export function signPixPayload(rawBody: Buffer | string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Comparação em tempo constante, para não vazar quantos bytes da assinatura estão certos. */
export function verifyPixSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(signPixPayload(rawBody, secret));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
