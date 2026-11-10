import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { PixWorkerModule } from './pix/pix-worker.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [ConfigModule, DatabaseModule, QueueModule, PixWorkerModule],
})
export class WorkerModule {}
