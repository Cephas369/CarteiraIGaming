import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DomainError } from '../common/errors';
import { Database } from '../database/database';
import { DeadLetterDto } from './dto/pix.dto';
import {
  deadLetterJobId,
  PIX_DEAD_LETTER_QUEUE,
  PIX_DEPOSITS_QUEUE,
  PixDeadLetterJob,
  PixDepositJob,
} from './pix.constants';

/** Fila de falhas: ninguém consome automaticamente. Um humano olha, corrige a causa e reprocessa. */
@Injectable()
export class PixDeadLetterService {
  constructor(
    private readonly db: Database,
    @InjectQueue(PIX_DEPOSITS_QUEUE) private readonly deposits: Queue<PixDepositJob>,
    @InjectQueue(PIX_DEAD_LETTER_QUEUE) private readonly deadLetters: Queue<PixDeadLetterJob>,
  ) {}

  async add(entry: PixDeadLetterJob): Promise<void> {
    await this.deadLetters.add('dead-letter', entry, { jobId: deadLetterJobId(entry.eventId) });
  }

  async list(limit = 100): Promise<DeadLetterDto[]> {
    const jobs = await this.deadLetters.getJobs(['waiting', 'paused', 'delayed', 'prioritized'], 0, limit - 1);
    return jobs.map((job) => ({
      jobId: job.id ?? '',
      eventId: job.data.eventId,
      error: job.data.error,
      attemptsMade: job.data.attemptsMade,
      failedAt: job.data.failedAt,
    }));
  }

  /** Volta o evento para RECEIVED e enfileira de novo. O crédito continua idempotente. */
  async reprocess(eventId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE pix_webhook_events SET status = 'RECEIVED', last_error = NULL
        WHERE id = $1 AND status = 'FAILED'`,
      [eventId],
    );
    if (!rowCount) {
      const exists = await this.db.query('SELECT 1 FROM pix_webhook_events WHERE id = $1', [eventId]);
      if (!exists.rowCount) throw new DomainError('EVENT_NOT_FOUND', `evento ${eventId} não existe`);
      throw new DomainError('EVENT_NOT_REPROCESSABLE', 'só eventos com status FAILED podem ser reprocessados');
    }
    // o job antigo (falho) ainda ocupa o jobId; remove para poder enfileirar com o mesmo id
    await this.deposits.remove(eventId);
    await this.deadLetters.remove(deadLetterJobId(eventId));
    await this.deposits.add('credit', { eventId }, { jobId: eventId });
  }
}
