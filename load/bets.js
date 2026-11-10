// Teste de carga das apostas (k6).
//   docker compose --profile load run --rm k6
//
// Dois cenários, em sequência:
//   spread      50 VUs apostando em 100 carteiras diferentes: throughput "normal" da carteira.
//   hot_wallet  50 VUs apostando na MESMA carteira: o pior caso do lock pessimista,
//               onde tudo serializa numa única linha.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PROVIDER_KEY = __ENV.PROVIDER_KEY || 'dev-provider-key';
const WALLETS = Number(__ENV.WALLETS || 100);
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '30s';
const FUNDS = 50_000_000; // R$ 500.000,00 por carteira: a carga não esbarra em saldo

export const options = {
  setupTimeout: '180s',
  scenarios: {
    spread: { executor: 'constant-vus', exec: 'spread', vus: VUS, duration: DURATION },
    hot_wallet: { executor: 'constant-vus', exec: 'hotWallet', vus: VUS, duration: DURATION, startTime: `${parseInt(DURATION, 10) + 5}s` },
  },
  // thresholds por cenário também fazem o k6 calcular as métricas separadas usadas no resumo
  thresholds: {
    'http_req_failed{scenario:spread}': ['rate<0.01'],
    'http_req_duration{scenario:spread}': ['p(95)<250'],
    'iterations{scenario:spread}': ['count>0'],
    'http_req_failed{scenario:hot_wallet}': ['rate<0.01'],
    'http_req_duration{scenario:hot_wallet}': ['p(95)<1000'],
    'iterations{scenario:hot_wallet}': ['count>0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const json = { headers: { 'content-type': 'application/json' } };
const provider = { headers: { 'content-type': 'application/json', 'x-api-key': PROVIDER_KEY } };

export function setup() {
  const run = Date.now().toString(36);
  const players = [];
  for (let i = 0; i < WALLETS; i++) {
    const playerId = `load-${run}-${i}`;
    if (http.post(`${BASE_URL}/wallets`, JSON.stringify({ playerId }), json).status !== 201) fail('criar carteira');
    // depósito pelo fluxo real: cobrança -> PSP simulado assina e manda o webhook -> worker credita
    const charge = http.post(`${BASE_URL}/deposits/pix`, JSON.stringify({ playerId, amount: FUNDS }), json);
    if (charge.status !== 201) fail('criar cobrança');
    const paid = http.post(`${BASE_URL}/dev/psp/pix/${charge.json('txid')}/pay`, '{}', json);
    if (paid.status !== 200 || paid.json('webhookStatus') !== 200) fail('simular pagamento');
    players.push(playerId);
  }
  for (const playerId of players) {
    let credited = false;
    for (let attempt = 0; attempt < 100 && !credited; attempt++) {
      credited = http.get(`${BASE_URL}/wallets/${playerId}`).json('balance') === FUNDS;
      if (!credited) sleep(0.1);
    }
    if (!credited) fail(`depósito de ${playerId} não foi creditado`);
  }
  return { run, players };
}

function bet(playerId, run) {
  const transactionId = `${run}-${__VU}-${__ITER}-${Math.random().toString(36).slice(2, 8)}`;
  const res = http.post(
    `${BASE_URL}/provider/v1/bet`,
    JSON.stringify({ transactionId, playerId, roundId: `r-${transactionId}`, amount: 1 + Math.floor(Math.random() * 500), currency: 'BRL' }),
    { ...provider, tags: { name: 'bet' } },
  );
  check(res, { 'bet 200': (r) => r.status === 200 });
}

export function spread(data) {
  bet(data.players[Math.floor(Math.random() * data.players.length)], data.run);
}

export function hotWallet(data) {
  bet(data.players[0], data.run);
}

export function handleSummary(data) {
  const seconds = parseInt(DURATION, 10);
  const round = (n) => (n === undefined ? null : Math.round(n * 10) / 10);
  const scenario = (name) => {
    const duration = data.metrics[`http_req_duration{scenario:${name}}`];
    const failed = data.metrics[`http_req_failed{scenario:${name}}`];
    const iterations = data.metrics[`iterations{scenario:${name}}`];
    return {
      bets: iterations?.values.count,
      // a taxa "rate" do k6 divide pela duração do teste inteiro; aqui dividimos pela do cenário
      bets_per_second: round(iterations ? iterations.values.count / seconds : undefined),
      p50_ms: round(duration?.values.med),
      p95_ms: round(duration?.values['p(95)']),
      p99_ms: round(duration?.values['p(99)']),
      failed_rate: failed?.values.rate,
    };
  };
  const summary = { vus: VUS, duration: DURATION, wallets: WALLETS, spread: scenario('spread'), hot_wallet: scenario('hot_wallet') };
  return { stdout: `\n${JSON.stringify(summary, null, 2)}\n` };
}
