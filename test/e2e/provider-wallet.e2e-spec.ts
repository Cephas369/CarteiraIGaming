import { Harness, startApp, uniquePlayer } from './harness';

describe('Provedor de jogo: balance / bet / win / rollback', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startApp();
  });

  afterAll(async () => {
    await h.close();
  });

  async function fundedPlayer(amount = 10_000): Promise<string> {
    const playerId = uniquePlayer();
    await h.api.createWallet(playerId);
    if (amount > 0) await h.api.deposit(playerId, amount);
    return playerId;
  }

  async function gameTxCount(playerId: string): Promise<number> {
    const { rows } = await h.db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM game_transactions g JOIN accounts a ON a.id = g.account_id WHERE a.player_id = $1`,
      [playerId],
    );
    return Number(rows[0].n);
  }

  it('recusa chamadas sem API key válida', async () => {
    const playerId = await fundedPlayer(0);
    const noKey = await h.api.request('POST', '/provider/v1/balance', { playerId });
    const wrongKey = await h.api.provider('balance', { playerId }, 'chave-errada');
    expect(noKey.status).toBe(401);
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body.code).toBe('INVALID_API_KEY');
  });

  it('consulta o saldo', async () => {
    const playerId = await fundedPlayer(2_500);
    const res = await h.api.provider('balance', { playerId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 2_500, currency: 'BRL' });
  });

  it('aposta debita, prêmio credita e o extrato mostra os lançamentos', async () => {
    const playerId = await fundedPlayer(10_000);

    const bet = await h.api.bet(playerId, `${playerId}-b1`, 300);
    expect(bet.status).toBe(200);
    expect(bet.body.balance).toBe(9_700);

    const win = await h.api.win(playerId, `${playerId}-w1`, 1_000);
    expect(win.status).toBe(200);
    expect(win.body.balance).toBe(10_700);
    expect(await h.api.balance(playerId)).toBe(10_700);

    const statement = await h.api.request('GET', `/wallets/${playerId}/statement`);
    expect(statement.body.items.map((e: { kind: string; amount: number; balanceAfter: number }) => [e.kind, e.amount, e.balanceAfter])).toEqual([
      ['WIN', 1_000, 10_700],
      ['BET', -300, 9_700],
      ['DEPOSIT', 10_000, 10_000],
    ]);
  });

  it('reenvio da aposta devolve a resposta original sem debitar de novo', async () => {
    const playerId = await fundedPlayer(10_000);
    const first = await h.api.bet(playerId, `${playerId}-b1`, 500);
    const again = await h.api.bet(playerId, `${playerId}-b1`, 500);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await h.api.balance(playerId)).toBe(9_500);
    expect(await gameTxCount(playerId)).toBe(1);
  });

  it('reenvio de aposta já aceita é sucesso mesmo que o saldo atual não a cobrisse', async () => {
    const playerId = await fundedPlayer(1_000);
    const first = await h.api.bet(playerId, `${playerId}-all-in`, 1_000);
    expect(first.body.balance).toBe(0);

    const again = await h.api.bet(playerId, `${playerId}-all-in`, 1_000);
    expect(again.status).toBe(200); // e não 422: a idempotência é checada antes do saldo
    expect(again.body.balance).toBe(0);
  });

  it('mesmo transactionId com outro conteúdo é conflito de idempotência', async () => {
    const playerId = await fundedPlayer(10_000);
    await h.api.bet(playerId, `${playerId}-b1`, 500);

    const otherAmount = await h.api.bet(playerId, `${playerId}-b1`, 700);
    expect(otherAmount.status).toBe(409);
    expect(otherAmount.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const otherType = await h.api.win(playerId, `${playerId}-b1`, 500);
    expect(otherType.status).toBe(409);
    expect(await h.api.balance(playerId)).toBe(9_500);
  });

  it('saldo insuficiente não grava nada e a mesma aposta pode passar depois de um depósito', async () => {
    const playerId = await fundedPlayer(100);
    const denied = await h.api.bet(playerId, `${playerId}-big`, 500);
    expect(denied.status).toBe(422);
    expect(denied.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await gameTxCount(playerId)).toBe(0);

    await h.api.deposit(playerId, 1_000);
    const retried = await h.api.bet(playerId, `${playerId}-big`, 500);
    expect(retried.status).toBe(200);
    expect(retried.body.balance).toBe(600);
  });

  it('recusa moeda diferente da carteira e carteira inexistente', async () => {
    const playerId = await fundedPlayer(1_000);
    const usd = await h.api.bet(playerId, `${playerId}-usd`, 100, { currency: 'USD' });
    expect(usd.status).toBe(422);
    expect(usd.body.code).toBe('CURRENCY_MISMATCH');

    const ghost = await h.api.bet('nao-existe', 'tx-ghost', 100);
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe('WALLET_NOT_FOUND');
  });

  it('valida o corpo: valor fracionado ou em string é rejeitado (nada de float)', async () => {
    const playerId = await fundedPlayer(1_000);
    const fractional = await h.api.bet(playerId, `${playerId}-f`, 1.5);
    const asString = await h.api.provider('bet', {
      transactionId: `${playerId}-s`,
      playerId,
      roundId: 'r',
      amount: '100',
      currency: 'BRL',
    });
    expect(fractional.status).toBe(400);
    expect(fractional.body.code).toBe('VALIDATION_ERROR');
    expect(asString.status).toBe(400);
    expect(await h.api.balance(playerId)).toBe(1_000);
  });

  it('win de valor zero fecha a rodada sem lançamento no ledger', async () => {
    const playerId = await fundedPlayer(1_000);
    await h.api.bet(playerId, `${playerId}-b`, 200);
    const zero = await h.api.win(playerId, `${playerId}-w0`, 0);
    expect(zero.status).toBe(200);
    expect(zero.body.balance).toBe(800);

    const statement = await h.api.request('GET', `/wallets/${playerId}/statement`);
    expect(statement.body.items).toHaveLength(2); // depósito + aposta
  });

  it('rollback devolve a aposta e é idempotente', async () => {
    const playerId = await fundedPlayer(10_000);
    await h.api.bet(playerId, `${playerId}-b`, 700);

    const rb = await h.api.rollback(playerId, `${playerId}-rb`, `${playerId}-b`);
    expect(rb.status).toBe(200);
    expect(rb.body.balance).toBe(10_000);

    const again = await h.api.rollback(playerId, `${playerId}-rb`, `${playerId}-b`);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await h.api.balance(playerId)).toBe(10_000);
  });

  it('um segundo rollback (outro id) da mesma aposta é recusado pelo índice único', async () => {
    const playerId = await fundedPlayer(10_000);
    await h.api.bet(playerId, `${playerId}-b`, 700);
    await h.api.rollback(playerId, `${playerId}-rb1`, `${playerId}-b`);

    const second = await h.api.rollback(playerId, `${playerId}-rb2`, `${playerId}-b`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BET_ALREADY_ROLLED_BACK');
    expect(await h.api.balance(playerId)).toBe(10_000);
  });

  it('rollback que chega antes da aposta fica registrado e a aposta atrasada é recusada', async () => {
    const playerId = await fundedPlayer(10_000);
    const rb = await h.api.rollback(playerId, `${playerId}-rb`, `${playerId}-late-bet`);
    expect(rb.status).toBe(200);
    expect(rb.body.balance).toBe(10_000);

    const lateBet = await h.api.bet(playerId, `${playerId}-late-bet`, 500);
    expect(lateBet.status).toBe(409);
    expect(lateBet.body.code).toBe('TRANSACTION_ROLLED_BACK');
    expect(await h.api.balance(playerId)).toBe(10_000);
  });

  it('não estorna aposta de outro jogador', async () => {
    const alice = await fundedPlayer(10_000);
    const bob = await fundedPlayer(10_000);
    await h.api.bet(alice, `${alice}-b`, 500);

    const res = await h.api.rollback(bob, `${bob}-rb`, `${alice}-b`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ROLLBACK_TARGET');
    expect(await h.api.balance(bob)).toBe(10_000);
  });
});
