import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { centsToJson } from '../common/money';
import {
  BalanceRequestDto,
  BalanceResponseDto,
  BetRequestDto,
  ErrorResponseDto,
  GameTransactionResponseDto,
  RollbackRequestDto,
  WinRequestDto,
} from './dto/provider.dto';
import { ProviderAuthGuard, ProviderCode } from './provider-auth.guard';
import { GameTransactionResult, ProviderWalletService } from './provider-wallet.service';

/** Header presente quando a resposta é de uma transação já processada (reenvio). */
export const REPLAY_HEADER = 'Idempotent-Replayed';

@ApiTags('provedor de jogo (seamless wallet)')
@ApiSecurity('provider-key')
@UseGuards(ProviderAuthGuard)
@Controller('provider/v1')
export class ProviderController {
  constructor(private readonly wallet: ProviderWalletService) {}

  @Post('balance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Saldo do jogador' })
  @ApiOkResponse({ type: BalanceResponseDto })
  async balance(@Body() dto: BalanceRequestDto): Promise<BalanceResponseDto> {
    const { balance, currency } = await this.wallet.balance(dto.playerId);
    return { balance: centsToJson(balance), currency };
  }

  @Post('bet')
  @HttpCode(200)
  @ApiOperation({ summary: 'Debita a aposta (idempotente pelo transactionId)' })
  @ApiOkResponse({ type: GameTransactionResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'INSUFFICIENT_FUNDS, CURRENCY_MISMATCH' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'IDEMPOTENCY_CONFLICT, TRANSACTION_ROLLED_BACK' })
  async bet(
    @ProviderCode() provider: string,
    @Body() dto: BetRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GameTransactionResponseDto> {
    return respond(res, await this.wallet.bet(provider, dto));
  }

  @Post('win')
  @HttpCode(200)
  @ApiOperation({ summary: 'Credita o prêmio (idempotente pelo transactionId)' })
  @ApiOkResponse({ type: GameTransactionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'IDEMPOTENCY_CONFLICT' })
  async win(
    @ProviderCode() provider: string,
    @Body() dto: WinRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GameTransactionResponseDto> {
    return respond(res, await this.wallet.win(provider, dto));
  }

  @Post('rollback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Estorna uma aposta (idempotente pelo transactionId do rollback)',
    description:
      'Rollback de aposta desconhecida é aceito e registrado com valor zero; se a aposta chegar depois, é recusada.',
  })
  @ApiOkResponse({ type: GameTransactionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'BET_ALREADY_ROLLED_BACK, IDEMPOTENCY_CONFLICT' })
  async rollback(
    @ProviderCode() provider: string,
    @Body() dto: RollbackRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GameTransactionResponseDto> {
    return respond(res, await this.wallet.rollback(provider, dto));
  }
}

function respond(res: Response, result: GameTransactionResult): GameTransactionResponseDto {
  if (result.replayed) res.setHeader(REPLAY_HEADER, 'true');
  return { transactionId: result.transactionId, balance: centsToJson(result.balance), currency: result.currency };
}
