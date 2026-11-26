import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotFoundError,
  avgRows,
  batchQueries,
  clampIncrementRow,
  countOrgRows,
  countRows,
  deleteByIds,
  deleteOrgRow,
  deleteRow,
  deleteWhere,
  desc,
  eq,
  exists,
  existsById,
  findById,
  findByIdOrThrow,
  findFirst,
  findFirstOrThrow,
  findMany,
  findManyByIds,
  findManyByOrg,
  findMapByIds,
  findOrgRow,
  findOrgRowOrThrow,
  inArray,
  incrementRow,
  insertMany,
  insertRow,
  maxRows,
  minRows,
  orgCondition,
  paginate,
  paginateOrgRows,
  pluck,
  rawSql,
  restoreByIds,
  restoreRow,
  restoreWhere,
  searchCondition,
  softDeleteByIds,
  softDeleteOrgRow,
  softDeleteRow,
  softDeleteWhere,
  sumRows,
  toggleRow,
  updateOrgRow,
  updateRow,
  updateWhere,
  upsertRow,
} from '../src';
import { makeTestDb, resetDb } from './pglite';
import { tenantItems, tenantScopedItems, widgets } from './helpers';

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

  it('findByIdOrThrow and findFirstOrThrow throw NotFoundError on missing rows', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_throw', name: 'ThrowTest' });

    const row = await findByIdOrThrow(db as never, widgets, 'w_throw', 'Widget');
    expect(row.name).toBe('ThrowTest');

    await expect(findByIdOrThrow(db as never, widgets, 'non_existent', 'Widget')).rejects.toThrow(NotFoundError);
    await expect(findByIdOrThrow(db as never, widgets, 'non_existent', 'Widget')).rejects.toThrow('Widget not found');

    const first = await findFirstOrThrow(db as never, widgets, { name: 'ThrowTest' });
    expect(first.id).toBe('w_throw');

    await expect(findFirstOrThrow(db as never, widgets, { name: 'None' }, 'Widget')).rejects.toThrow('Widget not found');
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
  });

  it('existsById checks presence by primary key', async () => {
    const db = await makeTestDb();
    expect(await existsById(db as never, widgets, 'w_ebid')).toBe(false);

    await insertRow(db as never, widgets, { id: 'w_ebid', name: 'ExistsById' });
    expect(await existsById(db as never, widgets, 'w_ebid')).toBe(true);
  });

  it('countRows aggregates record counts', async () => {
    const db = await makeTestDb();
    expect(await countRows(db as never, widgets)).toBe(0);

    await db.insert(widgets).values([
      { id: 'c_1', name: 'Count 1' },
      { id: 'c_2', name: 'Count 2' },
      { id: 'c_3', name: 'Count 3', deletedAt: new Date() },
    ]);

    expect(await countRows(db as never, widgets)).toBe(2);
    expect(await countRows(db as never, widgets, undefined, { withDeleted: true })).toBe(3);
    expect(await countRows(db as never, widgets, eq(widgets.name, 'Count 1'))).toBe(1);
  });

  it('findMany supports pagination and ordering', async () => {
    const db = await makeTestDb();
    await db.insert(widgets).values([
      { id: 'm_1', name: 'A', count: 10 },
      { id: 'm_2', name: 'B', count: 20 },
      { id: 'm_3', name: 'C', count: 30 },
    ]);

    const descRows = await findMany(db as never, widgets, {
      orderBy: desc(widgets.count),
      limit: 2,
    });
    expect(descRows).toHaveLength(2);
    expect(descRows[0]?.id).toBe('m_3');
    expect(descRows[1]?.id).toBe('m_2');

    const offsetRows = await findMany(db as never, widgets, {
      orderBy: (cols) => cols.count,
      offset: 1,
      limit: 2,
    });
    expect(offsetRows).toHaveLength(2);
    expect(offsetRows[0]?.id).toBe('m_2');
  });

  it('findManyByIds and findMapByIds fetch and map by ids array', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'id_1', name: 'First', count: 1 },
      { id: 'id_2', name: 'Second', count: 2 },
      { id: 'id_3', name: 'Third', count: 3 },
    ]);

    expect(await findManyByIds(db as never, widgets, [])).toEqual([]);

    const items = await findManyByIds(db as never, widgets, ['id_1', 'id_3']);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id).sort()).toEqual(['id_1', 'id_3']);

    const map = await findMapByIds(db as never, widgets, ['id_1', 'id_2']);
    expect(map.size).toBe(2);
    expect(map.get('id_1')?.name).toBe('First');
    expect(map.get('id_2')?.name).toBe('Second');
    expect(map.get('id_missing')).toBeUndefined();
  });

  it('pluck selects a single column as an array', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'pl_1', name: 'PluckA' },
      { id: 'pl_2', name: 'PluckB' },
      { id: 'pl_3', name: 'PluckC' },
    ]);

    const names = await pluck(db as never, widgets, 'name');
    expect(names.sort()).toEqual(['PluckA', 'PluckB', 'PluckC']);

    const filtered = await pluck(db as never, widgets, 'id', { where: { name: 'PluckB' } });
    expect(filtered).toEqual(['pl_2']);
  });

  it('sumRows, avgRows, minRows, maxRows compute column aggregates', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'ag_1', name: 'A', count: 10 },
      { id: 'ag_2', name: 'B', count: 20 },
      { id: 'ag_3', name: 'C', count: 30 },
    ]);

    expect(await sumRows(db as never, widgets, 'count')).toBe(60);
    expect(await avgRows(db as never, widgets, 'count')).toBe(20);
    expect(await minRows(db as never, widgets, 'count')).toBe(10);
    expect(await maxRows(db as never, widgets, 'count')).toBe(30);

    expect(await sumRows(db as never, widgets, 'count', { name: 'B' })).toBe(20);
  });

  it('paginate returns paginated items and total metadata in single batch', async () => {
    const db = await makeTestDb();
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `pg_${i + 1}`,
      name: `Widget ${i + 1}`,
      count: i + 1,
    }));
    await insertMany(db as never, widgets, rows);

    const p1 = await paginate(db as never, widgets, { page: 1, pageSize: 10, orderBy: widgets.count });
    expect(p1.total).toBe(25);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(10);
    expect(p1.hasMore).toBe(true);
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0]?.id).toBe('pg_1');

    const p3 = await paginate(db as never, widgets, { page: 3, pageSize: 10, orderBy: widgets.count });
    expect(p3.items).toHaveLength(5);
    expect(p3.hasMore).toBe(false);
  });

  it('paginate projects only requested columns', async () => {
    const db = await makeTestDb();
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `pj_${i + 1}`,
      name: `Projected ${i + 1}`,
      count: i + 1,
    }));
    await insertMany(db as never, widgets, rows);

    const page = await paginate(db as never, widgets, {
      columns: { id: true, count: true },
      pageSize: 5,
      orderBy: widgets.count,
    });

    expect(page.total).toBe(12);
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toEqual({ id: 'pj_1', count: 1 });
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['count', 'id']);
  });

  it('paginate derives page from an explicit offset', async () => {
    const db = await makeTestDb();
    const rows = Array.from({ length: 22 }, (_, i) => ({
      id: `of_${i + 1}`,
      name: `Offset ${i + 1}`,
      count: i + 1,
    }));
    await insertMany(db as never, widgets, rows);

    const slice = await paginate(db as never, widgets, {
      offset: 10,
      pageSize: 10,
      orderBy: widgets.count,
    });

    expect(slice.page).toBe(2);
    expect(slice.totalPages).toBe(3);
    expect(slice.items).toHaveLength(10);
    expect(slice.items[0]?.id).toBe('of_11');
    expect(slice.hasMore).toBe(true);
  });

  it('paginate applies a non-aligned offset exactly', async () => {
    const db = await makeTestDb();
    const rows = Array.from({ length: 22 }, (_, i) => ({
      id: `of_${i + 1}`,
      name: `Offset ${i + 1}`,
      count: i + 1,
    }));
    await insertMany(db as never, widgets, rows);

    const slice = await paginate(db as never, widgets, {
      offset: 12,
      pageSize: 10,
      orderBy: widgets.count,
    });

    expect(slice.page).toBe(2);
    expect(slice.items[0]?.id).toBe('of_13');
    expect(slice.items).toHaveLength(10);
  });

  it('paginate works on drivers exposing db.batch without routing promises into it', async () => {
    const db = await makeTestDb();
    const batch = vi.fn();
    const batchDb = new Proxy(db, {
      get(target, prop, receiver) {
        return prop === 'batch' ? batch : Reflect.get(target, prop, receiver);
      },
    });
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `bt_${i + 1}`,
      name: `Batched ${i + 1}`,
      count: i + 1,
    }));
    await insertMany(db as never, widgets, rows);

    const page = await paginate(batchDb as never, widgets, {
      columns: { id: true, count: true },
      pageSize: 3,
      orderBy: widgets.count,
    });

    expect(batch).not.toHaveBeenCalled();
    expect(page.total).toBe(7);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toEqual({ id: 'bt_1', count: 1 });
  });

  it('insertRow and insertMany insert and return rows', async () => {
    const db = await makeTestDb();
    const single = await insertRow(db as never, widgets, { id: 'w_ins', name: 'Inserted' });
    expect(single.id).toBe('w_ins');
    expect(single.name).toBe('Inserted');

    const multiple = await insertMany(db as never, widgets, [
      { id: 'w_m1', name: 'M1' },
      { id: 'w_m2', name: 'M2' },
    ]);
    expect(multiple).toHaveLength(2);
  });

  it('upsertRow updates on conflict or inserts', async () => {
    const db = await makeTestDb();
    const first = await upsertRow(db as never, widgets, { id: 'up_1', name: 'UpsertInitial', count: 5 }, {
      target: widgets.id,
      set: { count: 10 },
    });
    expect(first?.count).toBe(5);

    const second = await upsertRow(db as never, widgets, { id: 'up_1', name: 'UpsertIgnored', count: 99 }, {
      target: widgets.id,
      set: { count: 50 },
    });
    expect(second?.count).toBe(50);
  });

  it('updateRow and updateWhere update fields and timestamps', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_upd', name: 'BeforeUpdate', count: 1 });

    const updated = await updateRow(db as never, widgets, 'w_upd', { name: 'AfterUpdate', count: 2 });
    expect(updated?.name).toBe('AfterUpdate');
    expect(updated?.count).toBe(2);

    const notFound = await updateRow(db as never, widgets, 'w_missing', { name: 'None' });
    expect(notFound).toBeNull();
  });

  it('softDeleteRow and softDeleteWhere mark deletedAt and take extra values', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_sdel', name: 'ToSoftDelete', active: true });

    const deleted = await softDeleteRow(db as never, widgets, 'w_sdel', { active: false });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.active).toBe(false);

    const live = await findById(db as never, widgets, 'w_sdel');
    expect(live).toBeNull();

    const withDeleted = await findById(db as never, widgets, 'w_sdel', { withDeleted: true });
    expect(withDeleted).not.toBeNull();
  });

  it('softDeleteByIds, deleteByIds, and restoreByIds manage bulk state', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'bulk_1', name: 'B1' },
      { id: 'bulk_2', name: 'B2' },
      { id: 'bulk_3', name: 'B3' },
    ]);

    const sdeleted = await softDeleteByIds(db as never, widgets, ['bulk_1', 'bulk_2']);
    expect(sdeleted).toHaveLength(2);

    expect(await findById(db as never, widgets, 'bulk_1')).toBeNull();

    const restored = await restoreByIds(db as never, widgets, ['bulk_1']);
    expect(restored).toHaveLength(1);
    expect(await findById(db as never, widgets, 'bulk_1')).not.toBeNull();

    const hardDeleted = await deleteByIds(db as never, widgets, ['bulk_3']);
    expect(hardDeleted).toHaveLength(1);
    expect(await findById(db as never, widgets, 'bulk_3', { withDeleted: true })).toBeNull();
  });

  it('restoreRow and restoreWhere clear deletedAt', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_res', name: 'RestoreMe' });
    await softDeleteRow(db as never, widgets, 'w_res');
    expect(await findById(db as never, widgets, 'w_res')).toBeNull();

    const restored = await restoreRow(db as never, widgets, 'w_res');
    expect(restored?.deletedAt).toBeNull();
    expect(await findById(db as never, widgets, 'w_res')).not.toBeNull();

    await softDeleteRow(db as never, widgets, 'w_res');
    const restoredWhere = await restoreWhere(db as never, widgets, { name: 'RestoreMe' });
    expect(restoredWhere).toHaveLength(1);
    expect(restoredWhere[0]?.deletedAt).toBeNull();
  });

  it('toggleRow negates boolean columns', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_tog', name: 'ToggleTest', active: true });

    const flipped1 = await toggleRow(db as never, widgets, 'w_tog', 'active');
    expect(flipped1?.active).toBe(false);

    const flipped2 = await toggleRow(db as never, widgets, 'w_tog', 'active');
    expect(flipped2?.active).toBe(true);
  });

  it('clampIncrementRow bounds increment between min and max', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, widgets, { id: 'w_cl', name: 'ClampTest', count: 5, capacity: 10 });

    const inc1 = await clampIncrementRow(db as never, widgets, 'w_cl', 'count', 3, { min: 0, max: 'capacity' });
    expect(inc1?.count).toBe(8);

    const inc2 = await clampIncrementRow(db as never, widgets, 'w_cl', 'count', 10, { min: 0, max: 'capacity' });
    expect(inc2?.count).toBe(10);

    const inc3 = await clampIncrementRow(db as never, widgets, 'w_cl', 'count', -20, { min: 0, max: 'capacity' });
    expect(inc3?.count).toBe(0);
  });

  it('searchCondition builds case-insensitive fuzzy search', async () => {
    const db = await makeTestDb();
    await insertMany(db as never, widgets, [
      { id: 'sc_1', name: 'Apple Pie' },
      { id: 'sc_2', name: 'Banana Split' },
      { id: 'sc_3', name: 'Pineapple' },
    ]);

    const cond = searchCondition([widgets.name], 'apple');
    expect(cond).toBeDefined();

    const matches = await findMany(db as never, widgets, { where: cond });
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.name).sort()).toEqual(['Apple Pie', 'Pineapple']);
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

  it('findOrgRow returns row only when organization matches', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, {
      id: 't_1',
      organizationId: 'org_a',
      title: 'Item A',
    });

    const match = await findOrgRow(db as never, tenantItems, 't_1', 'org_a');
    expect(match?.id).toBe('t_1');
    expect(match?.title).toBe('Item A');

    const mismatch = await findOrgRow(db as never, tenantItems, 't_1', 'org_b');
    expect(mismatch).toBeNull();
  });

  it('findOrgRow auto-detects tenantId column when organizationId is absent', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantScopedItems, {
      id: 'ts_1',
      tenantId: 'tenant_omega',
      title: 'Omega Item',
    });

    const match = await findOrgRow(db as never, tenantScopedItems, 'ts_1', 'tenant_omega');
    expect(match?.id).toBe('ts_1');
    expect(match?.title).toBe('Omega Item');

    const mismatch = await findOrgRow(db as never, tenantScopedItems, 'ts_1', 'tenant_alpha');
    expect(mismatch).toBeNull();
  });

  it('findOrgRowOrThrow throws NotFoundError on mismatch or missing', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, {
      id: 't_throw',
      organizationId: 'org_a',
      title: 'Item Throw',
    });

    const found = await findOrgRowOrThrow(db as never, tenantItems, 't_throw', 'org_a', 'Item');
    expect(found.id).toBe('t_throw');

    await expect(
      findOrgRowOrThrow(db as never, tenantItems, 't_throw', 'org_b', 'Item')
    ).rejects.toThrow('Item not found');

    await expect(
      findOrgRowOrThrow(db as never, tenantItems, 't_missing', 'org_a', (id) => new Error(`Custom ${id}`))
    ).rejects.toThrow('Custom t_missing');
  });

  it('findManyByOrg filters and orders records by organization', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, { id: 't_m1', organizationId: 'org_x', title: 'Beta' });
    await insertRow(db as never, tenantItems, { id: 't_m2', organizationId: 'org_x', title: 'Alpha' });
    await insertRow(db as never, tenantItems, { id: 't_m3', organizationId: 'org_y', title: 'Gamma' });

    const orgXItems = await findManyByOrg(db as never, tenantItems, 'org_x', {
      orderBy: desc(tenantItems.title),
    });
    expect(orgXItems.length).toBe(2);
    expect(orgXItems[0]?.title).toBe('Beta');
    expect(orgXItems[1]?.title).toBe('Alpha');

    const orgYItems = await findManyByOrg(db as never, tenantItems, 'org_y');
    expect(orgYItems.length).toBe(1);
    expect(orgYItems[0]?.title).toBe('Gamma');
  });

  it('countOrgRows counts scoped rows correctly', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, { id: 't_c1', organizationId: 'org_cnt', title: 'One' });
    await insertRow(db as never, tenantItems, { id: 't_c2', organizationId: 'org_cnt', title: 'Two' });
    await insertRow(db as never, tenantItems, { id: 't_c3', organizationId: 'org_other', title: 'Three' });

    const total = await countOrgRows(db as never, tenantItems, 'org_cnt');
    expect(total).toBe(2);

    const otherTotal = await countOrgRows(db as never, tenantItems, 'org_other');
    expect(otherTotal).toBe(1);
  });

  it('updateOrgRow mutates only matching org row', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, { id: 't_upd', organizationId: 'org_u', title: 'Before' });

    const mismatched = await updateOrgRow(db as never, tenantItems, 't_upd', 'org_wrong', {
      title: 'Hacked',
    });
    expect(mismatched).toBeNull();

    const updated = await updateOrgRow(db as never, tenantItems, 't_upd', 'org_u', {
      title: 'After',
    });
    expect(updated?.title).toBe('After');
  });

  it('softDeleteOrgRow flags record only within same organization', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, { id: 't_sd', organizationId: 'org_s', title: 'Alive' });

    const wrongOrg = await softDeleteOrgRow(db as never, tenantItems, 't_sd', 'org_other');
    expect(wrongOrg).toBeNull();

    const deleted = await softDeleteOrgRow(db as never, tenantItems, 't_sd', 'org_s', {
      extraValues: { status: 'archived' },
    });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.status).toBe('archived');

    const active = await findOrgRow(db as never, tenantItems, 't_sd', 'org_s');
    expect(active).toBeNull();

    const withDeleted = await findOrgRow(db as never, tenantItems, 't_sd', 'org_s', { withDeleted: true });
    expect(withDeleted).not.toBeNull();
  });

  it('deleteOrgRow physically removes row only for matching org', async () => {
    const db = await makeTestDb();
    await insertRow(db as never, tenantItems, { id: 't_del', organizationId: 'org_d', title: 'DeleteMe' });

    const wrongDelete = await deleteOrgRow(db as never, tenantItems, 't_del', 'org_wrong');
    expect(wrongDelete).toBe(false);

    const successfulDelete = await deleteOrgRow(db as never, tenantItems, 't_del', 'org_d');
    expect(successfulDelete).toBe(true);

    const gone = await findOrgRow(db as never, tenantItems, 't_del', 'org_d', { withDeleted: true });
    expect(gone).toBeNull();
  });

  it('orgCondition generates eq condition for org column', async () => {
    const cond = orgCondition(tenantItems, 'org_cond');
    expect(cond).toBeDefined();
  });

  it('paginateOrgRows paginates multi-tenant items with metadata', async () => {
    const db = await makeTestDb();
    for (let i = 1; i <= 7; i++) {
      await insertRow(db as never, tenantItems, {
        id: `pg_item_${i}`,
        organizationId: 'org_paginate',
        title: `Item ${i}`,
      });
    }
    await insertRow(db as never, tenantItems, {
      id: 'pg_item_del',
      organizationId: 'org_paginate',
      title: 'Deleted Item',
      deletedAt: new Date(),
    });
    await insertRow(db as never, tenantItems, {
      id: 'pg_item_other',
      organizationId: 'org_other',
      title: 'Other Org Item',
    });

    const result = await paginateOrgRows(db as never, tenantItems, 'org_paginate', {
      page: 2,
      pageSize: 3,
    });

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(3);
    expect(result.totalPages).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(3);
  });
});
