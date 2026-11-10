/**
 * Dinheiro é sempre inteiro em centavos. No banco é `bigint`; o driver `pg` devolve
 * `bigint` como string (para não perder precisão) e aqui vira `BigInt` do JavaScript.
 * Float nunca entra no caminho do dinheiro: 0.1 + 0.2 !== 0.3.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Converte o valor vindo do driver (string) para BigInt. */
export function toCents(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`valor em centavos inválido: ${value}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new RangeError(`valor em centavos inválido: "${value}"`);
  return BigInt(value);
}

/**
 * Na API, centavos trafegam como inteiros JSON. Até 2^53 centavos (~R$ 90 trilhões) a
 * conversão é exata; acima disso preferimos falhar a arredondar.
 */
export function centsToJson(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new RangeError(`valor fora do intervalo seguro: ${value}`);
  return Number(value);
}

const DECIMAL_BRL = /^(\d{1,15})\.(\d{2})$/;

/**
 * O padrão da API Pix manda `valor` como string decimal com 2 casas ("110.00").
 * Converte por manipulação de string, sem parseFloat.
 */
export function parseDecimalAmount(valor: string): bigint {
  const match = DECIMAL_BRL.exec(valor);
  if (!match) throw new RangeError(`valor decimal inválido: "${valor}" (esperado formato 123.45)`);
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

export function formatDecimalAmount(cents: bigint): string {
  if (cents < 0n) throw new RangeError('valor negativo');
  const reais = cents / 100n;
  const centavos = (cents % 100n).toString().padStart(2, '0');
  return `${reais}.${centavos}`;
}
