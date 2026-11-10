import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PLAYER_ID_PATTERN } from '../../wallet/wallet.dto';

export class CreatePixChargeDto {
  @ApiProperty({ example: 'player-42' })
  @IsString()
  @Length(1, 64)
  @Matches(PLAYER_ID_PATTERN)
  playerId: string;

  @ApiProperty({ example: 5000, minimum: 1, description: 'centavos' })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;
}

export class PixChargeDto {
  @ApiProperty() chargeId: string;
  @ApiProperty({ example: '3f9a0c1e5b7d4e2a8c6b0f1d3e5a7c9b' }) txid: string;
  @ApiProperty({ example: 'player-42' }) playerId: string;
  @ApiProperty({ example: 5000 }) amount: number;
  @ApiProperty({ example: 'BRL' }) currency: string;
  @ApiProperty({ enum: ['PENDING', 'PAID'] }) status: string;
  @ApiProperty({ description: 'Pix copia e cola (simulado)' }) copyPaste: string;
  @ApiProperty() expiresAt: string;
  @ApiPropertyOptional({ nullable: true, type: String }) paidAt: string | null;
}

/** Um item do webhook no formato da API Pix do BCB: { pix: [ { endToEndId, txid, valor, horario } ] }. */
export class PixWebhookItemDto {
  @ApiProperty({ example: 'E00000000202611101406abcdef12345' })
  @IsString()
  @Length(1, 64)
  endToEndId: string;

  @ApiProperty({ example: '3f9a0c1e5b7d4e2a8c6b0f1d3e5a7c9b' })
  @Matches(/^[a-zA-Z0-9]{26,35}$/)
  txid: string;

  @ApiProperty({ example: '50.00', description: 'valor em reais, string com 2 casas decimais' })
  @Matches(/^\d{1,15}\.\d{2}$/)
  valor: string;

  @ApiProperty({ example: '2026-11-10T14:06:00.000Z' })
  @IsISO8601()
  horario: string;
}

export class PixWebhookDto {
  @ApiProperty({ type: [PixWebhookItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PixWebhookItemDto)
  pix: PixWebhookItemDto[];
}

export class PixWebhookAckDto {
  @ApiProperty({ example: 1, description: 'eventos novos gravados' }) accepted: number;
  @ApiProperty({ example: 0, description: 'eventos repetidos (mesmo endToEndId), ignorados' }) duplicates: number;
}

export class SimulatePixPaymentDto {
  @ApiPropertyOptional({ description: 'centavos; padrão: valor da cobrança' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount?: number;

  @ApiPropertyOptional({ description: 'reaproveite para simular o PSP reenviando o mesmo pagamento' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  endToEndId?: string;
}

export class SimulatedPaymentDto {
  @ApiProperty() endToEndId: string;
  @ApiProperty({ example: 200 }) webhookStatus: number;
}

export class DeadLetterDto {
  @ApiProperty() jobId: string;
  @ApiProperty() eventId: string;
  @ApiProperty() error: string;
  @ApiProperty() attemptsMade: number;
  @ApiProperty() failedAt: string;
}
