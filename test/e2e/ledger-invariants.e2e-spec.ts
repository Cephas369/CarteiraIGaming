import { randomUUID } from 'node:crypto';
import { generateEndToEndId } from '../../src/pix/br-code';
import { Harness, HttpResult, pixWebhookBody, range, seededRandom, startApp, uniquePlayer, waitForQueueIdle } from './harness';

describe('Invariantes do ledger', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startApp();
  });

  afterAll(async () => {
    await h.close();
  });

  it('carga aleatória e concorrente mantém: soma do ledger = saldo, toda transação soma zero', async () => {
    const random = seededRandom(20_261_110);
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
    const amount = (max: number) => 1 + Math.floor(random() * max);

    const players = await Promise.all(
      range(6).map(async () => {
        const playerId = uniquePlayer('inv');
        await h.api.createWallet(playerId);
        await h.api.deposit(playerId, 20_000);
        return playerId;
      }),
    );

    const bets: Array<{ playerId: string; transactionId: string }> = [];
    const sent: Array<() => Promise<HttpResult>> = [];
    let seq = 0;

    const nextOperation = (): (() => Promise<HttpResult>) => {
      const roll = random();
      const playerId = pick(players);
      const id = `inv-${seq++}`;
      let op: () => Promise<HttpResult>;

      if (roll < 0.45) {
        const value = amount(2_500);
        bets.push({ playerId, transactionId: id });
        op = () => h.api.bet(playerId, id, value);
      } else if (roll < 0.7) {
        const value = random() < 0.3 ? 0 : amount(3_000);
        op = () => h.api.win(playerId, id, value);
      } else if (roll < 0.8 && bets.length > 0) {
        // estorna uma aposta qualquer; às vezes ela ainda nem foi enviada (rollback antecipado)
        const target = pick(bets);
        op = () => h.api.rollback(target.playerId, id, target.transactionId);
      } else if (roll < 0.9 && sent.length > 0) {
        op = pick(sent); // reenvio idêntico de algo já mandado
      } else {
        const value = amount(5_000);
        let body: string | undefined; // memorizado: reenviar esta operação reenvia o MESMO Pix
        op = async () => {
          if (!body) {
            const charge = await h.api.createCharge(playerId, value);
            body = pixWebhookBody({ endToEndId: generateEndToEndId(), txid: charge.txid, amount: value });
          }
          const first = await h.api.sendPixWebhook(body);
          await h.api.sendPixWebhook(body); // o PSP reenviando
          return first;
        };
      }
      sent.push(op);
      return op;
    };

    const results: HttpResult[] = [];
    for (let batch = 0; batch < 12; batch++) {
      const ops = range(40).map(() => nextOperation());
      results.push(...(await Promise.all(ops.map((op) => op()))));
    }
    await waitForQueueIdle(h.depositsQueue);

    // nenhuma resposta inesperada: só sucesso ou recusas de negócio
    const allowed = new Set(['INSUFFICIENT_FUNDS', 'BET_ALREADY_ROLLED_BACK', 'TRANSACTION_ROLLED_BACK']);
    const unexpected = results.filter((r) => r.status !== 200 && !allowed.has(r.body?.code));
    expect(unexpected).toEqual([]);

    // 1) a reconciliação da própria aplicação
    const report = (await h.api.request('GET', '/admin/reconciliation')).body;
    expect(report).toMatchObject({
      ok: true,
      walletMismatches: [],
      unbalancedTransactions: [],
      brokenBalanceChains: 0,
      ledgerSum: 0,
    });

    // 2) e uma conferência independente, com SQL escrito aqui no teste
    const { rows } = await h.db.query<{ player_id: string; balance: string; ledger: string }>(
      `SELECT a.player_id, a.balance, COALESCE(SUM(e.amount), 0)::bigint AS ledger
         FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.player_id = ANY($1)
        GROUP BY a.id`,
      [players],
    );
    expect(rows).toHaveLength(players.length);
    for (const row of rows) {
      expect(row.balance).toBe(row.ledger);
      expect(BigInt(row.balance)).toBeGreaterThanOrEqual(0n);
    }
  });

  describe('o banco recusa violações mesmo vindas de fora da aplicação', () => {
    let playerId: string;
    let entryId: string;

    beforeAll(async () => {
      playerId = uniquePlayer('guard');
      await h.api.createWallet(playerId);
      await h.api.deposit(playerId, 1_000);
      const { rows } = await h.db.query<{ id: string }>(
        `SELECT e.id FROM ledger_entries e JOIN accounts a ON a.id = e.account_id WHERE a.player_id = $1`,
        [playerId],
      );
      entryId = rows[0].id;
    });

    it('ledger é append-only: UPDATE, DELETE e TRUNCATE falham', async () => {
      await expect(h.db.query('UPDATE ledger_entries SET amount = amount * 2 WHERE id = $1', [entryId])).rejects.toThrow(/append-only/);
      await expect(h.db.query('DELETE FROM ledger_entries WHERE id = $1', [entryId])).rejects.toThrow(/append-only/);
      await expect(h.db.query('TRUNCATE ledger_entries CASCADE')).rejects.toThrow(/append-only/);
    });

    it('lançamento desbalanceado não passa do COMMIT', async () => {
      await expect(
        h.db.transaction(async (tx) => {
          const journalId = randomUUID();
          await tx.query(`INSERT INTO ledger_transactions (id, kind, idempotency_key, currency) VALUES ($1, 'DEPOSIT', $2, 'BRL')`, [
            journalId,
            `manual:${journalId}`,
          ]);
          // dinheiro do nada: só a perna de crédito
          await tx.query(
            `INSERT INTO ledger_entries (ledger_transaction_id, account_id, amount)
             SELECT $1, id, 100 FROM accounts WHERE player_id = $2`,
            [journalId, playerId],
          );
        }),
      ).rejects.toThrow(/desbalanceada/);
    });

    it('saldo negativo é recusado pelo CHECK da carteira', async () => {
      await expect(h.db.query('UPDATE accounts SET balance = -1 WHERE player_id = $1', [playerId])).rejects.toThrow(
        /accounts_balance_non_negative/,
      );
    });

    it('o mesmo fato de negócio não vira dois lançamentos (chave única no ledger)', async () => {
      const { rows } = await h.db.query<{ idempotency_key: string }>(
        `SELECT t.idempotency_key FROM ledger_transactions t JOIN ledger_entries e ON e.ledger_transaction_id = t.id WHERE e.id = $1`,
        [entryId],
      );
      await expect(
        h.db.query(`INSERT INTO ledger_transactions (id, kind, idempotency_key, currency) VALUES ($1, 'DEPOSIT', $2, 'BRL')`, [
          randomUUID(),
          rows[0].idempotency_key,
        ]),
      ).rejects.toThrow(/ledger_transactions_idempotency_key_unique/);
    });
  });
});
