import { Injectable } from '@nestjs/common';
import { centsToJson, toCents } from '../common/money';
import { Database } from '../database/database';

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: string;
  walletsChecked: number;
  /** carteiras cujo saldo materializado difere da soma do ledger */
  walletMismatches: Array<{ playerId: string; balance: number; ledgerBalance: number }>;
  /** transações de ledger que não somam zero ou têm menos de 2 lançamentos */
  unbalancedTransactions: Array<{ ledgerTransactionId: string; sum: number; entries: number }>;
  /** lançamentos cujo balance_after difere da soma acumulada da conta (buraco ou fora de ordem) */
  brokenBalanceChains: number;
  /** soma de todos os lançamentos do sistema: em dupla entrada é sempre zero */
  ledgerSum: number;
  /** saldo derivado das contas de sistema (resultado da casa, Pix a liquidar) */
  systemAccounts: Array<{ kind: string; currency: string; balance: number }>;
}

/**
 * Verifica os invariantes do ledger. Roda num único snapshot (REPEATABLE READ, READ ONLY)
 * para que escritas concorrentes não gerem falsos positivos entre uma consulta e outra.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly db: Database) {}

  run(): Promise<ReconciliationReport> {
    return this.db.transaction(
      async (tx) => {
        const wallets = await tx.query<{ player_id: string; balance: string; ledger_balance: string }>(
          `SELECT a.player_id, a.balance, COALESCE(e.total, 0) AS ledger_balance
             FROM accounts a
             LEFT JOIN (SELECT account_id, SUM(amount) AS total FROM ledger_entries GROUP BY account_id) e
                    ON e.account_id = a.id
            WHERE a.kind = 'PLAYER'`,
        );

        const unbalanced = await tx.query<{ id: string; total: string; entries: string }>(
          `SELECT t.id, COALESCE(SUM(e.amount), 0) AS total, COUNT(e.id) AS entries
             FROM ledger_transactions t
             LEFT JOIN ledger_entries e ON e.ledger_transaction_id = t.id
            GROUP BY t.id
           HAVING COALESCE(SUM(e.amount), 0) <> 0 OR COUNT(e.id) < 2`,
        );

        const chains = await tx.query<{ broken: string }>(
          `SELECT COUNT(*) AS broken
             FROM (SELECT e.balance_after,
                          SUM(e.amount) OVER (PARTITION BY e.account_id ORDER BY e.id) AS running
                     FROM ledger_entries e
                     JOIN accounts a ON a.id = e.account_id
                    WHERE a.kind = 'PLAYER') s
            WHERE s.balance_after IS DISTINCT FROM s.running`,
        );

        const total = await tx.query<{ total: string }>(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries',
        );

        const system = await tx.query<{ kind: string; currency: string; balance: string }>(
          `SELECT a.kind, a.currency, COALESCE(SUM(e.amount), 0) AS balance
             FROM accounts a
             LEFT JOIN ledger_entries e ON e.account_id = a.id
            WHERE a.kind <> 'PLAYER'
            GROUP BY a.id, a.kind, a.currency
            ORDER BY a.kind, a.currency`,
        );

        const walletMismatches = wallets.rows
          .filter((w) => toCents(w.balance) !== toCents(w.ledger_balance))
          .map((w) => ({
            playerId: w.player_id,
            balance: centsToJson(toCents(w.balance)),
            ledgerBalance: centsToJson(toCents(w.ledger_balance)),
          }));
        const unbalancedTransactions = unbalanced.rows.map((r) => ({
          ledgerTransactionId: r.id,
          sum: centsToJson(toCents(r.total)),
          entries: Number(r.entries),
        }));
        const brokenBalanceChains = Number(chains.rows[0].broken);
        const ledgerSum = centsToJson(toCents(total.rows[0].total));

        return {
          ok:
            walletMismatches.length === 0 &&
            unbalancedTransactions.length === 0 &&
            brokenBalanceChains === 0 &&
            ledgerSum === 0,
          checkedAt: new Date().toISOString(),
          walletsChecked: wallets.rowCount ?? wallets.rows.length,
          walletMismatches,
          unbalancedTransactions,
          brokenBalanceChains,
          ledgerSum,
          systemAccounts: system.rows.map((s) => ({
            kind: s.kind,
            currency: s.currency,
            balance: centsToJson(toCents(s.balance)),
          })),
        };
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );
  }
}
