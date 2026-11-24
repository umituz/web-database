import { beforeEach, describe, expect, it } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import {
  batchQueries,
  countRows,
  exists,
  findById,
  findFirst,
  findMany,
} from '../src/query';
import { makeTestDb, resetDb } from './pglite';
import { widgets } from './helpers';

describe('query helpers', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('findFirst returns matching record or null', async () => {
    const db = await makeTestDb();
    const none = await findFirst(db as never, widgets, eq(widgets.id, 'w_1'));
    expect(none).toBeNull();

    await db.insert(widgets).values({
      id: 'w_1',
      name: 'Alpha',
      count: 10,
    });

    const found = await findFirst(db as never, widgets, eq(widgets.id, 'w_1'));
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Alpha');
  });

  it('findFirst filters out soft-deleted records by default', async () => {
    const db = await makeTestDb();
    await db.insert(widgets).values({
      id: 'w_del',
      name: 'Deleted',
      deletedAt: new Date(),
    });

    const active = await findFirst(db as never, widgets, eq(widgets.id, 'w_del'));
    expect(active).toBeNull();

    const withDeleted = await findFirst(db as never, widgets, eq(widgets.id, 'w_del'), { withDeleted: true });
    expect(withDeleted).not.toBeNull();
    expect(withDeleted?.id).toBe('w_del');
  });

  it('findById searches by primary key', async () => {
    const db = await makeTestDb();
    await db.insert(widgets).values({
      id: 'w_by_id',
      name: 'Identified',
    });

    const item = await findById(db as never, widgets, 'w_by_id');
    expect(item?.name).toBe('Identified');

    const missing = await findById(db as never, widgets, 'w_not_here');
    expect(missing).toBeNull();
  });

  it('exists checks record presence with boolean return', async () => {
    const db = await makeTestDb();
    expect(await exists(db as never, widgets, eq(widgets.id, 'w_ex'))).toBe(false);

    await db.insert(widgets).values({
      id: 'w_ex',
      name: 'ExistsTest',
    });

    expect(await exists(db as never, widgets, eq(widgets.id, 'w_ex'))).toBe(true);

    await db.update(widgets).set({ deletedAt: new Date() }).where(eq(widgets.id, 'w_ex'));
    expect(await exists(db as never, widgets, eq(widgets.id, 'w_ex'))).toBe(false);
    expect(await exists(db as never, widgets, eq(widgets.id, 'w_ex'), { withDeleted: true })).toBe(true);
  });

  it('countRows returns exact number of live rows', async () => {
    const db = await makeTestDb();
    expect(await countRows(db as never, widgets)).toBe(0);

    await db.insert(widgets).values([
      { id: 'w_c1', name: 'Count 1' },
      { id: 'w_c2', name: 'Count 2' },
      { id: 'w_c3', name: 'Count 3', deletedAt: new Date() },
    ]);

    expect(await countRows(db as never, widgets)).toBe(2);
    expect(await countRows(db as never, widgets, undefined, { withDeleted: true })).toBe(3);
  });

  it('findMany supports options and ordering', async () => {
    const db = await makeTestDb();
    await db.insert(widgets).values([
      { id: 'w_m1', name: 'Item 1', count: 10 },
      { id: 'w_m2', name: 'Item 2', count: 30 },
      { id: 'w_m3', name: 'Item 3', count: 20 },
      { id: 'w_m4', name: 'Item 4', count: 40, deletedAt: new Date() },
    ]);

    const items = await findMany(db as never, widgets, {
      orderBy: desc(widgets.count),
      limit: 2,
    });

    expect(items.length).toBe(2);
    expect(items[0]?.name).toBe('Item 2');
    expect(items[1]?.name).toBe('Item 3');
  });

  it('batchQueries executes named and array queries', async () => {
    const db = await makeTestDb();
    await db.insert(widgets).values([
      { id: 'w_b1', name: 'Batch 1', count: 5 },
      { id: 'w_b2', name: 'Batch 2', count: 15 },
    ]);

    const { first, second, total } = await batchQueries(db as never, {
      first: findById(db as never, widgets, 'w_b1'),
      second: findById(db as never, widgets, 'w_b2'),
      total: countRows(db as never, widgets),
    });

    expect(first?.name).toBe('Batch 1');
    expect(second?.name).toBe('Batch 2');
    expect(total).toBe(2);

    const [arrFirst, arrTotal] = await batchQueries(db as never, [
      findById(db as never, widgets, 'w_b1'),
      countRows(db as never, widgets),
    ]);

    expect(arrFirst?.name).toBe('Batch 1');
    expect(arrTotal).toBe(2);
  });

  it('batchQueries delegates to db.batch when available', async () => {
    let batchCalled = false;
    const fakeDb = {
      select: () => {},
      batch: async (queries: readonly unknown[]) => {
        batchCalled = true;
        return queries.map((q) => q);
      },
    };

    const res = await batchQueries(fakeDb as never, {
      a: Promise.resolve('val_a'),
      b: Promise.resolve('val_b'),
    });

    expect(batchCalled).toBe(true);
    expect(res).toEqual({ a: Promise.resolve('val_a'), b: Promise.resolve('val_b') });
  });
});
