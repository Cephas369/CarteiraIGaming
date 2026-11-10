import { HttpStatus } from '@nestjs/common';

export const ErrorCode = {
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  CHARGE_NOT_FOUND: HttpStatus.NOT_FOUND,
  EVENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_API_KEY: HttpStatus.UNAUTHORIZED,
  INVALID_SIGNATURE: HttpStatus.UNAUTHORIZED,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
  CURRENCY_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_ROLLBACK_TARGET: HttpStatus.UNPROCESSABLE_ENTITY,
  // mesmo transactionId reaproveitado com outro conteúdo (valor, jogador, tipo...)
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  // um segundo rollback (com outro transactionId) para uma aposta já estornada
  BET_ALREADY_ROLLED_BACK: HttpStatus.CONFLICT,
  // aposta que chega depois do rollback dela (rollback "antecipado")
  TRANSACTION_ROLLED_BACK: HttpStatus.CONFLICT,
  EVENT_NOT_REPROCESSABLE: HttpStatus.CONFLICT,
  // lock_timeout na linha da carteira: o provedor deve reenviar
  WALLET_BUSY: HttpStatus.SERVICE_UNAVAILABLE,
  QUEUE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
} as const;

export type ErrorCode = keyof typeof ErrorCode;

/** Erro de regra de negócio, com código estável que o cliente pode tratar. */
export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = ErrorCode[code];
  }
}

/** Falha que não adianta repetir (ex.: txid que não existe). O worker manda direto para a DLQ. */
export class PermanentFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFailure';
  }
}
