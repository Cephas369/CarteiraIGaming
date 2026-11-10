import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../common/errors';
import { toCents } from '../common/money';
import { Database, Tx } from '../database/database';
import { LockedWallet } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { BetRequestDto, RollbackRequestDto, WinRequestDto } from './dto/provider.dto';
import { GameTransaction, GameTransactionsRepository } from './game-transactions.repository';

export interface GameTransactionResult {
  transactionId: string;
  balance: bigint;
  currency: string;
  /** true quando a resposta veio de uma transação já processada (reenvio do provedor) */
  replayed: boolean;
}

type ExpectedFields = Partial<Pick<GameTransaction, 'type' | 'accountId' | 'amount' | 'roundId' | 'referenceExternalId'>>;

/**
 * Seamless wallet: o provedor do jogo chama a carteira para debitar a aposta,
 * creditar o prêmio e estornar. Cada operação é UMA transação no Postgres:
 *
 *   1. trava a carteira            SELECT ... FOR NO KEY UPDATE
 *   2. registra a transação        INSERT ... ON CONFLICT DO NOTHING  (idempotência)
 *      - não inseriu? é reenvio: devolve a resposta original
 *   3. lança no ledger e atualiza o saldo
 *   4. COMMIT
 *
 * A ordem 2 → 3 importa: o reenvio de uma aposta que já passou precisa devolver sucesso,
 * mesmo que agora o saldo não cubra mais o valor.
 */
