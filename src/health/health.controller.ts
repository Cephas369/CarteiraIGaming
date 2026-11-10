import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { Database } from '../database/database';
import { PIX_DEPOSITS_QUEUE } from '../pix/pix.constants';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    @InjectQueue(PIX_DEPOSITS_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Verifica Postgres e Redis' })
  async check(): Promise<{ status: 'ok'; postgres: 'up'; redis: 'up' }> {
    try {
      await withTimeout(this.db.query('SELECT 1'), 'postgres');
      // com maxRetriesPerRequest: null o ioredis espera o Redis voltar para sempre; o timeout evita health pendurado
      await withTimeout(this.queue.getJobCounts('waiting'), 'redis');
    } catch (error) {
      throw new ServiceUnavailableException({ status: 'down', message: (error as Error).message });
    }
    return { status: 'ok', postgres: 'up', redis: 'up' };
  }
}

function withTimeout<T>(promise: Promise<T>, name: string, ms = 2_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} não respondeu em ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
