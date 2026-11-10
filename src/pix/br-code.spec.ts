import { buildSimulatedBrCode, crc16, generateEndToEndId, generateTxid } from './br-code';

describe('BR Code simulado', () => {
  it('CRC16/CCITT-FALSE bate com o vetor de teste padrão', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('gera um copia-e-cola com valor e CRC válidos', () => {
    const code = buildSimulatedBrCode('a'.repeat(32), 5_000n);
    expect(code.startsWith('000201')).toBe(true);
    expect(code).toContain('540550.00');
    expect(crc16(code.slice(0, -4))).toBe(code.slice(-4));
  });

  it('txid e endToEndId seguem os formatos do Pix', () => {
    expect(generateTxid()).toMatch(/^[a-zA-Z0-9]{26,35}$/);
    expect(generateEndToEndId(new Date('2026-11-10T14:06:00Z'))).toMatch(/^E00000000202611101406[0-9a-f]{11}$/);
  });
});
