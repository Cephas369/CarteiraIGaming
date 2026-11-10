import {
  Body,
  CanActivate,
  Controller,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import { formatDecimalAmount } from '../common/money';
import { generateEndToEndId } from './br-code';
import { SimulatedPaymentDto, SimulatePixPaymentDto } from './dto/pix.dto';
import { PixChargesService } from './pix-charges.service';
import { PIX_SIGNATURE_HEADER, signPixPayload } from './pix-signature';

@Injectable()
class DevEndpointsGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.devEndpoints) throw new NotFoundException();
    return true;
  }
}

/**
 * Faz o papel do PSP em ambiente de desenvolvimento: monta o webhook de pagamento,
 * assina com o segredo compartilhado e manda para /webhooks/pix pela rede, exatamente
 * como um PSP faria. Desligado quando DEV_ENDPOINTS != true.
 */
@ApiTags('dev: PSP simulado')
@UseGuards(DevEndpointsGuard)
@Controller('dev/psp')
export class DevPspController {
  constructor(
    private readonly config: AppConfig,
    private readonly charges: PixChargesService,
  ) {}

  @Post('pix/:txid/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Simula o pagamento da cobrança e dispara o webhook assinado' })
  @ApiOkResponse({ type: SimulatedPaymentDto })
  async pay(
    @Param('txid') txid: string,
    @Body() dto: SimulatePixPaymentDto,
    @Req() req: Request,
  ): Promise<SimulatedPaymentDto> {
    const charge = await this.charges.findByTxid(txid);
    const endToEndId = dto.endToEndId ?? generateEndToEndId();
    const amount = BigInt(dto.amount ?? charge.amount);
    const body = JSON.stringify({
      pix: [{ endToEndId, txid, valor: formatDecimalAmount(amount), horario: new Date().toISOString() }],
    });

    const response = await fetch(`${req.protocol}://${req.get('host')}/webhooks/pix`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PIX_SIGNATURE_HEADER]: signPixPayload(body, this.config.pixWebhookSecret),
      },
      body,
    });
    return { endToEndId, webhookStatus: response.status };
  }
}
