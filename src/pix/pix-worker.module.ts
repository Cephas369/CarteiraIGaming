import { Module } from '@nestjs/common';
import { PixDepositProcessor } from './pix-deposit.processor';
import { PixModule } from './pix.module';

/** Só o processo worker (e os testes e2e) importam este módulo: a API não consome a fila. */
@Module({
  imports: [PixModule],
  providers: [PixDepositProcessor],
})
export class PixWorkerModule {}
