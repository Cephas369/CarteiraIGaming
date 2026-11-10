import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponseDto } from '../provider/dto/provider.dto';
import { PixWebhookAckDto, PixWebhookDto } from './dto/pix.dto';
import { PIX_SIGNATURE_HEADER } from './pix-signature';
import { PixSignatureGuard } from './pix-signature.guard';
import { PixWebhookService } from './pix-webhook.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class PixWebhookController {
  constructor(private readonly webhooks: PixWebhookService) {}

  @Post('pix')
  @HttpCode(200)
  @UseGuards(PixSignatureGuard)
  @ApiOperation({
    summary: 'Webhook de Pix recebido do PSP',
    description:
      'Valida o HMAC do corpo cru, grava cada pagamento (único pelo endToEndId) e enfileira o crédito. ' +
      'Responde 200 também para reenvios: o PSP só precisa saber que recebemos.',
  })
  @ApiHeader({ name: PIX_SIGNATURE_HEADER, description: 'sha256=<hex do HMAC-SHA256 do corpo cru>', required: true })
  @ApiOkResponse({ type: PixWebhookAckDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  receive(@Body() dto: PixWebhookDto, @Req() req: Request): Promise<PixWebhookAckDto> {
    // req.body é o JSON original (o ValidationPipe trabalha numa cópia); é ele que vai para o payload gravado
    const rawItems = Array.isArray(req.body?.pix) ? (req.body.pix as unknown[]) : [];
    return this.webhooks.ingest(dto.pix, rawItems);
  }
}
