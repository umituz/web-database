# @umituz/web-database

The database layer for the fleet — and the **single vendor-coupled module** in the entire ecosystem. Every other package and app speaks drizzle; only this one knows that the database behind it is Neon (serverless HTTP driver today). Swapping or adding a vendor later means changing this package, nothing else.

The package is **source-distributed** (published as raw TypeScript in `src/`). Wrangler, Vite, and tsc all compile it alongside your app; no prebuilt bundle ships.

## Why it exists

Before this package, `neon()` + `drizzle(neon(url))` boilerplate (and the `@neondatabase/serverless` dependency) was scattered across `web-hono` internals and every fleet app's scripts. A vendor change would have meant touching all of them. Now the vendor touch surface is one file: `src/driver.ts`.

Furthermore, repetitive database operations (soft-deletes, timestamp stamps, batch queries, single roundtrip paginations, bounded increments, and primary key lookups) are centralized here so consumer apps never duplicate raw query boilerplate.

## What's inside

| Export | What it is | Entry |
|---|---|---|
| `createDb(url, schema?)` | drizzle factory over the vendor driver — the only sanctioned way to build a `db` | `.` or `/driver` |
| `sql(url)` | raw vendor executor (tagged-template queries) for scripts that shouldn't go through drizzle | `.` or `/driver` |
| `Db` | the database type alias used across the fleet (`web-hono`'s `CrudDb`, `SnapshotDb` derive from it) | `.` or `/driver` |
| `batchQueries(db, queries)` | single HTTP roundtrip batch runner over Neon HTTP batching (named record or array) | `.` or `/query` |
| `findFirst(db, table, where?, options?)` | soft-delete aware single record query (`deletedAt IS NULL` auto-applied) | `.` or `/query` |
| `findFirstOrThrow(db, table, where?, labelOrError?, options?)` | soft-delete aware single record query throwing `NotFoundError` (status 404) | `.` or `/query` |
| `findMany(db, table, options?)` | soft-delete aware collection query with limit, offset, and orderBy | `.` or `/query` |
| `findById(db, table, id, options?)` | primary key lookup helper | `.` or `/query` |
| `findByIdOrThrow(db, table, id, labelOrError?, options?)` | primary key lookup helper throwing `NotFoundError` (status 404) if absent | `.` or `/query` |
| `findManyByIds(db, table, ids, options?)` | bulk lookup by ID array (returns `[]` immediately if empty without query) | `.` or `/query` |
| `findMapByIds(db, table, ids, options?)` | bulk lookup returning a `Map<string, Row>` keyed by id | `.` or `/query` |
| `pluck(db, table, column, options?)` | selects only the target column as an array (optimizes egress transfer) | `.` or `/query` |
| `exists(db, table, where?, options?)` | soft-delete aware lightweight boolean existence probe (`SELECT 1 LIMIT 1`) | `.` or `/query` |
| `existsById(db, table, id, options?)` | primary key existence probe | `.` or `/query` |
| `countRows(db, table, where?, options?)` | soft-delete aware exact count query | `.` or `/query` |
| `sumRows(db, table, column, where?, options?)` | column aggregation sum query (`coalesce(sum(col), 0)`) | `.` or `/query` |
| `avgRows(db, table, column, where?, options?)` | column aggregation average query | `.` or `/query` |
| `minRows(db, table, column, where?, options?)` | column minimum value query | `.` or `/query` |
| `maxRows(db, table, column, where?, options?)` | column maximum value query | `.` or `/query` |
| `paginate(db, table, options?)` | single roundtrip batch pagination returning `{ items, total, page, pageSize, totalPages, hasMore }` | `.` or `/query` |
| `insertRow(db, table, values)` | insert single row with `.returning()` | `.` or `/query` |
| `insertMany(db, table, values[])` | insert multiple rows in batch | `.` or `/query` |
| `upsertRow(db, table, values, options)` | atomic postgres upsert (`onConflictDoUpdate` or `onConflictDoNothing`) | `.` or `/query` |
| `updateRow(db, table, id, values, options?)` | update by ID with automatic `updatedAt` update | `.` or `/query` |
| `updateWhere(db, table, where, values, options?)` | update matching records with automatic `updatedAt` | `.` or `/query` |
| `incrementRow(db, table, id, increments, extraValues?, options?)` | atomic column increment (`col = col + delta`) | `.` or `/query` |
| `clampIncrementRow(db, table, id, column, delta, options)` | atomic bounded increment with `min` and `max` constraints | `.` or `/query` |
| `toggleRow(db, table, id, column, extraValues?, options?)` | atomic boolean negation (`col = NOT col`) | `.` or `/query` |
| `softDeleteRow(db, table, id, extraValues?)` | soft delete by ID with optional extra fields | `.` or `/query` |
| `softDeleteWhere(db, table, where, extraValues?)` | soft delete matching rows with optional extra fields | `.` or `/query` |
| `softDeleteByIds(db, table, ids, extraValues?)` | bulk soft delete by array of IDs | `.` or `/query` |
| `deleteRow(db, table, id)` | hard delete single row by ID | `.` or `/query` |
| `deleteWhere(db, table, where)` | hard delete matching rows | `.` or `/query` |
| `deleteByIds(db, table, ids)` | hard delete by array of IDs | `.` or `/query` |
| `restoreRow(db, table, id, extraValues?)` | restore soft-deleted row (`deletedAt = null`) | `.` or `/query` |
| `restoreWhere(db, table, where, extraValues?)` | restore matching soft-deleted rows | `.` or `/query` |
| `restoreByIds(db, table, ids, extraValues?)` | restore multiple rows by array of IDs | `.` or `/query` |
| `searchCondition(columns, query, table?)` | builds case-insensitive `or(ilike(...))` condition | `.` or `/query` |
| `resetTables` / `snapshotToSeed` / `seedFromSnapshot` / `snapshotToBytes` | lifecycle tooling: prefix-guarded drops, snapshot export, snapshot import | `.` or `/lifecycle` |

`resetTables` keeps the fleet's shared-database safety: it drops only tables carrying your project prefix and hard-stops the moment it sees a prefix-less table.

## Installation

```bash
npm install @umituz/web-database
```

Peer dependencies (install alongside): `drizzle-orm ^0.45`. The `@neondatabase/serverless` driver ships as a regular dependency — it is this package's implementation detail.

## Quick start

```ts
import { createDb } from '@umituz/web-database';
import * as schema from './schema';

export const db = createDb(process.env.DATABASE_URL!, schema);
```

A reset/seed script:

```ts
import { resetTables, seedFromSnapshot } from '@umituz/web-database/lifecycle';

await resetTables({ specs, prefix: 'hg_', url });
await seedFromSnapshot({ specs, url, inPath: new URL('./seed.sql.gz', import.meta.url) });
```

## Rules of engagement

- Apps and packages import **only** this package for driver creation and lifecycle work — never `@neondatabase/serverless` directly.
- Schema stays per-app: this package owns transport and lifecycle, not your tables.
- A vendor swap (or a second vendor) is implemented here and released as a major/minor of this package; consumers keep importing `createDb`/`sql`.

## Development

```bash
npm run typecheck && npm run lint && npm test
```

Tests run against an in-memory PGlite instance (`@electric-sql/pglite`); no database credentials needed.
