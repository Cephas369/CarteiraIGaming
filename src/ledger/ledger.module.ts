import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [ReconciliationController],
  providers: [LedgerService, ReconciliationService],
  exports: [LedgerService, ReconciliationService],
})
export class LedgerModule {}
