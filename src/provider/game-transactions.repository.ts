import { Injectable } from '@nestjs/common';
import { toCents } from '../common/money';
import { Queryable, Tx } from '../database/database';

export type GameTransactionType = 'BET' | 'WIN' | 'ROLLBACK';

export interface GameTransaction {
  id: string;
  provider: string;
  externalId: string;
  type: GameTransactionType;
  accountId: string;
  roundId: string | null;
  amount: bigint;
  currency: string;
  referenceExternalId: string | null;
  ledgerTransactionId: string | null;
  balanceAfter: bigint;
}

export type NewGameTransaction = Omit<GameTransaction, 'id'>;

interface Row {
  id: string;
  provider: string;
  external_id: string;
  type: GameTransactionType;
  account_id: string;
  round_id: string | null;
  amount: string;
  currency: string;
  reference_external_id: string | null;
  ledger_transaction_id: string | null;
  balance_after: string;
}

@Injectable()
export class GameTransactionsRepository {
  /**
   * Idempotência garantida pelo banco: INSERT ... ON CONFLICT DO NOTHING na chave
   * (provider, external_id). Devolve o id se inseriu, ou null se a transação já existia.
   * Nunca "consulta e depois insere": entre a consulta e o insert outra requisição
   * igual poderia passar.
   */
  async insertIfAbsent(tx: Tx, t: NewGameTransaction): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO game_transactions
         (provider, external_id, type, account_id, round_id, amount, currency,
          reference_external_id, ledger_transaction_id, balance_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING id`,
      [
        t.provider,
        t.externalId,
        t.type,
        t.accountId,
        t.roundId,
        t.amount.toString(),
        t.currency,
        t.referenceExternalId,
        t.ledgerTransactionId,
        t.balanceAfter.toString(),
      ],
    );
    return rows[0]?.id ?? null;
  }

  async findByExternalId(q: Queryable, provider: string, externalId: string): Promise<GameTransaction | null> {
    const { rows } = await q.query<Row>(
      `SELECT id, provider, external_id, type, account_id, round_id, amount, currency,
              reference_external_id, ledger_transaction_id, balance_after
         FROM game_transactions
        WHERE provider = $1 AND external_id = $2`,
      [provider, externalId],
    );
    return rows[0] ? toModel(rows[0]) : null;
  }

  /** Existe rollback (mesmo que "antecipado", sem aposta) para este transactionId de aposta? */
  async hasRollbackFor(tx: Tx, provider: string, betExternalId: string): Promise<boolean> {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM game_transactions
        WHERE provider = $1 AND reference_external_id = $2 AND type = 'ROLLBACK'`,
      [provider, betExternalId],
    );
    return (rowCount ?? 0) > 0;
  }
}

function toModel(r: Row): GameTransaction {
  return {
    id: r.id,
    provider: r.provider,
    externalId: r.external_id,
    type: r.type,
    accountId: r.account_id,
    roundId: r.round_id,
    amount: toCents(r.amount),
    currency: r.currency,
    referenceExternalId: r.reference_external_id,
    ledgerTransactionId: r.ledger_transaction_id,
    balanceAfter: toCents(r.balance_after),
  };
}
