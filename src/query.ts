import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { InferSelectModel, SQL } from 'drizzle-orm';
import type { PgTable, TableConfig } from 'drizzle-orm/pg-core';
import type { Db } from './driver';

export type AnyPgTable = PgTable<TableConfig>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = Db<any> | {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: Db<any>['select'];
  batch?: unknown;
};

export type BatchCapableDb = AnyDb;

type TableColumns<T extends AnyPgTable> = T['_']['columns'];

type WhereInput<T extends AnyPgTable> =
  | SQL
  | undefined
  | ((cols: TableColumns<T>) => SQL | undefined);

export interface FindManyOptions<T extends AnyPgTable> {
  where?: WhereInput<T>;
  limit?: number;
  offset?: number;
  orderBy?: SQL | SQL[] | ((cols: TableColumns<T>) => SQL | SQL[]);
  withDeleted?: boolean;
}

function resolveWhere<T extends AnyPgTable>(table: T, where?: WhereInput<T>, withDeleted = false): SQL | undefined {
  const customCondition = typeof where === 'function' ? where(table as unknown as TableColumns<T>) : where;
  const hasDeletedAt = 'deletedAt' in table && Boolean((table as Record<string, unknown>).deletedAt);

  if (!withDeleted && hasDeletedAt) {
    const aliveCondition = isNull((table as Record<string, unknown>).deletedAt as never);
    return customCondition ? and(customCondition, aliveCondition) : aliveCondition;
  }

  return customCondition;
}

export async function batchQueries<T extends Record<string, PromiseLike<unknown>>>(
  db: BatchCapableDb,
  queries: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
export async function batchQueries<T extends readonly PromiseLike<unknown>[]>(
  db: BatchCapableDb,
  queries: readonly [...T]
): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
export async function batchQueries(
  db: AnyDb,
  queries: Record<string, PromiseLike<unknown>> | readonly PromiseLike<unknown>[]
): Promise<unknown> {
  const hasBatch = typeof (db as { batch?: unknown }).batch === 'function';
  if (Array.isArray(queries)) {
    if (hasBatch) {
      return (db as unknown as { batch: (items: readonly unknown[]) => Promise<unknown[]> }).batch(queries);
    }
    return Promise.all(queries);
  }

  const queryMap = queries as Record<string, PromiseLike<unknown>>;
  const keys = Object.keys(queryMap);
  const promiseList = keys.map((key) => queryMap[key]);

  let results: unknown[];
  if (hasBatch) {
    results = (await (db as unknown as { batch: (items: readonly unknown[]) => Promise<unknown[]> }).batch(promiseList)) as unknown[];
  } else {
    results = await Promise.all(promiseList);
  }

  const out: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== undefined) {
      out[key] = results[i];
    }
  }
  return out;
}

export async function findFirst<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<InferSelectModel<T> | null> {
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select().from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const rows = (await (query as never as { limit: (n: number) => Promise<InferSelectModel<T>[]> }).limit(1)) as InferSelectModel<T>[];
  return rows[0] ?? null;
}

export async function findMany<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  options?: FindManyOptions<T>
): Promise<InferSelectModel<T>[]> {
  const condition = resolveWhere(table, options?.where, options?.withDeleted);
  let query = db.select().from(table as never);

  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  if (options?.orderBy) {
    const order = typeof options.orderBy === 'function'
      ? options.orderBy(table as unknown as TableColumns<T>)
      : options.orderBy;
    const orderClause = Array.isArray(order) ? order : [order];
    query = (query as never as { orderBy: (...clauses: SQL[]) => typeof query }).orderBy(...orderClause);
  }

  if (typeof options?.offset === 'number') {
    query = (query as never as { offset: (n: number) => typeof query }).offset(options.offset);
  }

  if (typeof options?.limit === 'number') {
    query = (query as never as { limit: (n: number) => typeof query }).limit(options.limit);
  }

  return (await (query as never as Promise<InferSelectModel<T>[]>)) as InferSelectModel<T>[];
}

export async function exists<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<boolean> {
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ marker: sql`1` }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const rows = await (query as never as { limit: (n: number) => Promise<unknown[]> }).limit(1);
  return rows.length > 0;
}

export async function countRows<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<number> {
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ total: count() }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const [row] = await (query as never as Promise<{ total: number }[]>);
  return Number(row?.total ?? 0);
}

export async function findById<T extends AnyPgTable & { id: unknown }>(
  db: BatchCapableDb,
  table: T,
  id: string,
  options?: { withDeleted?: boolean }
): Promise<InferSelectModel<T> | null> {
  return findFirst(
    db,
    table,
    eq(table.id as never, id),
    options
  );
}
