import type { DefaultJobOptions } from 'bullmq';

export const PIX_DEPOSITS_QUEUE = 'pix-deposits';
export const PIX_DEAD_LETTER_QUEUE = 'pix-deposits-dlq';

export interface PixDepositJob {
  eventId: string;
}

export interface PixDeadLetterJob {
  eventId: string;
  jobId: string | undefined;
  error: string;
  attemptsMade: number;
  failedAt: string;
}

export const PIX_DEPOSIT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  // 1s, 2s, 4s, 8s entre as tentativas
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: false,
};

export const deadLetterJobId = (eventId: string): string => `dlq-${eventId}`;
