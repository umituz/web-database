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
import type { PgColumn, PgTable, TableConfig } from 'drizzle-orm/pg-core';
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
  sql as rawSql,
};

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export type AnyPgTable = PgTable<TableConfig>;

export type AnyDb = Db<Record<string, unknown>> | {
  select: Db<Record<string, unknown>>['select'];
  insert: Db<Record<string, unknown>>['insert'];
  update: Db<Record<string, unknown>>['update'];
  delete: Db<Record<string, unknown>>['delete'];
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

export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
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

export async function findFirstOrThrow<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  where?: WhereInput<T>,
  labelOrMessage?: string | (() => Error),
  options?: { withDeleted?: boolean }
): Promise<InferSelectModel<T>> {
  const row = await findFirst(db, table, where, options);
  if (!row) {
    if (typeof labelOrMessage === 'function') {
      throw labelOrMessage();
    }
    throw new NotFoundError(labelOrMessage ? `${labelOrMessage} not found` : 'Resource not found');
  }
  return row;
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

export async function existsById<T extends AnyPgTable & { id: unknown }>(
  db: BatchCapableDb,
  table: T,
  id: string,
  options?: { withDeleted?: boolean }
): Promise<boolean> {
  return exists(db, table, eq(table.id as never, id), options);
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

export async function findByIdOrThrow<T extends AnyPgTable & { id: unknown }>(
  db: BatchCapableDb,
  table: T,
  id: string,
  labelOrMessage?: string | ((id: string) => Error),
  options?: { withDeleted?: boolean }
): Promise<InferSelectModel<T>> {
  const row = await findById(db, table, id, options);
  if (!row) {
    if (typeof labelOrMessage === 'function') {
      throw labelOrMessage(id);
    }
    throw new NotFoundError(labelOrMessage ? `${labelOrMessage} not found` : 'Resource not found');
  }
  return row;
}

export async function findManyByIds<T extends AnyPgTable & { id: unknown }>(
  db: BatchCapableDb,
  table: T,
  ids: readonly string[],
  options?: Omit<FindManyOptions<T>, 'where'>
): Promise<InferSelectModel<T>[]> {
  if (ids.length === 0) return [];
  return findMany(db, table, {
    ...options,
    where: inArray(table.id as never, [...ids]),
  });
}

export async function findMapByIds<T extends AnyPgTable & { id: unknown }>(
  db: BatchCapableDb,
  table: T,
  ids: readonly string[],
  options?: Omit<FindManyOptions<T>, 'where'>
): Promise<Map<string, InferSelectModel<T>>> {
  const rows = await findManyByIds(db, table, ids, options);
  const map = new Map<string, InferSelectModel<T>>();
  for (const row of rows) {
    map.set(String((row as unknown as { id: unknown }).id), row);
  }
  return map;
}

export async function pluck<T extends AnyPgTable, K extends keyof TableColumns<T> & string>(
  db: BatchCapableDb,
  table: T,
  column: K,
  options?: FindManyOptions<T>
): Promise<Array<InferSelectModel<T>[K]>> {
  const col = (table as unknown as Record<string, unknown>)[column] as PgColumn;
  const condition = resolveWhere(table, options?.where, options?.withDeleted);
  let query = db.select({ val: col }).from(table as never);

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

  const rows = (await (query as never as Promise<{ val: InferSelectModel<T>[K] }[]>));
  return rows.map((r) => r.val);
}

export async function sumRows<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  column: PgColumn | (keyof TableColumns<T> & string),
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<number> {
  const col = typeof column === 'string'
    ? ((table as unknown as Record<string, unknown>)[column] as PgColumn)
    : column;
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ sumVal: sql<number | string>`coalesce(sum(${col}), 0)` }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const [row] = await (query as never as Promise<{ sumVal: number | string }[]>);
  return Number(row?.sumVal ?? 0);
}

export async function avgRows<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  column: PgColumn | (keyof TableColumns<T> & string),
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<number | null> {
  const col = typeof column === 'string'
    ? ((table as unknown as Record<string, unknown>)[column] as PgColumn)
    : column;
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ avgVal: sql<number | string | null>`avg(${col})` }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const [row] = await (query as never as Promise<{ avgVal: number | string | null }[]>);
  return row?.avgVal != null ? Number(row.avgVal) : null;
}

