import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { GameTransactionsRepository } from './game-transactions.repository';
import { ProviderAuthGuard } from './provider-auth.guard';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderController } from './provider.controller';

@Module({
  imports: [LedgerModule],
  controllers: [ProviderController],
  providers: [ProviderWalletService, GameTransactionsRepository, ProviderAuthGuard],
})
export class ProviderModule {}
