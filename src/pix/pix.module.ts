import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { DevPspController } from './dev-psp.controller';
import { PixAdminController } from './pix-admin.controller';
import { PixChargesController } from './pix-charges.controller';
import { PixChargesService } from './pix-charges.service';
import { PixDeadLetterService } from './pix-dead-letter.service';
import { PixDepositService } from './pix-deposit.service';
import { PixSignatureGuard } from './pix-signature.guard';
import { PixWebhookController } from './pix-webhook.controller';
import { PixWebhookService } from './pix-webhook.service';
import { PIX_DEAD_LETTER_QUEUE, PIX_DEPOSIT_JOB_OPTIONS, PIX_DEPOSITS_QUEUE } from './pix.constants';

@Module({
  imports: [
    LedgerModule,
    BullModule.registerQueue(
      { name: PIX_DEPOSITS_QUEUE, defaultJobOptions: PIX_DEPOSIT_JOB_OPTIONS },
      { name: PIX_DEAD_LETTER_QUEUE },
    ),
  ],
  controllers: [PixChargesController, PixWebhookController, PixAdminController, DevPspController],
  providers: [PixChargesService, PixWebhookService, PixDepositService, PixDeadLetterService, PixSignatureGuard],
  exports: [BullModule, PixDepositService, PixDeadLetterService],
})
export class PixModule {}
