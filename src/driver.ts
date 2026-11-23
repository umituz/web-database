import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';

export type Db<TSchema extends Record<string, unknown> = Record<string, never>> = NeonHttpDatabase<TSchema>;

export function sql(url: string) {
  return neon(url);
}

export function createDb<TSchema extends Record<string, unknown>>(
  url: string,
  schema?: TSchema,
): Db<TSchema> {
  const client = neon(url);
  return schema === undefined ? drizzle(client) : drizzle(client, { schema });
}
