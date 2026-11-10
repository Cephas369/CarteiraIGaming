import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { centsToJson, toCents } from '../common/money';
import { Database } from '../database/database';
import { buildSimulatedBrCode, generateTxid } from './br-code';
import { PixChargeDto } from './dto/pix.dto';

const CHARGE_TTL_MS = 60 * 60 * 1000;

interface ChargeRow {
  id: string;
  txid: string;
  player_id: string;
  amount: string;
  currency: string;
  status: string;
  copy_paste: string;
  expires_at: Date;
  paid_at: Date | null;
}

@Injectable()
export class PixChargesService {
  constructor(private readonly db: Database) {}

  /** Cria a cobrança (o que um PSP faria ao gerar o QR Code). O crédito só acontece no webhook. */
  async create(playerId: string, amount: bigint): Promise<PixChargeDto> {
    const txid = generateTxid();
    const { rows } = await this.db.query<ChargeRow>(
      `INSERT INTO pix_charges (txid, account_id, amount, currency, copy_paste, expires_at)
       SELECT $1, a.id, $3, a.currency, $4, $5
         FROM accounts a
        WHERE a.player_id = $2 AND a.kind = 'PLAYER'
       RETURNING id, txid, $2::text AS player_id, amount, currency, status, copy_paste, expires_at, paid_at`,
      [txid, playerId, amount.toString(), buildSimulatedBrCode(txid, amount), new Date(Date.now() + CHARGE_TTL_MS)],
    );
    if (!rows[0]) throw new DomainError('WALLET_NOT_FOUND', `carteira do jogador "${playerId}" não existe`);
    return toDto(rows[0]);
  }

  async findByTxid(txid: string): Promise<PixChargeDto> {
    const { rows } = await this.db.query<ChargeRow>(
      `SELECT c.id, c.txid, a.player_id, c.amount, c.currency, c.status, c.copy_paste, c.expires_at, c.paid_at
         FROM pix_charges c
         JOIN accounts a ON a.id = c.account_id
        WHERE c.txid = $1`,
      [txid],
    );
    if (!rows[0]) throw new DomainError('CHARGE_NOT_FOUND', `cobrança ${txid} não existe`);
    return toDto(rows[0]);
  }
}

function toDto(r: ChargeRow): PixChargeDto {
  return {
    chargeId: r.id,
    txid: r.txid,
    playerId: r.player_id,
    amount: centsToJson(toCents(r.amount)),
    currency: r.currency,
    status: r.status,
    copyPaste: r.copy_paste,
    expiresAt: r.expires_at.toISOString(),
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  };
}
