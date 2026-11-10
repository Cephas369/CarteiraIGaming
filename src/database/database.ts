import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

/** O que um repositório precisa para rodar SQL: um pool ou um client dentro de transação. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

declare const txBrand: unique symbol;

/**
 * Marca de tipo para "estou dentro de uma transação". Funções que exigem atomicidade
 * (lock + ledger + saldo) recebem `Tx`, então não dá para chamá-las com o pool por engano.
 */
export type Tx = Queryable & { readonly [txBrand]: true };

export interface TransactionOptions {
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly?: boolean;
}

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /**
   * BEGIN / COMMIT / ROLLBACK em um client dedicado. Isolamento READ COMMITTED (padrão do
   * Postgres): a consistência vem do lock de linha (SELECT ... FOR UPDATE) e das constraints,
   * não de SERIALIZABLE, então não há retry por falha de serialização.
   */
  async transaction<T>(work: (tx: Tx) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      const isolation = options.isolation ? ` ISOLATION LEVEL ${options.isolation}` : '';
      await client.query(`BEGIN${isolation}${options.readOnly ? ' READ ONLY' : ''}`);
      const result = await work(client as unknown as Tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // conexão em estado desconhecido: descarta em vez de devolver ao pool
        releaseError = rollbackError as Error;
        this.logger.error(`ROLLBACK falhou, descartando conexão: ${releaseError.message}`);
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
