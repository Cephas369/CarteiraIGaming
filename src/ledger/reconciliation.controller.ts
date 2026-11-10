import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationReport, ReconciliationService } from './reconciliation.service';

@ApiTags('admin')
@Controller('admin')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('reconciliation')
  @ApiOperation({
    summary: 'Confere os invariantes do ledger',
    description:
      'Saldo materializado = soma do ledger por carteira; toda transação soma zero; ' +
      'balance_after encadeado sem buracos; soma global = 0. Roda num snapshot consistente.',
  })
  run(): Promise<ReconciliationReport> {
    return this.reconciliation.run();
  }
}
