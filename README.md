# @umituz/web-database

The database layer for the fleet — and the **single vendor-coupled module** in the entire ecosystem. Every other package and app speaks drizzle; only this one knows that the database behind it is Neon (serverless HTTP driver today). Swapping or adding a vendor later means changing this package, nothing else.

The package is **source-distributed** (published as raw TypeScript in `src/`). Wrangler, Vite, and tsc all compile it alongside your app; no prebuilt bundle ships.

## Why it exists

Before this package, `neon()` + `drizzle(neon(url))` boilerplate (and the `@neondatabase/serverless` dependency) was scattered across `web-hono` internals and every fleet app's scripts. A vendor change would have meant touching all of them. Now the vendor touch surface is one file: `src/driver.ts`.

## What's inside

| Export | What it is | Entry |
|---|---|---|
| `createDb(url, schema?)` | drizzle factory over the vendor driver — the only sanctioned way to build a `db` | `.` or `/driver` |
| `sql(url)` | raw vendor executor (tagged-template queries) for scripts that shouldn't go through drizzle | `.` or `/driver` |
| `Db` | the database type alias used across the fleet (`web-hono`'s `CrudDb`, `SnapshotDb` derive from it) | `.` or `/driver` |
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
