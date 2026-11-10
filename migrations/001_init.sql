-- =====================================================================
-- Carteira seamless: contas, ledger de dupla entrada, transações de jogo e Pix.
-- Valores sempre em centavos (bigint). As regras de dinheiro moram aqui, no
-- banco, como última linha de defesa contra bugs na aplicação.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contas
--   PLAYER        carteira do jogador: tem saldo materializado (nunca negativo)
--   HOUSE         contrapartida das apostas/prêmios (resultado da casa)
--   PIX_CLEARING  contrapartida dos depósitos Pix
-- Contas de sistema NÃO têm saldo materializado: seriam uma linha quente que toda
-- aposta de todo jogador precisaria travar. O saldo delas é SUM(ledger_entries).
-- ---------------------------------------------------------------------
CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  player_id   text,
  currency    char(3) NOT NULL,
  balance     bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_kind_valid CHECK (kind IN ('PLAYER', 'HOUSE', 'PIX_CLEARING')),
  CONSTRAINT accounts_player_id_unique UNIQUE (player_id),
  CONSTRAINT accounts_player_id_only_for_players CHECK ((kind = 'PLAYER') = (player_id IS NOT NULL)),
  CONSTRAINT accounts_balance_only_for_players CHECK ((kind = 'PLAYER') = (balance IS NOT NULL)),
  CONSTRAINT accounts_balance_non_negative CHECK (balance >= 0)
);

CREATE UNIQUE INDEX accounts_system_unique ON accounts (kind, currency) WHERE kind <> 'PLAYER';

INSERT INTO accounts (kind, currency) VALUES ('HOUSE', 'BRL'), ('PIX_CLEARING', 'BRL');

-- ---------------------------------------------------------------------
-- Ledger (fonte da verdade): append-only, dupla entrada.
-- Cada ledger_transaction tem >= 2 lançamentos que somam exatamente zero.
-- amount > 0 aumenta o saldo da conta; amount < 0 diminui.
-- ---------------------------------------------------------------------
CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY,
  kind             text NOT NULL,
  idempotency_key  text NOT NULL,
  currency         char(3) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_transactions_kind_valid CHECK (kind IN ('BET', 'WIN', 'ROLLBACK', 'DEPOSIT')),
  -- defesa em profundidade: o mesmo fato de negócio nunca vira dois lançamentos
  CONSTRAINT ledger_transactions_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE TABLE ledger_entries (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_transaction_id  uuid NOT NULL REFERENCES ledger_transactions (id),
  account_id             uuid NOT NULL REFERENCES accounts (id),
  amount                 bigint NOT NULL,
  -- saldo da carteira depois deste lançamento (só para contas PLAYER): extrato sem recálculo
  balance_after          bigint,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_amount_non_zero CHECK (amount <> 0)
);

CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (ledger_transaction_id);

-- Append-only: UPDATE, DELETE e TRUNCATE são recusados pelo banco.
-- Correção de erro em ledger é um novo lançamento (estorno), nunca edição.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é append-only: % não é permitido', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_no_truncate
  BEFORE TRUNCATE ON ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Dupla entrada garantida pelo banco, checada no COMMIT (constraint trigger deferida):
