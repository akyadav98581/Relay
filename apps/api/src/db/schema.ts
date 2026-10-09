import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { Graph } from '@relay/shared'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  graph: jsonb('graph').$type<Graph>().notNull(),
  enabled: boolean('enabled').notNull().default(false),
  webhookToken: text('webhook_token').notNull().unique(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('workflows_due_idx').on(t.nextRunAt), index('workflows_user_idx').on(t.userId)])

// A run keeps a copy of the graph it started with, so editing a workflow never
// changes a run that is already in flight.
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull(),
  payload: jsonb('payload'),
  graph: jsonb('graph').$type<Graph>().notNull(),
  status: text('status').notNull().default('running'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('runs_workflow_idx').on(t.workflowId, t.startedAt)])

export const runSteps = pgTable('run_steps', {
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  key: text('key').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.runId, t.nodeId] })])

// The queue. One row per step that is waiting to run or being run.
export const jobs = pgTable('jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('queued'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
}, (t) => [index('jobs_claim_idx').on(t.status, t.runAt)])
