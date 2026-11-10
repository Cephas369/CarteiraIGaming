import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { centsToJson, toCents } from '../common/money';
import { Database } from '../database/database';
import { StatementDto, WalletDto } from './wallet.dto';

interface WalletRow {
  player_id: string;
  balance: string;
  currency: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly db: Database) {}

  /** Idempotente pelo playerId: criar duas vezes devolve a mesma carteira. */
  async create(playerId: string, currency = 'BRL'): Promise<{ wallet: WalletDto; created: boolean }> {
    const inserted = await this.db.query<WalletRow>(
      `INSERT INTO accounts (kind, player_id, currency, balance)
       VALUES ('PLAYER', $1, $2, 0)
       ON CONFLICT (player_id) DO NOTHING
       RETURNING player_id, balance, currency`,
      [playerId, currency],
    );
    if (inserted.rows[0]) return { wallet: toDto(inserted.rows[0]), created: true };

    const wallet = await this.get(playerId);
    if (wallet.currency !== currency) {
      throw new DomainError('CURRENCY_MISMATCH', `jogador já tem carteira em ${wallet.currency}`);
    }
    return { wallet, created: false };
  }

  async get(playerId: string): Promise<WalletDto> {
    const { rows } = await this.db.query<WalletRow>(
      `SELECT player_id, balance, currency FROM accounts WHERE player_id = $1 AND kind = 'PLAYER'`,
      [playerId],
    );
    if (!rows[0]) throw new DomainError('WALLET_NOT_FOUND', `carteira do jogador "${playerId}" não existe`);
    return toDto(rows[0]);
  }

  /** Extrato direto do ledger, paginado por cursor (keyset) no id do lançamento. */
  async statement(playerId: string, limit = 50, before?: string): Promise<StatementDto> {
    const { rows } = await this.db.query<{
      id: string;
      kind: string;
      amount: string;
      balance_after: string;
      idempotency_key: string;
      created_at: Date;
    }>(
      `SELECT e.id, t.kind, e.amount, e.balance_after, t.idempotency_key, e.created_at
         FROM accounts a
         JOIN ledger_entries e ON e.account_id = a.id
         JOIN ledger_transactions t ON t.id = e.ledger_transaction_id
        WHERE a.player_id = $1 AND a.kind = 'PLAYER'
          AND ($2::bigint IS NULL OR e.id < $2::bigint)
        ORDER BY e.id DESC
        LIMIT $3`,
      [playerId, before ?? null, limit + 1],
    );
    if (rows.length === 0) await this.get(playerId); // 404 se a carteira não existe

    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        entryId: r.id,
        kind: r.kind,
        amount: centsToJson(toCents(r.amount)),
        balanceAfter: centsToJson(toCents(r.balance_after)),
        reference: r.idempotency_key,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}

function toDto(row: WalletRow): WalletDto {
  return { playerId: row.player_id, balance: centsToJson(toCents(row.balance)), currency: row.currency };
}
