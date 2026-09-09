/**
 * THE only place a database driver is constructed.
 *
 * Local development uses file-based PGlite in `.data/pg`; setting DATABASE_URL
 * switches to hosted Postgres (Supabase, Neon, RDS) with no other change anywhere
 * in the codebase. That is the whole of the migration path.
 *
 * PGlite does NOT lock its data directory (verified — see research.md D3), so the
 * singleton below is load-bearing: it guarantees one driver instance per process,
 * survives Next.js hot reload, and runs migrations and seeding in-process so no
 * separate CLI ever opens the database.
 */
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema'

/**
 * The application's database type. PGlite and node-postgres expose the same
 * Drizzle query API and differ only in their result wrapper, so the node-postgres
 * instance is cast to this type in exactly one place, below.
 */
export type Db = PgliteDatabase<typeof schema>

type Handle = { db: Db; migratedAt: string; driver: 'pglite' | 'postgres' }

const globalForDb = globalThis as unknown as { __aopsDb?: Promise<Handle> }

const DATA_DIR = path.resolve(process.cwd(), '.data', 'pg')
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle')

async function createPglite(): Promise<Handle> {
  const { PGlite } = await import('@electric-sql/pglite')
  // PGlite's node filesystem layer calls a non-recursive mkdir, so the parent
  // directories have to exist first (verified — research.md D4).
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const client = await PGlite.create({ dataDir: DATA_DIR })
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db, migratedAt: new Date().toISOString(), driver: 'pglite' }
}

async function createPostgres(connectionString: string): Promise<Handle> {
  const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
    import('pg'),
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
  ])
  const pool = new Pool({ connectionString, max: 8 })
  const db = drizzle(pool, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db: db as unknown as Db, migratedAt: new Date().toISOString(), driver: 'postgres' }
}

async function init(): Promise<Handle> {
  const url = process.env.DATABASE_URL
  const handle = url ? await createPostgres(url) : await createPglite()
  const { ensureSeed } = await import('./seed')
  await ensureSeed(handle.db)
  return handle
}

/** Every read and write in the app starts here. Initialization happens once. */
export async function getDb(): Promise<Db> {
  globalForDb.__aopsDb ??= init()
  return (await globalForDb.__aopsDb).db
}

export async function getDbInfo(): Promise<{
  driver: 'pglite' | 'postgres'
  migratedAt: string
  tableCount: number
}> {
  globalForDb.__aopsDb ??= init()
  const handle = await globalForDb.__aopsDb
  const res = await handle.db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  )
  const rows = res.rows as unknown as { n: number }[]
  return {
    driver: handle.driver,
    migratedAt: handle.migratedAt,
    tableCount: rows[0]?.n ?? 0,
  }
}

export { schema }
