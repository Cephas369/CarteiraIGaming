import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreatePixChargeDto, PixChargeDto } from './dto/pix.dto';
import { PixChargesService } from './pix-charges.service';

@ApiTags('depósitos Pix')
@Controller('deposits/pix')
export class PixChargesController {
  constructor(private readonly charges: PixChargesService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma cobrança Pix (QR / copia e cola simulado)' })
  @ApiCreatedResponse({ type: PixChargeDto })
  create(@Body() dto: CreatePixChargeDto): Promise<PixChargeDto> {
    return this.charges.create(dto.playerId, BigInt(dto.amount));
  }

  @Get(':txid')
  @ApiOperation({ summary: 'Consulta a cobrança (PENDING até o webhook ser processado)' })
  @ApiOkResponse({ type: PixChargeDto })
  get(@Param('txid') txid: string): Promise<PixChargeDto> {
    return this.charges.findByTxid(txid);
  }
}
