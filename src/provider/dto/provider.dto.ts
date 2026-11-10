import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { PLAYER_ID_PATTERN } from '../../wallet/wallet.dto';

export class BalanceRequestDto {
  @ApiProperty({ example: 'player-42' })
  @IsString()
  @Length(1, 64)
  @Matches(PLAYER_ID_PATTERN)
  playerId: string;
}

export class BalanceResponseDto {
  @ApiProperty({ example: 1500, description: 'centavos' })
  balance: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;
}

/** Corpo comum de bet e win. */
export class GameMoneyRequestDto {
  @ApiProperty({
    example: 'tx-9f1c2b',
    description: 'id da transação no provedor. É a chave de idempotência: reenvios devolvem a resposta original.',
  })
  @IsString()
  @Length(1, 128)
  transactionId: string;

  @ApiProperty({ example: 'player-42' })
  @IsString()
  @Length(1, 64)
  @Matches(PLAYER_ID_PATTERN)
  playerId: string;

  @ApiProperty({ example: 'round-77' })
  @IsString()
  @Length(1, 128)
  roundId: string;

  @ApiProperty({ example: 500, minimum: 0, description: 'valor em centavos (inteiro)' })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({ example: 'BRL' })
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}

export class BetRequestDto extends GameMoneyRequestDto {}

export class WinRequestDto extends GameMoneyRequestDto {}

export class RollbackRequestDto {
  @ApiProperty({ example: 'tx-rb-1', description: 'id do próprio rollback (chave de idempotência)' })
  @IsString()
  @Length(1, 128)
  transactionId: string;

  @ApiProperty({ example: 'player-42' })
  @IsString()
  @Length(1, 64)
  @Matches(PLAYER_ID_PATTERN)
  playerId: string;

  @ApiProperty({ example: 'tx-9f1c2b', description: 'transactionId da aposta a estornar' })
  @IsString()
  @Length(1, 128)
  referenceTransactionId: string;

  @ApiPropertyOptional({ example: 'round-77' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  roundId?: string;
}

export class GameTransactionResponseDto {
  @ApiProperty({ description: 'id da transação na carteira' })
  transactionId: string;

  @ApiProperty({ example: 1000, description: 'saldo em centavos após a transação' })
  balance: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'INSUFFICIENT_FUNDS' })
  code: string;

  @ApiProperty({ example: 'saldo insuficiente' })
  message: string;
}
