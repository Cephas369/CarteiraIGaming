import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PermanentFailure } from '../common/errors';
import { toCents } from '../common/money';
import { Database } from '../database/database';
import { LedgerService } from '../ledger/ledger.service';

export type CreditOutcome = { status: 'CREDITED'; balance: bigint } | { status: 'ALREADY_CREDITED' };

/**
 * Credita um evento de Pix na carteira. Pode ser chamado N vezes para o mesmo evento
 * (retry do BullMQ, job duplicado, reprocessamento manual) e credita no máximo uma:
 *   - o evento é travado (FOR UPDATE) e o status CREDITED encerra cedo;
 *   - o lançamento usa a chave única "pix:<endToEndId>" no ledger, então mesmo um bug
 *     que pulasse a checagem de status bateria na constraint do banco.
 */
@Injectable()
export class PixDepositService {
  private readonly logger = new Logger(PixDepositService.name);

  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
  ) {}

  credit(eventId: string): Promise<CreditOutcome> {
    return this.db.transaction(async (tx) => {
      // ordem de locks fixa (evento -> cobrança -> carteira) para não haver deadlock
      const { rows: events } = await tx.query<{ end_to_end_id: string; txid: string; amount: string; status: string }>(
        'SELECT end_to_end_id, txid, amount, status FROM pix_webhook_events WHERE id = $1 FOR UPDATE',
        [eventId],
      );
      const event = events[0];
      if (!event) throw new PermanentFailure(`evento ${eventId} não existe`);
      if (event.status === 'CREDITED') return { status: 'ALREADY_CREDITED' };

      const { rows: charges } = await tx.query<{ id: string; account_id: string; amount: string }>(
        'SELECT id, account_id, amount FROM pix_charges WHERE txid = $1 FOR UPDATE',
        [event.txid],
      );
      const charge = charges[0];
      if (!charge) throw new PermanentFailure(`txid ${event.txid} não corresponde a nenhuma cobrança`);

      const wallet = await this.ledger.lockWalletById(tx, charge.account_id);
      const clearing = await this.ledger.systemAccount(tx, 'PIX_CLEARING', wallet.currency);
      const amount = toCents(event.amount);
      if (amount !== toCents(charge.amount)) {
        // o dinheiro que chegou é o que vale; a divergência fica registrada para o financeiro
        this.logger.warn(`Pix ${event.end_to_end_id}: recebido ${amount}, cobrança era ${charge.amount}`);
      }

      const journalId = randomUUID();
      await this.ledger.transfer(tx, {
        journalId,
        kind: 'DEPOSIT',
        idempotencyKey: `pix:${event.end_to_end_id}`,
        currency: wallet.currency,
        from: clearing,
        to: wallet,
        amount,
      });
      await tx.query(
        `UPDATE pix_webhook_events
            SET status = 'CREDITED', ledger_transaction_id = $2, processed_at = now(), last_error = NULL
          WHERE id = $1`,
        [eventId, journalId],
      );
      await tx.query(`UPDATE pix_charges SET status = 'PAID', paid_at = COALESCE(paid_at, now()) WHERE id = $1`, [
        charge.id,
      ]);
      return { status: 'CREDITED', balance: wallet.balance };
    });
  }

  /** Registra a tentativa que falhou; na última, marca o evento como FAILED. */
  async recordFailure(eventId: string, error: string, final: boolean): Promise<void> {
    await this.db.query(
      `UPDATE pix_webhook_events
          SET attempts = attempts + 1,
              last_error = $2,
              status = CASE WHEN $3::boolean AND status <> 'CREDITED' THEN 'FAILED' ELSE status END
        WHERE id = $1`,
      [eventId, error.slice(0, 2_000), final],
    );
  }
}
