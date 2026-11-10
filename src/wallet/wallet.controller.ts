import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CreateWalletDto, StatementDto, StatementQueryDto, WalletDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('carteiras')
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Post()
  @ApiOperation({ summary: 'Cria a carteira do jogador (idempotente: 201 na criação, 200 se já existe)' })
  @ApiOkResponse({ type: WalletDto })
  async create(@Body() dto: CreateWalletDto, @Res({ passthrough: true }) res: Response): Promise<WalletDto> {
    const { wallet, created } = await this.wallets.create(dto.playerId, dto.currency);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return wallet;
  }

  @Get(':playerId')
  @ApiOperation({ summary: 'Saldo da carteira' })
  @ApiOkResponse({ type: WalletDto })
  get(@Param('playerId') playerId: string): Promise<WalletDto> {
    return this.wallets.get(playerId);
  }

  @Get(':playerId/statement')
  @ApiOperation({ summary: 'Extrato (lançamentos do ledger), do mais recente para o mais antigo' })
  @ApiOkResponse({ type: StatementDto })
  statement(@Param('playerId') playerId: string, @Query() query: StatementQueryDto): Promise<StatementDto> {
    return this.wallets.statement(playerId, query.limit, query.before);
  }
}
