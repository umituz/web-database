import { beforeEach, describe, expect, it } from 'vitest';
import {
  batchQueries,
  countRows,
  deleteRow,
  deleteWhere,
  desc,
  eq,
  exists,
  findById,
  findFirst,
  findMany,
  inArray,
  incrementRow,
  insertMany,
  insertRow,
  rawSql,
  softDeleteRow,
  softDeleteWhere,
  updateRow,
  updateWhere,
} from '../src';
import { makeTestDb, resetDb } from './pglite';
import { widgets } from './helpers';

describe('query helpers', { timeout: 15000 }, () => {
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

  it('findFirst supports plain object where filters', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_obj', name: 'ObjectFilter', count: 42 });

    const match = await findFirst(db as never, widgets, { name: 'ObjectFilter' });
    expect(match?.id).toBe('w_obj');

    const mismatch = await findFirst(db as never, widgets, { name: 'NoSuchThing' });
    expect(mismatch).toBeNull();
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

  it('findMany supports options, ordering, and object filters', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'w_m1', name: 'Item 1', count: 10 },
      { id: 'w_m2', name: 'Item 2', count: 30 },
      { id: 'w_m3', name: 'Item 3', count: 20 },
    ]);

    const ordered = await findMany(db as never, widgets, {
      orderBy: desc(widgets.count),
    });
    expect(ordered.map((r) => r.id)).toEqual(['w_m2', 'w_m3', 'w_m1']);

    const limited = await findMany(db as never, widgets, {
      limit: 2,
      offset: 1,
      orderBy: desc(widgets.count),
    });
    expect(limited.map((r) => r.id)).toEqual(['w_m3', 'w_m1']);

    const inFilter = await findMany(db as never, widgets, {
      where: { count: [10, 30] },
      orderBy: widgets.count,
    });
    expect(inFilter.map((r) => r.id)).toEqual(['w_m1', 'w_m2']);
  });

  it('insertRow and insertMany create records and return them', async () => {
    const db = await makeTestDb();
    const created = await insertRow(db as never, widgets, {
      id: 'w_ins',
      name: 'Inserted Single',
      count: 99,
    });
    expect(created.id).toBe('w_ins');
    expect(created.name).toBe('Inserted Single');

    const list = await insertMany(db as never, widgets, [
      { id: 'w_multi_1', name: 'M1' },
      { id: 'w_multi_2', name: 'M2' },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe('w_multi_1');
  });

  it('updateRow updates alive record by id and auto-updates timestamp', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_up', name: 'Before' });

    const updated = await updateRow(db as never, widgets, 'w_up', { name: 'After' });
    expect(updated?.name).toBe('After');

    const reRead = await findById(db as never, widgets, 'w_up');
    expect(reRead?.name).toBe('After');
  });

  it('softDeleteRow marks deletedAt and prevents standard reads', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_sdel', name: 'Will Soft Delete' });

    const deleted = await softDeleteRow(db as never, widgets, 'w_sdel');
    expect(deleted?.deletedAt).not.toBeNull();

    const live = await findById(db as never, widgets, 'w_sdel');
    expect(live).toBeNull();

    const withDeleted = await findById(db as never, widgets, 'w_sdel', { withDeleted: true });
    expect(withDeleted).not.toBeNull();
  });

  it('softDeleteWhere and updateWhere apply mutations with conditions', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'w_w1', name: 'Group Item 1', count: 1 },
      { id: 'w_w2', name: 'Group Item 2', count: 2 },
      { id: 'w_w3', name: 'Other Item 3', count: 3 },
    ]);

    const updated = await updateWhere(db as never, widgets, (cols) => inArray(cols.count, [1, 2]), { count: 99 });
    expect(updated).toHaveLength(2);

    const deleted = await softDeleteWhere(db as never, widgets, { count: 99 });
    expect(deleted).toHaveLength(2);

    const remaining = await findMany(db as never, widgets);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe('w_w3');
  });

  it('deleteRow and deleteWhere perform hard deletion', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_hard', name: 'Hard Delete' });

    await deleteRow(db as never, widgets, 'w_hard');
    const absent = await findById(db as never, widgets, 'w_hard', { withDeleted: true });
    expect(absent).toBeNull();

    await insertMany(db as never, widgets, [
      { id: 'w_del_w1', name: 'DelWhere1' },
      { id: 'w_del_w2', name: 'DelWhere2' },
    ]);
    const deleted = await deleteWhere(db as never, widgets, { name: 'DelWhere1' });
    expect(deleted).toHaveLength(1);
    expect(await findById(db as never, widgets, 'w_del_w1', { withDeleted: true })).toBeNull();
  });

  it('batchQueries batches array and record queries', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'b_1', name: 'Batch 1' },
      { id: 'b_2', name: 'Batch 2' },
    ]);

    const res = await batchQueries(db as never, {
      first: findById(db as never, widgets, 'b_1'),
      second: findById(db as never, widgets, 'b_2'),
      count: countRows(db as never, widgets),
    });

    expect(res.first?.name).toBe('Batch 1');
    expect(res.second?.name).toBe('Batch 2');
    expect(res.count).toBe(2);
  });

  it('incrementRow atomically increments and decrements numeric columns', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_inc', name: 'IncWidget', count: 10 });

    const incremented = await incrementRow(db as never, widgets, 'w_inc', { count: 5 });
    expect(incremented?.count).toBe(15);

    const decremented = await incrementRow(db as never, widgets, 'w_inc', { count: -3 }, { name: 'NewName' });
    expect(decremented?.count).toBe(12);
    expect(decremented?.name).toBe('NewName');
  });

  it('rawSql enables raw sql template expressions', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_raw', name: 'RawWidget', count: 42 });
    const found = await findFirst(db as never, widgets, rawSql`${widgets.count} = 42`);
    expect(found?.id).toBe('w_raw');
  });
});