export async function minRows<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  column: PgColumn | (keyof TableColumns<T> & string),
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<number | null> {
  const col = typeof column === 'string'
    ? ((table as unknown as Record<string, unknown>)[column] as PgColumn)
    : column;
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ minVal: sql<number | string | null>`min(${col})` }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const [row] = await (query as never as Promise<{ minVal: number | string | null }[]>);
  return row?.minVal != null ? Number(row.minVal) : null;
}

export async function maxRows<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  column: PgColumn | (keyof TableColumns<T> & string),
  where?: WhereInput<T>,
  options?: { withDeleted?: boolean }
): Promise<number | null> {
  const col = typeof column === 'string'
    ? ((table as unknown as Record<string, unknown>)[column] as PgColumn)
    : column;
  const condition = resolveWhere(table, where, options?.withDeleted);
  let query = db.select({ maxVal: sql<number | string | null>`max(${col})` }).from(table as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }
  const [row] = await (query as never as Promise<{ maxVal: number | string | null }[]>);
  return row?.maxVal != null ? Number(row.maxVal) : null;
}

export async function paginate<T extends AnyPgTable>(
  db: BatchCapableDb,
  table: T,
  options?: {
    where?: WhereInput<T>;
    page?: number;
    pageSize?: number;
    orderBy?: OrderByItem | OrderByItem[] | ((cols: TableColumns<T>) => OrderByItem | OrderByItem[]);
    withDeleted?: boolean;
  }
): Promise<PaginationResult<InferSelectModel<T>>> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.max(1, Math.min(1000, options?.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const { items, total } = await batchQueries(db, {
    items: findMany(db, table, {
      where: options?.where,
      orderBy: options?.orderBy,
      limit: pageSize,
      offset,
      withDeleted: options?.withDeleted,
    }),
    total: countRows(db, table, options?.where, { withDeleted: options?.withDeleted }),
  });

  const totalPages = Math.ceil(total / pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  };
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

export async function upsertRow<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  values: InferInsertModel<T>,
  options: {
    target: PgColumn | PgColumn[];
    set?: Partial<InferInsertModel<T>>;
  }
): Promise<InferSelectModel<T> | null> {
  const insertBuilder = db.insert(table as never).values(values as never);
  const targetCols = Array.isArray(options.target) ? options.target : [options.target];

  let queryBuilder: { returning: () => Promise<InferSelectModel<T>[]> };
  if (options.set && Object.keys(options.set).length > 0) {
    const patch: Record<string, unknown> = { ...options.set };
    if ('updatedAt' in table && patch.updatedAt === undefined) {
      patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
    }
    queryBuilder = (insertBuilder as unknown as {
      onConflictDoUpdate: (config: { target: PgColumn[]; set: unknown }) => typeof queryBuilder;
    }).onConflictDoUpdate({
      target: targetCols,
      set: patch,
    });
  } else {
    queryBuilder = (insertBuilder as unknown as {
      onConflictDoNothing: (config?: { target: PgColumn[] }) => typeof queryBuilder;
    }).onConflictDoNothing({ target: targetCols });
  }

  const rows = await queryBuilder.returning();
  return rows[0] ?? null;
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
  id: string,
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T> | null> {
  const col = (table as Record<string, unknown>).deletedAt;
  const timestamp = currentTimestampForColumn(col);
  const patch: Record<string, unknown> = { deletedAt: timestamp, ...extraValues };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
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
  where: WhereInput<T>,
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T>[]> {
  const col = (table as Record<string, unknown>).deletedAt;
  const timestamp = currentTimestampForColumn(col);
  const patch: Record<string, unknown> = { deletedAt: timestamp, ...extraValues };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  const condition = resolveWhere(table, where, false);
  let query = db.update(table as never).set(patch as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  return (await (query as never as { returning: () => Promise<InferSelectModel<T>[]> }).returning());
}

export async function softDeleteByIds<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  ids: readonly string[],
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T>[]> {
  if (ids.length === 0) return [];
  return softDeleteWhere(db, table, (cols) => inArray(cols.id as never, [...ids]), extraValues);
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

export async function deleteByIds<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  ids: readonly string[]
): Promise<InferSelectModel<T>[]> {
  if (ids.length === 0) return [];
  return deleteWhere(db, table, (cols) => inArray(cols.id as never, [...ids]));
}

export async function restoreRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string,
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T> | null> {
  const patch: Record<string, unknown> = { deletedAt: null, ...extraValues };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  const condition = eq(table.id as never, id);
  const rows = (await (db
    .update(table as never)
    .set(patch as never)
    .where(condition)
    .returning() as unknown as Promise<InferSelectModel<T>[]>));
  return rows[0] ?? null;
}

export async function restoreWhere<T extends AnyPgTable>(
  db: AnyDb,
  table: T,
  where: WhereInput<T>,
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T>[]> {
  const patch: Record<string, unknown> = { deletedAt: null, ...extraValues };
  if ('updatedAt' in table && patch.updatedAt === undefined) {
    patch.updatedAt = currentTimestampForColumn((table as Record<string, unknown>).updatedAt);
  }

  const condition = resolveWhere(table, where, true);
  let query = db.update(table as never).set(patch as never);
  if (condition) {
    query = (query as never as { where: (c: SQL) => typeof query }).where(condition);
  }

  return (await (query as never as { returning: () => Promise<InferSelectModel<T>[]> }).returning());
}

export async function restoreByIds<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  ids: readonly string[],
  extraValues?: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T>[]> {
  if (ids.length === 0) return [];
  return restoreWhere(db, table, (cols) => inArray(cols.id as never, [...ids]), extraValues);
}

export async function incrementRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string,
  increments: Partial<Record<keyof T['_']['columns'] & string, number>>,
  extraValues?: Partial<InferInsertModel<T>>,
  options?: MutationOptions
): Promise<InferSelectModel<T> | null> {
  const patch: Record<string, unknown> = { ...extraValues };
  for (const [colName, delta] of Object.entries(increments)) {
    if (typeof delta === 'number') {
      const col = (table as unknown as Record<string, unknown>)[colName] as PgColumn;
      if (col) {
        patch[colName] = sql`${col} + ${delta}`;
      }
    }
  }
  return updateRow(db, table, id, patch as Partial<InferInsertModel<T>>, options);
}

export async function clampIncrementRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string,
  column: keyof TableColumns<T> & string,
  delta: number,
  options?: {
    min?: number;
    max?: number | (keyof TableColumns<T> & string);
    extraValues?: Partial<InferInsertModel<T>>;
    withDeleted?: boolean;
  }
): Promise<InferSelectModel<T> | null> {
  const col = (table as unknown as Record<string, unknown>)[column] as PgColumn;
  const nextVal = sql`${col} + ${delta}`;
  let expr: SQL = nextVal;

  if (options?.max !== undefined) {
    const maxExpr = typeof options.max === 'string'
      ? ((table as unknown as Record<string, unknown>)[options.max] as PgColumn)
      : sql`${options.max}`;
    expr = sql`LEAST(${maxExpr}, ${expr})`;
  }

  if (options?.min !== undefined) {
    expr = sql`GREATEST(${options.min}, ${expr})`;
  }

  const patch: Record<string, unknown> = {
    ...options?.extraValues,
    [column]: expr,
  };

  return updateRow(db, table, id, patch as Partial<InferInsertModel<T>>, {
    withDeleted: options?.withDeleted,
  });
}

export async function toggleRow<T extends AnyPgTable & { id: unknown }>(
  db: AnyDb,
  table: T,
  id: string,
  column: keyof TableColumns<T> & string,
  extraValues?: Partial<InferInsertModel<T>>,
  options?: MutationOptions
): Promise<InferSelectModel<T> | null> {
  const col = (table as unknown as Record<string, unknown>)[column] as PgColumn;
  const patch: Record<string, unknown> = {
    ...extraValues,
    [column]: sql`NOT ${col}`,
  };
  return updateRow(db, table, id, patch as Partial<InferInsertModel<T>>, options);
}

export function searchCondition<T extends AnyPgTable>(
  columns: (PgColumn | (keyof TableColumns<T> & string))[],
  query: string,
  table?: T
): SQL | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const safe = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const conds: SQL[] = [];
  for (const c of columns) {
    const col = typeof c === 'string' && table
      ? ((table as unknown as Record<string, unknown>)[c] as PgColumn)
      : (c as PgColumn);
    if (col) {
      conds.push(ilike(col, safe));
    }
  }
  return conds.length > 0 ? or(...conds) : undefined;
}
