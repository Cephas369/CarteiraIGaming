import { randomBytes } from 'node:crypto';
import { generateEndToEndId } from '../../src/pix/br-code';
import { PixDepositService } from '../../src/pix/pix-deposit.service';
import { signPixPayload } from '../../src/pix/pix-signature';
import { Harness, pixWebhookBody, range, startApp, uniquePlayer, waitFor, waitForQueueIdle } from './harness';

describe('Depósito Pix: webhook HMAC + fila + worker', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startApp();
  });

  afterAll(async () => {
    await h.close();
  });

  async function walletWithCharge(amount: number): Promise<{ playerId: string; txid: string }> {
    const playerId = uniquePlayer('pix');
    await h.api.createWallet(playerId);
    const charge = await h.api.createCharge(playerId, amount);
    return { playerId, txid: charge.txid };
  }

  async function eventByE2e(endToEndId: string) {
    const { rows } = await h.db.query<{ id: string; status: string; attempts: number; last_error: string | null }>(
      'SELECT id, status, attempts, last_error FROM pix_webhook_events WHERE end_to_end_id = $1',
      [endToEndId],
    );
    return rows;
  }

  it('o mesmo webhook enviado 10 vezes gera um único crédito', async () => {
    const { playerId, txid } = await walletWithCharge(5_000);
    const endToEndId = generateEndToEndId();
    const body = pixWebhookBody({ endToEndId, txid, amount: 5_000 });

    // 10 entregas simultâneas (o PSP reenviando por timeout)...
    const concurrent = await Promise.all(range(10).map(() => h.api.sendPixWebhook(body)));
    expect(concurrent.every((r) => r.status === 200)).toBe(true);
    expect(concurrent.reduce((sum, r) => sum + r.body.accepted, 0)).toBe(1);
    expect(concurrent.reduce((sum, r) => sum + r.body.duplicates, 0)).toBe(9);
    await waitFor(() => h.api.balance(playerId), (b) => b === 5_000);

    // ...e mais 10 depois de já creditado
    for (let i = 0; i < 10; i++) expect((await h.api.sendPixWebhook(body)).status).toBe(200);
    await waitForQueueIdle(h.depositsQueue);

    expect(await h.api.balance(playerId)).toBe(5_000);
    const events = await eventByE2e(endToEndId);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('CREDITED');
    const journals = await h.db.query('SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1', [`pix:${endToEndId}`]);
    expect(journals.rowCount).toBe(1);
    const charge = await h.api.request('GET', `/deposits/pix/${txid}`);
    expect(charge.body.status).toBe('PAID');
  });

  it('o worker é idempotente: processar o mesmo evento de novo não credita duas vezes', async () => {
    const { playerId, txid } = await walletWithCharge(1_234);
    const endToEndId = generateEndToEndId();
    await h.api.sendPixWebhook(pixWebhookBody({ endToEndId, txid, amount: 1_234 }));
    await waitFor(() => h.api.balance(playerId), (b) => b === 1_234);
    const [event] = await eventByE2e(endToEndId);

    // chamada direta ao serviço, em paralelo, e um job duplicado na fila com outro jobId
    const deposits = h.app.get(PixDepositService);
    const outcomes = await Promise.all([deposits.credit(event.id), deposits.credit(event.id)]);
    expect(outcomes.map((o) => o.status)).toEqual(['ALREADY_CREDITED', 'ALREADY_CREDITED']);
    await h.depositsQueue.add('credit', { eventId: event.id }, { jobId: `${event.id}-duplicate` });
    await waitForQueueIdle(h.depositsQueue);

    expect(await h.api.balance(playerId)).toBe(1_234);
  });

  it('assinatura inválida é recusada com 401 e nada é gravado', async () => {
    const { txid } = await walletWithCharge(1_000);
    const endToEndId = generateEndToEndId();
    const body = pixWebhookBody({ endToEndId, txid, amount: 1_000 });

    const wrongSecret = await h.api.sendPixWebhook(body, signPixPayload(body, 'segredo-de-outra-pessoa'));
    const tampered = await h.api.sendPixWebhook(body.replace('"10.00"', '"99.00"'), signPixPayload(body, 'e2e-pix-webhook-secret-0123456789'));
    const missing = await h.api.sendPixWebhook(body, '');

    for (const res of [wrongSecret, tampered, missing]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SIGNATURE');
    }
    expect(await eventByE2e(endToEndId)).toHaveLength(0);
  });

  it('a assinatura é sobre o corpo cru: o mesmo JSON com outra formatação não passa', async () => {
    const { txid } = await walletWithCharge(1_000);
    const compact = pixWebhookBody({ endToEndId: generateEndToEndId(), txid, amount: 1_000 });
    const pretty = JSON.stringify(JSON.parse(compact), null, 2);

    const res = await h.api.sendPixWebhook(pretty, signPixPayload(compact, 'e2e-pix-webhook-secret-0123456789'));
    expect(res.status).toBe(401);
  });

  it('valor decimal do Pix vira centavos exatos ("19.99" -> 1999)', async () => {
    const { playerId, txid } = await walletWithCharge(1_999);
    await h.api.sendPixWebhook(pixWebhookBody({ endToEndId: generateEndToEndId(), txid, amount: 1_999 }));
    await waitFor(() => h.api.balance(playerId), (b) => b === 1_999);
  });

  it('txid desconhecido vai direto para a fila de falhas (DLQ) e pode ser reprocessado', async () => {
    const playerId = uniquePlayer('dlq');
    await h.api.createWallet(playerId);
    const orphanTxid = randomBytes(16).toString('hex');
    const endToEndId = generateEndToEndId();

    const res = await h.api.sendPixWebhook(pixWebhookBody({ endToEndId, txid: orphanTxid, amount: 777 }));
    expect(res.status).toBe(200); // recebemos; o problema é nosso, não do PSP

    const [failed] = await waitFor(() => eventByE2e(endToEndId), (rows) => rows[0]?.status === 'FAILED');
    expect(failed.attempts).toBe(1); // erro permanente: sem retry
    expect(failed.last_error).toMatch(/não corresponde a nenhuma cobrança/);
    const dlq = await waitFor(
      () => h.api.request('GET', '/admin/pix/dead-letters'),
      (r) => r.body.some((d: { eventId: string }) => d.eventId === failed.id),
    );
    expect(dlq.status).toBe(200);

    // "corrige a causa": a cobrança aparece (ex.: estava em outro sistema) e o evento é reprocessado
    await h.db.query(
      `INSERT INTO pix_charges (txid, account_id, amount, currency, copy_paste, expires_at)
       SELECT $1, id, 777, 'BRL', 'manual', now() + interval '1 hour' FROM accounts WHERE player_id = $2`,
      [orphanTxid, playerId],
    );
    const reprocess = await h.api.request('POST', `/admin/pix/events/${failed.id}/reprocess`);
    expect(reprocess.status).toBe(202);

    await waitFor(() => h.api.balance(playerId), (b) => b === 777);
    const [credited] = await eventByE2e(endToEndId);
    expect(credited.status).toBe('CREDITED');
    const after = await h.api.request('GET', '/admin/pix/dead-letters');
    expect(after.body.some((d: { eventId: string }) => d.eventId === failed.id)).toBe(false);
  });
});
