import { centsToJson, formatDecimalAmount, parseDecimalAmount, toCents } from './money';

describe('money', () => {
  describe('parseDecimalAmount (valor do Pix, string com 2 casas)', () => {
    it.each([
      ['110.00', 11_000n],
      ['0.01', 1n],
      ['0.10', 10n],
      ['19.99', 1_999n],
      ['999999999999999.99', 99_999_999_999_999_999n],
    ])('%s -> %s centavos', (valor, cents) => {
      expect(parseDecimalAmount(valor)).toBe(cents);
    });

    it('não sofre com o erro de ponto flutuante clássico', () => {
      // em float: 0.1 + 0.2 = 0.30000000000000004
      expect(parseDecimalAmount('0.10') + parseDecimalAmount('0.20')).toBe(parseDecimalAmount('0.30'));
    });

    it.each(['1', '1.5', '1.555', '-1.00', '1e3', 'abc', '', ' 1.00', '1,00', '.50'])('rejeita "%s"', (valor) => {
      expect(() => parseDecimalAmount(valor)).toThrow(RangeError);
    });
  });

  it('formatDecimalAmount é o inverso de parseDecimalAmount', () => {
    for (const cents of [0n, 1n, 9n, 10n, 99n, 100n, 1_999n, 11_000n, 123_456_789n]) {
      expect(parseDecimalAmount(formatDecimalAmount(cents))).toBe(cents);
    }
    expect(formatDecimalAmount(5n)).toBe('0.05');
  });

  it('toCents converte a string que o driver pg devolve para bigint', () => {
    expect(toCents('9007199254740993')).toBe(9_007_199_254_740_993n); // além de 2^53, sem perda
    expect(toCents('-250')).toBe(-250n);
    expect(() => toCents('1.5')).toThrow(RangeError);
    expect(() => toCents(0.5)).toThrow(RangeError);
  });

  it('centsToJson falha em vez de arredondar fora do intervalo seguro', () => {
    expect(centsToJson(12_345n)).toBe(12_345);
    expect(() => centsToJson(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