-- dentro da transação os lançamentos entram um a um; no fim, cada transação precisa somar zero.
CREATE FUNCTION assert_ledger_transaction_balanced(p_ledger_transaction_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_sum   numeric;
  v_count integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
    INTO v_sum, v_count
    FROM ledger_entries
   WHERE ledger_transaction_id = p_ledger_transaction_id;

  IF v_count < 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'transação de ledger % desbalanceada (soma=%, lançamentos=%)',
      p_ledger_transaction_id, v_sum, v_count
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION ledger_entries_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_ledger_transaction_balanced(NEW.ledger_transaction_id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION ledger_transactions_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_ledger_transaction_balanced(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_balanced();

CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_balanced();

-- ---------------------------------------------------------------------
-- Transações do provedor de jogo (bet / win / rollback).
-- UNIQUE (provider, external_id) é a chave de idempotência: o INSERT usa
-- ON CONFLICT DO NOTHING, então duas requisições iguais nunca geram dois débitos.
-- ---------------------------------------------------------------------
CREATE TABLE game_transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider               text NOT NULL,
  external_id            text NOT NULL,
  type                   text NOT NULL,
  account_id             uuid NOT NULL REFERENCES accounts (id),
  round_id               text,
  amount                 bigint NOT NULL,
  currency               char(3) NOT NULL,
  -- ROLLBACK: transactionId da aposta estornada
  reference_external_id  text,
  -- deferida: a transação de jogo é gravada ANTES do ledger (é ela que decide se é replay)
  ledger_transaction_id  uuid REFERENCES ledger_transactions (id) DEFERRABLE INITIALLY DEFERRED,
  -- resposta original, devolvida de novo em caso de replay
  balance_after          bigint NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_transactions_idempotency UNIQUE (provider, external_id),
  CONSTRAINT game_transactions_type_valid CHECK (type IN ('BET', 'WIN', 'ROLLBACK')),
  CONSTRAINT game_transactions_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT game_transactions_rollback_has_reference CHECK ((type = 'ROLLBACK') = (reference_external_id IS NOT NULL)),
  CONSTRAINT game_transactions_ledger_iff_amount CHECK ((amount > 0) = (ledger_transaction_id IS NOT NULL))
);

-- Uma aposta só pode ser estornada uma vez, mesmo que o provedor mande dois rollbacks com ids diferentes.
CREATE UNIQUE INDEX game_transactions_one_rollback_per_bet
  ON game_transactions (provider, reference_external_id)
  WHERE type = 'ROLLBACK';

CREATE INDEX game_transactions_account_round_idx ON game_transactions (account_id, round_id);

CREATE TRIGGER game_transactions_append_only
  BEFORE UPDATE OR DELETE ON game_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------
-- Pix: cobranças e eventos de webhook (inbox).
-- O evento é único pelo endToEndId; o worker credita a partir daqui.
-- ---------------------------------------------------------------------
CREATE TABLE pix_charges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid        text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts (id),
  amount      bigint NOT NULL,
  currency    char(3) NOT NULL,
  status      text NOT NULL DEFAULT 'PENDING',
  copy_paste  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pix_charges_txid_unique UNIQUE (txid),
  CONSTRAINT pix_charges_txid_format CHECK (txid ~ '^[a-zA-Z0-9]{26,35}$'),
  CONSTRAINT pix_charges_amount_positive CHECK (amount > 0),
  CONSTRAINT pix_charges_status_valid CHECK (status IN ('PENDING', 'PAID'))
);

CREATE INDEX pix_charges_account_idx ON pix_charges (account_id, created_at DESC);

CREATE TABLE pix_webhook_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  end_to_end_id          text NOT NULL,
  txid                   text NOT NULL,
  amount                 bigint NOT NULL,
  paid_at                timestamptz NOT NULL,
  payload                jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'RECEIVED',
  attempts               integer NOT NULL DEFAULT 0,
  last_error             text,
  ledger_transaction_id  uuid REFERENCES ledger_transactions (id),
  received_at            timestamptz NOT NULL DEFAULT now(),
  processed_at           timestamptz,
  CONSTRAINT pix_webhook_events_e2e_unique UNIQUE (end_to_end_id),
  CONSTRAINT pix_webhook_events_amount_positive CHECK (amount > 0),
  CONSTRAINT pix_webhook_events_status_valid CHECK (status IN ('RECEIVED', 'CREDITED', 'FAILED')),
  CONSTRAINT pix_webhook_events_credited_has_ledger CHECK ((status = 'CREDITED') = (ledger_transaction_id IS NOT NULL))
);

-- eventos recebidos e ainda não creditados (para reconciliação / varredura)
CREATE INDEX pix_webhook_events_pending_idx ON pix_webhook_events (received_at) WHERE status = 'RECEIVED';
