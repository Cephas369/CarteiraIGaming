import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../common/currency';

export const PLAYER_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class CreateWalletDto {
  @ApiProperty({ example: 'player-42', description: 'id do jogador na plataforma' })
  @IsString()
  @Length(1, 64)
  @Matches(PLAYER_ID_PATTERN)
  playerId: string;

  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES, default: 'BRL' })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

export class WalletDto {
  @ApiProperty({ example: 'player-42' })
  playerId: string;

  @ApiProperty({ example: 1500, description: 'saldo em centavos' })
  balance: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;
}

export class StatementQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor: id do último lançamento da página anterior' })
  @IsOptional()
  @Matches(/^\d{1,18}$/)
  before?: string;
}

export class StatementEntryDto {
  @ApiProperty({ example: '1042' })
  entryId: string;

  @ApiProperty({ enum: ['BET', 'WIN', 'ROLLBACK', 'DEPOSIT'] })
  kind: string;

  @ApiProperty({ example: -500, description: 'centavos; negativo = débito' })
  amount: number;

  @ApiProperty({ example: 1000 })
  balanceAfter: number;

  @ApiProperty({ example: 'game:acme-games:bet-123' })
  reference: string;

  @ApiProperty()
  createdAt: string;
}

export class StatementDto {
  @ApiProperty({ type: [StatementEntryDto] })
  items: StatementEntryDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor: string | null;
}
