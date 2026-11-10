import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { PermanentFailure } from '../common/errors';
import { PixDeadLetterService } from './pix-dead-letter.service';
import { CreditOutcome, PixDepositService } from './pix-deposit.service';
import { PIX_DEPOSITS_QUEUE, PixDepositJob } from './pix.constants';

/**
 * Worker que credita depósitos Pix. Entrega "pelo menos uma vez" do BullMQ + consumidor
 * idempotente = efeito exatamente uma vez no saldo.
 *
 * Erro transitório (banco fora, lock_timeout): retry com backoff exponencial.
 * Erro permanente (txid desconhecido): UnrecoverableError, vai direto para a DLQ.
 */
@Processor(PIX_DEPOSITS_QUEUE, { concurrency: 8 })
export class PixDepositProcessor extends WorkerHost {
  private readonly logger = new Logger(PixDepositProcessor.name);

  constructor(
    private readonly deposits: PixDepositService,
    private readonly deadLetters: PixDeadLetterService,
  ) {
    super();
  }

  async process(job: Job<PixDepositJob>): Promise<{ status: string; balance?: number }> {
    let outcome: CreditOutcome;
    try {
      outcome = await this.deposits.credit(job.data.eventId);
    } catch (error) {
      if (error instanceof PermanentFailure) throw new UnrecoverableError(error.message);
      throw error;
    }
    if (outcome.status === 'CREDITED') {
      this.logger.log(`evento ${job.data.eventId} creditado (saldo ${outcome.balance})`);
      return { status: outcome.status, balance: Number(outcome.balance) };
    }
    return { status: outcome.status };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<PixDepositJob> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const exhausted = error instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;
    try {
      await this.deposits.recordFailure(job.data.eventId, error.message, exhausted);
      if (!exhausted) {
        this.logger.warn(`evento ${job.data.eventId}: tentativa ${job.attemptsMade}/${maxAttempts} falhou: ${error.message}`);
        return;
      }
      await this.deadLetters.add({
        eventId: job.data.eventId,
        jobId: job.id,
        error: error.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });
      this.logger.error(`evento ${job.data.eventId} enviado para a DLQ: ${error.message}`);
    } catch (bookkeepingError) {
      // o job falho continua guardado no BullMQ (removeOnFail: false), então nada se perde
      this.logger.error(`falha ao registrar erro do evento ${job.data.eventId}: ${(bookkeepingError as Error).message}`);
    }
  }
}
