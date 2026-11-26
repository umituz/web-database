import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const DDL = `
  CREATE TABLE wh_widgets (
    id text PRIMARY KEY,
    name text,
    count integer,
    active boolean DEFAULT true,
    capacity integer DEFAULT 100,
    opened_at timestamptz,
    best_before date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
  CREATE UNIQUE INDEX wh_widgets_name_key ON wh_widgets (name);
  CREATE TABLE wh_orgs (
    id text PRIMARY KEY,
    modes jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
  CREATE TABLE wh_tenant_items (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    title text,
    status text DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
`;

type PgliteDb = ReturnType<typeof drizzle>;

let client: PGlite | null = null;
let dbRef: PgliteDb | null = null;

export async function makeTestDb(): Promise<PgliteDb> {
  if (!client) {
    client = new PGlite();
    await client.exec(DDL);
    dbRef = drizzle(client);
  }
  return dbRef!;
}

export async function resetDb(): Promise<void> {
  if (client) {
    await client.exec('TRUNCATE wh_widgets');
    await client.exec('TRUNCATE wh_tenant_items');
  }
}

export async function resetOrgDb(): Promise<void> {
  if (client) await client.exec('TRUNCATE wh_orgs');
}
