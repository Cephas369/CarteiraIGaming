import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppExceptionFilter } from './common/exception.filter';
import { createValidationPipe } from './common/validation';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { PixModule } from './pix/pix.module';
import { ProviderModule } from './provider/provider.module';
import { QueueModule } from './queue/queue.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    QueueModule,
    LedgerModule,
    WalletModule,
    ProviderModule,
    PixModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
