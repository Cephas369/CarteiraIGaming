import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { toCents } from '../common/money';
import { Tx } from '../database/database';
import { LedgerAccount, LockedWallet, SystemAccount, SystemAccountKind, Transfer } from './accounts';

interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
}

/**
 * Único lugar que escreve no ledger e no saldo materializado. Tudo acontece dentro da
 * transação do chamador: lançamentos + atualização de saldo são atômicos.
 */
@Injectable()
export class LedgerService {
  // Sem acesso ao pool de propósito: tudo aqui roda na conexão da transação do chamador.
  private readonly systemAccounts = new Map<string, SystemAccount>();

  /**
   * Trava a linha da carteira até o fim da transação. Toda operação de dinheiro de um
   * jogador passa por aqui, então operações na mesma carteira ficam serializadas e
   * operações em carteiras diferentes seguem em paralelo.
   *
   * FOR NO KEY UPDATE em vez de FOR UPDATE: é exatamente o lock que um UPDATE de coluna
   * não-chave pega. Ele serializa os escritores da carteira, mas não bloqueia quem só
   * precisa do FOR KEY SHARE das FKs (ex.: criar uma cobrança Pix para esse jogador).
   */
  async lockWalletByPlayer(tx: Tx, playerId: string): Promise<LockedWallet> {
    const { rows } = await tx.query<WalletRow>(
      `SELECT id, player_id, currency, balance
         FROM accounts
        WHERE player_id = $1 AND kind = 'PLAYER'
          FOR NO KEY UPDATE`,
      [playerId],
    );
    if (!rows[0]) throw new DomainError('WALLET_NOT_FOUND', `carteira do jogador "${playerId}" não existe`);
    return toLockedWallet(rows[0]);
  }

  async lockWalletById(tx: Tx, accountId: string): Promise<LockedWallet> {
    const { rows } = await tx.query<WalletRow>(
      `SELECT id, player_id, currency, balance
         FROM accounts
        WHERE id = $1 AND kind = 'PLAYER'
          FOR NO KEY UPDATE`,
      [accountId],
    );
    if (!rows[0]) throw new DomainError('WALLET_NOT_FOUND', `carteira ${accountId} não existe`);
    return toLockedWallet(rows[0]);
  }

  /**
   * Contas de sistema são imutáveis depois de semeadas, então o id fica em cache.
   *
   * A consulta usa a conexão da transação (`tx`), nunca o pool: quem segura o lock de uma
   * carteira não pode pedir uma segunda conexão. Com o pool inteiro parado esperando esse
   * mesmo lock, a conexão extra nunca viria (deadlock entre pool e lock; o teste das 200
   * apostas simultâneas pegou exatamente isso).
   */
  async systemAccount(tx: Tx, kind: SystemAccountKind, currency: string): Promise<SystemAccount> {
    const cacheKey = `${kind}:${currency}`;
    const cached = this.systemAccounts.get(cacheKey);
    if (cached) return cached;

    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM accounts WHERE kind = $1 AND currency = $2',
      [kind, currency],
    );
    if (!rows[0]) throw new DomainError('CURRENCY_MISMATCH', `moeda ${currency} não tem conta ${kind} configurada`);
    const account: SystemAccount = { kind, id: rows[0].id, currency };
    this.systemAccounts.set(cacheKey, account);
    return account;
  }

  /**
   * Lançamento de dupla entrada: debita `from`, credita `to`, mesma quantia.
   * Valida tudo antes de escrever; o banco ainda confere no COMMIT que a transação
   * soma zero (constraint trigger) e que nenhuma carteira ficou negativa (CHECK).
   */
  async transfer(tx: Tx, t: Transfer): Promise<void> {
    if (t.amount <= 0n) throw new Error(`transfer exige valor positivo (recebeu ${t.amount})`);
    if (t.from.id === t.to.id) throw new Error('origem e destino do lançamento são a mesma conta');
    for (const account of [t.from, t.to]) {
      if (account.currency !== t.currency) {
        throw new DomainError('CURRENCY_MISMATCH', `conta em ${account.currency}, lançamento em ${t.currency}`);
      }
    }

    const legs: Array<{ account: LedgerAccount; amount: bigint }> = [
      { account: t.from, amount: -t.amount },
      { account: t.to, amount: t.amount },
    ];
    const balancesAfter = legs.map(({ account, amount }) =>
      account.kind === 'PLAYER' ? account.balance + amount : null,
    );
    if (balancesAfter.some((b) => b !== null && b < 0n)) {
      throw new DomainError('INSUFFICIENT_FUNDS', 'saldo insuficiente');
    }

    await tx.query(
      `INSERT INTO ledger_transactions (id, kind, idempotency_key, currency)
       VALUES ($1, $2, $3, $4)`,
      [t.journalId, t.kind, t.idempotencyKey, t.currency],
    );
    await tx.query(
      `INSERT INTO ledger_entries (ledger_transaction_id, account_id, amount, balance_after)
       SELECT $1, e.account_id, e.amount, e.balance_after
         FROM unnest($2::uuid[], $3::bigint[], $4::bigint[]) AS e(account_id, amount, balance_after)`,
      [
        t.journalId,
        legs.map((l) => l.account.id),
        legs.map((l) => l.amount.toString()),
        balancesAfter.map((b) => (b === null ? null : b.toString())),
      ],
    );

    for (const [i, { account, amount }] of legs.entries()) {
      if (account.kind !== 'PLAYER') continue;
      const { rows } = await tx.query<{ balance: string }>(
        `UPDATE accounts
            SET balance = balance + $2, updated_at = now()
          WHERE id = $1
      RETURNING balance`,
        [account.id, amount.toString()],
      );
      const persisted = toCents(rows[0].balance);
      // Com o lock de linha isto nunca dispara. Se disparar, alguém movimentou a carteira sem travá-la.
      if (persisted !== balancesAfter[i]) {
        throw new Error(`lost update na carteira ${account.id}: esperado ${balancesAfter[i]}, banco tem ${persisted}`);
      }
      account.balance = persisted;
    }
  }
}

function toLockedWallet(row: WalletRow): LockedWallet {
  return {
    kind: 'PLAYER',
    id: row.id,
    playerId: row.player_id,
    currency: row.currency,
    balance: toCents(row.balance),
  } as LockedWallet;
}
