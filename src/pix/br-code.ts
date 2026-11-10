import { randomBytes } from 'node:crypto';
import { formatDecimalAmount } from '../common/money';

/**
 * "Pix copia e cola" simulado no formato EMV do BR Code (campos TLV + CRC16).
 * Serve para a demo parecer real; nenhum banco vai aceitar esse QR.
 */
export function buildSimulatedBrCode(txid: string, amount: bigint): string {
  const field = (id: string, value: string) => `${id}${value.length.toString().padStart(2, '0')}${value}`;
  const merchantAccount = field('00', 'br.gov.bcb.pix') + field('25', `pix.example.com/qr/v2/${txid}`);
  const payload =
    field('00', '01') +
    field('26', merchantAccount) +
    field('52', '0000') +
    field('53', '986') +
    field('54', formatDecimalAmount(amount)) +
    field('58', 'BR') +
    field('59', 'CARTEIRA IGAMING') +
    field('60', 'SAO PAULO') +
    field('62', field('05', '***')) +
    '6304';
  return payload + crc16(payload);
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), como pede o BR Code. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** txid da cobrança: 26 a 35 caracteres alfanuméricos (aqui, 32 hex). */
export function generateTxid(): string {
  return randomBytes(16).toString('hex');
}

/** endToEndId no formato do SPI: E + ISPB (8) + AAAAMMDDHHmm + 11 alfanuméricos. */
export function generateEndToEndId(now = new Date()): string {
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const suffix = randomBytes(8).toString('hex').slice(0, 11);
  return `E00000000${ts}${suffix}`;
}
