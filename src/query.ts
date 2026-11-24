import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel, SQL, SQLWrapper } from 'drizzle-orm';
import type { PgTable, TableConfig } from 'drizzle-orm/pg-core';
import type { Db } from './driver';

export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
};

export type AnyPgTable = PgTable<TableConfig>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = Db<any> | {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: Db<any>['select'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert: Db<any>['insert'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: Db<any>['update'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete: Db<any>['delete'];
  batch?: unknown;
};

export type BatchCapableDb = AnyDb;

type TableColumns<T extends AnyPgTable> = T['_']['columns'];

type WhereObject<T extends AnyPgTable> = {
  [K in keyof TableColumns<T>]?: unknown;
};

export type WhereInput<T extends AnyPgTable> =
  | SQL
  | WhereObject<T>
  | undefined
  | ((cols: TableColumns<T>) => SQL | undefined);

export type OrderByItem = SQL | SQLWrapper;

export interface FindManyOptions<T extends AnyPgTable> {
  where?: WhereInput<T>;
  limit?: number;
  offset?: number;
  orderBy?: OrderByItem | OrderByItem[] | ((cols: TableColumns<T>) => OrderByItem | OrderByItem[]);
  withDeleted?: boolean;
}

export interface MutationOptions {
  withDeleted?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function resolveWhere<T extends AnyPgTable>(table: T, where?: WhereInput<T>, withDeleted = false): SQL | undefined {
  let customCondition: SQL | undefined;

  if (typeof where === 'function') {
    customCondition = where(table as unknown as TableColumns<T>);
  } else if (isPlainObject(where)) {
    const tableCols = table as unknown as Record<string, unknown>;
    const conditions: SQL[] = [];
    for (const [key, val] of Object.entries(where)) {
      const col = tableCols[key];
      if (col && typeof col === 'object') {
        if (val === null) {
          conditions.push(isNull(col as never));
        } else if (Array.isArray(val)) {
          conditions.push(inArray(col as never, val));
        } else {
          conditions.push(eq(col as never, val));
        }
      }
    }
    customCondition = conditions.length > 0 ? and(...conditions) : undefined;
  } else {
    customCondition = where;
  }

  const hasDeletedAt = 'deletedAt' in table && Boolean((table as Record<string, unknown>).deletedAt);

  if (!withDeleted && hasDeletedAt) {
    const aliveCondition = isNull((table as Record<string, unknown>).deletedAt as never);
    return customCondition ? and(customCondition, aliveCondition) : aliveCondition;
  }

  return customCondition;
}

function currentTimestampForColumn(col: unknown): unknown {
  if (col && typeof col === 'object' && 'dataType' in col && (col as { dataType: string }).dataType === 'string') {
    return new Date().toISOString();
  }
  return new Date();
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
    query = (query as never as { orderBy: (...clauses: OrderByItem[]) => typeof query }).orderBy(...orderClause);
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

export async function insertRow<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  values: InferInsertModel<T>
): Promise<InferSelectModel<T>> {
  const rows = (await (db
    .insert(table as never)
    .values(values as never)
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
  const row = rows[0];
  if (!row) {
    throw new Error('Insert failed to return row');
  }
  return row;
}

export async function insertMany<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  values: InferInsertModel<T>[]
): Promise<InferSelectModel<T>[]> {
  if (values.length === 0) return [];
  return (await (db
    .insert(table as never)
    .values(values as never)
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
}

export async function updateRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string,
  values: Partial<InferInsertModel<T>>,
  options?: MutationOptions
): Promise<InferSelectModel<T> | null> {
  const patch: Record<string, unknown> = { ...values };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  let condition: SQL = eq(table.id as never, id);
  if (!options?.withDeleted && 'deletedAt' in table) {
    condition = and(condition, isNull((table as Record<string, unknown>).deletedAt as never)) as SQL;
  }

  const rows = (await (db
    .update(table as never)
    .set(patch as never)
    .where(condition)
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
  return rows[0] ?? null;
}

export async function updateWhere<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  where: WhereInput<T>,
  values: Partial<InferInsertModel<T>>,
  options?: MutationOptions
): Promise<InferSelectModel<T>[]> {
  const patch: Record<string, unknown> = { ...values };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.update(table as never).set(patch as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  return (await (query as never as { returning: () => Promise<InferSelectModel<T>[]> }).returning());
}

export async function softDeleteRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string
): Promise<InferSelectModel<T> | null> {
  const col = (table as Record<string, unknown>).deletedAt;
  const timestamp = currentTimestampForColumn(col);
  const patch: Record<string, unknown> = { deletedAt: timestamp };
  if ('updatedAt' in table) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  let condition: SQL = eq(table.id as never, id);
  if ('deletedAt' in table) {
    condition = and(condition, isNull(col as never)) as SQL;
  }

  const rows = (await (db
    .update(table as never)
    .set(patch as never)
    .where(condition)
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
  return rows[0] ?? null;
}

export async function softDeleteWhere<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  where: WhereInput<T>
): Promise<InferSelectModel<T>[]> {
  const col = (table as Record<string, unknown>).deletedAt;
  const timestamp = currentTimestampForColumn(col);
  const patch: Record<string, unknown> = { deletedAt: timestamp };
  if ('updatedAt' in table) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  const condition = resolveWhere(table, where, false);
  let query = db.update(table as never).set(patch as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  return (await (query as never as { returning: () => Promise<InferSelectModel<T>[]> }).returning());
}

export async function deleteRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string
): Promise<InferSelectModel<T> | null> {
  const rows = (await (db
    .delete(table as never)
    .where(eq(table.id as never, id))
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
  return rows[0] ?? null;
}

export async function deleteWhere<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  where: WhereInput<T>
): Promise<InferSelectModel<T>[]> {
  const condition = resolveWhere(table, where, true);
  let query = db.delete(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  return (await (query as never as { returning: () => Promise<InferSelectModel<T>[]> }).returning());
}
