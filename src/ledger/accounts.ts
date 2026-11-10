export type SystemAccountKind = 'HOUSE' | 'PIX_CLEARING';
export type LedgerTransactionKind = 'BET' | 'WIN' | 'ROLLBACK' | 'DEPOSIT';

declare const lockedBrand: unique symbol;

/**
 * Carteira cuja linha está travada na transação corrente. Só o LedgerService cria
 * esse tipo (via SELECT ... FOR NO KEY UPDATE), então o compilador impede movimentar
 * saldo de uma carteira que não foi travada antes.
 */
export interface LockedWallet {
  readonly kind: 'PLAYER';
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  balance: bigint;
  readonly [lockedBrand]: true;
}

/** Conta de sistema: não tem saldo materializado, logo não precisa (nem deve) ser travada. */
export interface SystemAccount {
  readonly kind: SystemAccountKind;
  readonly id: string;
  readonly currency: string;
}

export type LedgerAccount = LockedWallet | SystemAccount;

export interface Transfer {
  /** id da ledger_transaction, gerado pelo chamador (pode ser referenciado antes de existir: FK deferida). */
  journalId: string;
  kind: LedgerTransactionKind;
  /** chave única do fato de negócio (ex.: "game:acme:bet-1", "pix:E123..."). */
  idempotencyKey: string;
  currency: string;
  from: LedgerAccount;
  to: LedgerAccount;
  amount: bigint;
}
