import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DomainError } from '../common/errors';
import { parseDecimalAmount, toCents } from '../common/money';
import { Database } from '../database/database';
import { PixWebhookAckDto, PixWebhookItemDto } from './dto/pix.dto';
import { PIX_DEPOSITS_QUEUE, PixDepositJob } from './pix.constants';

/**
 * Recebe o webhook e faz o mínimo possível dentro da requisição: grava o evento (único
 * pelo endToEndId) e enfileira. O crédito acontece no worker. Assim o PSP recebe 200
 * rápido e uma lentidão no ledger não vira timeout e reenvio em massa.
 */
@Injectable()
export class PixWebhookService {
  private readonly logger = new Logger(PixWebhookService.name);

  constructor(
    private readonly db: Database,
    @InjectQueue(PIX_DEPOSITS_QUEUE) private readonly queue: Queue<PixDepositJob>,
  ) {}

  async ingest(items: PixWebhookItemDto[], rawItems: unknown[]): Promise<PixWebhookAckDto> {
    let accepted = 0;
    let duplicates = 0;

    for (const [i, item] of items.entries()) {
      const amount = parseDecimalAmount(item.valor);
      const inserted = await this.db.query<{ id: string }>(
        `INSERT INTO pix_webhook_events (end_to_end_id, txid, amount, paid_at, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (end_to_end_id) DO NOTHING
         RETURNING id`,
        [item.endToEndId, item.txid, amount.toString(), item.horario, JSON.stringify(rawItems[i] ?? item)],
      );

      if (inserted.rows[0]) {
        accepted++;
        await this.enqueue(inserted.rows[0].id);
        continue;
      }

      duplicates++;
      const { rows } = await this.db.query<{ id: string; status: string; amount: string }>(
        'SELECT id, status, amount FROM pix_webhook_events WHERE end_to_end_id = $1',
        [item.endToEndId],
      );
      const existing = rows[0];
      if (toCents(existing.amount) !== amount) {
        this.logger.warn(`webhook repetido para ${item.endToEndId} com valor diferente; mantendo o original`);
      }
      // Se a primeira entrega gravou o evento mas falhou ao enfileirar, o reenvio do PSP
      // conserta: enfileira de novo. O jobId = eventId impede job duplicado na fila.
      if (existing.status === 'RECEIVED') await this.enqueue(existing.id);
    }

    return { accepted, duplicates };
  }

  private async enqueue(eventId: string): Promise<void> {
    try {
      await this.queue.add('credit', { eventId }, { jobId: eventId });
    } catch (error) {
      this.logger.error(`falha ao enfileirar evento ${eventId}: ${(error as Error).message}`);
      // 503 faz o PSP reenviar; o evento já está gravado e será enfileirado no reenvio
      throw new DomainError('QUEUE_UNAVAILABLE', 'fila indisponível, reenvie o webhook');
    }
  }
}
