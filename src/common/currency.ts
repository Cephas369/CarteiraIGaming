/** Moedas com contas de sistema semeadas na migração. Adicionar uma moeda = semear HOUSE e PIX_CLEARING dela. */
export const SUPPORTED_CURRENCIES = ['BRL'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
