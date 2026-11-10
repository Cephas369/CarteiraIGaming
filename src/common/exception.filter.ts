import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { DatabaseError } from 'pg';
import { DomainError } from './errors';

/**
 * Traduz erros de domínio e alguns erros do Postgres para respostas HTTP estáveis.
 * As constraints do banco são a última linha de defesa: se uma regra escapar da
 * aplicação, o banco recusa e o cliente ainda recebe um código que faz sentido.
 */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const domain = exception instanceof DomainError ? exception : fromDatabaseError(exception);
    if (!domain) return super.catch(exception, host);

    const res = host.switchToHttp().getResponse<Response>();
    if (domain.status >= HttpStatus.INTERNAL_SERVER_ERROR) this.logger.warn(`${domain.code}: ${domain.message}`);
    res.status(domain.status).json({ statusCode: domain.status, code: domain.code, message: domain.message });
  }
}

function fromDatabaseError(error: unknown): DomainError | undefined {
  if (!(error instanceof DatabaseError)) return undefined;
  switch (error.code) {
    case '55P03': // lock_not_available (lock_timeout)
      return new DomainError('WALLET_BUSY', 'carteira ocupada, tente novamente');
    case '23505': // unique_violation
      if (error.constraint === 'game_transactions_one_rollback_per_bet') {
        return new DomainError('BET_ALREADY_ROLLED_BACK', 'esta aposta já foi estornada por outro rollback');
      }
      return undefined;
    case '23514': // check_violation
      if (error.constraint === 'accounts_balance_non_negative') {
        return new DomainError('INSUFFICIENT_FUNDS', 'saldo insuficiente');
      }
      return undefined;
    default:
      return undefined;
  }
}
