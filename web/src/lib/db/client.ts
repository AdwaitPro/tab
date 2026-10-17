import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { schema } from "./schema";

/**
 * Driver-agnostic handle. Production uses Neon (serverless Pool over WebSockets, which
 * supports interactive transactions); local dev and tests use PGlite with the same schema
 * and migrations, so business logic never branches on the driver.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

const globalForDb = globalThis as unknown as { __tabDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__tabDb ??= connect(process.env.DATABASE_URL?.trim()).catch((error: unknown) => {
    globalForDb.__tabDb = undefined;
    throw error;
  });
  return globalForDb.__tabDb;
}

/** Test hook: swap in an isolated database. */
export function setDbForTesting(db: Db | undefined): void {
  globalForDb.__tabDb = db ? Promise.resolve(db) : undefined;
}

async function connect(url: string | undefined): Promise<Db> {
  if (url && /^postgres(ql)?:\/\//.test(url)) return connectNeon(url);
  if (!url && process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("DATABASE_URL is not configured");
  }
  const target = url?.startsWith("pglite:") ? url.slice("pglite:".length) : "./.pglite";
  return createPgliteDb(target === "memory" ? undefined : target);
}

async function connectNeon(url: string): Promise<Db> {
  const [{ Pool }, { drizzle }] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
  ]);
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzle({ client: pool, schema }) as unknown as Db;
}

/** PGlite database with migrations applied. `dataDir` undefined → in-memory. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}
