import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { redisConnectionOptions } from './redis-connection';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: redisConnectionOptions(config.redisUrl),
        prefix: config.queuePrefix,
      }),
    }),
  ],
})
export class QueueModule {}
