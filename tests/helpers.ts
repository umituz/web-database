import { pgTable, text, timestamp, integer, date, jsonb, boolean } from 'drizzle-orm/pg-core';

export const widgets = pgTable('wh_widgets', {
  id: text('id').primaryKey(),
  name: text('name'),
  count: integer('count'),
  active: boolean('active').default(true),
  capacity: integer('capacity').default(100),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  bestBefore: date('best_before'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const orgs = pgTable('wh_orgs', {
  id: text('id').primaryKey(),
  modes: jsonb('modes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const tenantItems = pgTable('wh_tenant_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  title: text('title'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