@Injectable()
export class ProviderWalletService {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly gameTxs: GameTransactionsRepository,
  ) {}

  async balance(playerId: string): Promise<{ balance: bigint; currency: string }> {
    const { rows } = await this.db.query<{ balance: string; currency: string }>(
      `SELECT balance, currency FROM accounts WHERE player_id = $1 AND kind = 'PLAYER'`,
      [playerId],
    );
    if (!rows[0]) throw new DomainError('WALLET_NOT_FOUND', `carteira do jogador "${playerId}" não existe`);
    return { balance: toCents(rows[0].balance), currency: rows[0].currency };
  }

  bet(provider: string, req: BetRequestDto): Promise<GameTransactionResult> {
    return this.db.transaction(async (tx) => {
      const wallet = await this.ledger.lockWalletByPlayer(tx, req.playerId);
      assertCurrency(wallet, req.currency);
      const amount = BigInt(req.amount);
      const journalId = amount > 0n ? randomUUID() : null;

      const id = await this.gameTxs.insertIfAbsent(tx, {
        provider,
        externalId: req.transactionId,
        type: 'BET',
        accountId: wallet.id,
        roundId: req.roundId,
        amount,
        currency: wallet.currency,
        referenceExternalId: null,
        ledgerTransactionId: journalId,
        balanceAfter: wallet.balance - amount,
      });
      if (!id) {
        return this.replay(tx, provider, req.transactionId, {
          type: 'BET',
          accountId: wallet.id,
          amount,
          roundId: req.roundId,
        });
      }

      // O provedor pode mandar o rollback antes da aposta (timeout do lado dele).
      // Nesse caso o rollback ficou registrado e a aposta que chega depois é recusada.
      if (await this.gameTxs.hasRollbackFor(tx, provider, req.transactionId)) {
        throw new DomainError('TRANSACTION_ROLLED_BACK', `aposta ${req.transactionId} já foi cancelada por um rollback`);
      }

      if (journalId) {
        const house = await this.ledger.systemAccount(tx, 'HOUSE', wallet.currency);
        // lança INSUFFICIENT_FUNDS se não houver saldo; o ROLLBACK desfaz o INSERT acima
        await this.ledger.transfer(tx, {
          journalId,
          kind: 'BET',
          idempotencyKey: ledgerKey(provider, req.transactionId),
          currency: wallet.currency,
          from: wallet,
          to: house,
          amount,
        });
      }
      return { transactionId: id, balance: wallet.balance, currency: wallet.currency, replayed: false };
    });
  }

  win(provider: string, req: WinRequestDto): Promise<GameTransactionResult> {
    return this.db.transaction(async (tx) => {
      const wallet = await this.ledger.lockWalletByPlayer(tx, req.playerId);
      assertCurrency(wallet, req.currency);
      const amount = BigInt(req.amount);
      const journalId = amount > 0n ? randomUUID() : null;

      const id = await this.gameTxs.insertIfAbsent(tx, {
        provider,
        externalId: req.transactionId,
        type: 'WIN',
        accountId: wallet.id,
        roundId: req.roundId,
        amount,
        currency: wallet.currency,
        referenceExternalId: null,
        ledgerTransactionId: journalId,
        balanceAfter: wallet.balance + amount,
      });
      if (!id) {
        return this.replay(tx, provider, req.transactionId, {
          type: 'WIN',
          accountId: wallet.id,
          amount,
          roundId: req.roundId,
        });
      }

      // win de valor zero é comum (fim de rodada perdida): registra, mas não lança no ledger
      if (journalId) {
        const house = await this.ledger.systemAccount(tx, 'HOUSE', wallet.currency);
        await this.ledger.transfer(tx, {
          journalId,
          kind: 'WIN',
          idempotencyKey: ledgerKey(provider, req.transactionId),
          currency: wallet.currency,
          from: house,
          to: wallet,
          amount,
        });
      }
      return { transactionId: id, balance: wallet.balance, currency: wallet.currency, replayed: false };
    });
  }

  rollback(provider: string, req: RollbackRequestDto): Promise<GameTransactionResult> {
    return this.db.transaction(async (tx) => {
      const wallet = await this.ledger.lockWalletByPlayer(tx, req.playerId);
      const bet = await this.gameTxs.findByExternalId(tx, provider, req.referenceTransactionId);
      if (bet && bet.type !== 'BET') {
        throw new DomainError('INVALID_ROLLBACK_TARGET', 'só apostas podem ser estornadas');
      }
      if (bet && bet.accountId !== wallet.id) {
        throw new DomainError('INVALID_ROLLBACK_TARGET', 'a aposta referenciada pertence a outro jogador');
      }

      // Sem aposta: registra o rollback mesmo assim ("tombstone", valor zero), para recusar a aposta se ela chegar depois.
      const amount = bet?.amount ?? 0n;
      const journalId = amount > 0n ? randomUUID() : null;

      // Um segundo rollback (outro transactionId) da mesma aposta viola o índice único
      // game_transactions_one_rollback_per_bet e vira 409 BET_ALREADY_ROLLED_BACK.
      const id = await this.gameTxs.insertIfAbsent(tx, {
        provider,
        externalId: req.transactionId,
        type: 'ROLLBACK',
        accountId: wallet.id,
        roundId: bet?.roundId ?? req.roundId ?? null,
        amount,
        currency: wallet.currency,
        referenceExternalId: req.referenceTransactionId,
        ledgerTransactionId: journalId,
        balanceAfter: wallet.balance + amount,
      });
      if (!id) {
        return this.replay(tx, provider, req.transactionId, {
          type: 'ROLLBACK',
          accountId: wallet.id,
          referenceExternalId: req.referenceTransactionId,
        });
      }

      if (journalId) {
        const house = await this.ledger.systemAccount(tx, 'HOUSE', wallet.currency);
        await this.ledger.transfer(tx, {
          journalId,
          kind: 'ROLLBACK',
          idempotencyKey: ledgerKey(provider, req.transactionId),
          currency: wallet.currency,
          from: house,
          to: wallet,
          amount,
        });
      }
      return { transactionId: id, balance: wallet.balance, currency: wallet.currency, replayed: false };
    });
  }

  /**
   * Reenvio: devolve exatamente a resposta original (saldo daquele momento), desde que o
   * conteúdo seja o mesmo. Mesmo transactionId com outro valor/jogador é erro do provedor.
   */
  private async replay(
    tx: Tx,
    provider: string,
    externalId: string,
    expected: ExpectedFields,
  ): Promise<GameTransactionResult> {
    const existing = await this.gameTxs.findByExternalId(tx, provider, externalId);
    if (!existing) throw new Error(`conflito de idempotência sem registro para ${provider}/${externalId}`);

    const mismatched = (Object.keys(expected) as Array<keyof ExpectedFields>).filter(
      (field) => existing[field] !== expected[field],
    );
    if (mismatched.length > 0) {
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        `transactionId ${externalId} já foi usado com outros dados (${mismatched.join(', ')})`,
      );
    }
    return {
      transactionId: existing.id,
      balance: existing.balanceAfter,
      currency: existing.currency,
      replayed: true,
    };
  }
}

function assertCurrency(wallet: LockedWallet, currency: string): void {
  if (wallet.currency !== currency) {
    throw new DomainError('CURRENCY_MISMATCH', `carteira em ${wallet.currency}, requisição em ${currency}`);
  }
}

function ledgerKey(provider: string, externalId: string): string {
  return `game:${provider}:${externalId}`;
}
