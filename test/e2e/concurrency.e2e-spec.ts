import { Harness, range, startApp, uniquePlayer } from './harness';

describe('Concorrência na mesma carteira', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startApp();
  });

  afterAll(async () => {
    await h.close();
  });

  // Também é a regressão do deadlock entre pool e lock: é a primeira aposta de uma app nova (cache da
  // conta HOUSE vazio), e a versão que buscava essa conta pelo pool aceitava só 4 das 133 apostas.
  it('200 apostas simultâneas terminam com saldo exato e nunca negativo', async () => {
    const INITIAL = 10_000;
    const BET = 75;
    const N = 200;
    const playerId = uniquePlayer('hot');
    await h.api.createWallet(playerId);
    await h.api.deposit(playerId, INITIAL);

    const results = await Promise.all(range(N).map((i) => h.api.bet(playerId, `${playerId}-bet-${i}`, BET)));

    const accepted = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status !== 200);
    const expectedAccepted = Math.floor(INITIAL / BET); // 133

    expect(accepted).toHaveLength(expectedAccepted);
    expect(rejected).toHaveLength(N - expectedAccepted);
    expect(rejected.every((r) => r.status === 422 && r.body.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await h.api.balance(playerId)).toBe(INITIAL - expectedAccepted * BET); // 25

    // Cada aposta aceita viu um saldo diferente, em degraus exatos de 75:
    // prova de que as transações foram serializadas, sem lost update.
    const seen = accepted.map((r) => r.body.balance as number).sort((a, b) => b - a);
    expect(seen).toEqual(range(expectedAccepted).map((i) => INITIAL - (i + 1) * BET));

    // Nenhum saldo intermediário negativo ficou registrado no ledger.
    const { rows } = await h.db.query<{ min: string; entries: string }>(
      `SELECT MIN(e.balance_after) AS min, COUNT(*) AS entries
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE a.player_id = $1`,
      [playerId],
    );
    expect(Number(rows[0].min)).toBeGreaterThanOrEqual(0);
    expect(Number(rows[0].entries)).toBe(1 + expectedAccepted); // depósito + apostas aceitas
  });

  it('a mesma aposta enviada 50 vezes ao mesmo tempo debita uma vez só', async () => {
    const playerId = uniquePlayer('dup');
    await h.api.createWallet(playerId);
    await h.api.deposit(playerId, 5_000);

    const results = await Promise.all(range(50).map(() => h.api.bet(playerId, `${playerId}-same`, 1_000)));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
    expect(results.every((r) => r.body.balance === 4_000)).toBe(true);
    expect(results.filter((r) => r.headers.get('idempotent-replayed') === 'true')).toHaveLength(49);
    expect(await h.api.balance(playerId)).toBe(4_000);
  });

  it('apostas e prêmios concorrentes em várias carteiras fecham a conta em todas', async () => {
    const players = await Promise.all(
      range(5).map(async () => {
        const playerId = uniquePlayer('multi');
        await h.api.createWallet(playerId);
        await h.api.deposit(playerId, 10_000);
        return playerId;
      }),
    );

    const calls = players.flatMap((playerId) => [
      ...range(40).map((i) => () => h.api.bet(playerId, `${playerId}-b${i}`, 50)),
      ...range(20).map((i) => () => h.api.win(playerId, `${playerId}-w${i}`, 30)),
    ]);
    // embaralha para intercalar apostas, prêmios e carteiras
    calls.sort(() => Math.random() - 0.5);
    const results = await Promise.all(calls.map((call) => call()));

    expect(results.every((r) => r.status === 200)).toBe(true);
    for (const playerId of players) {
      expect(await h.api.balance(playerId)).toBe(10_000 - 40 * 50 + 20 * 30);
    }
  });
});
