import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

type DB = LibSQLDatabase<typeof schema> & { $client: Client };

// Reuse one client across hot reloads in development.
const g = globalThis as unknown as { __libsql?: Client };
let real: DB | undefined;

// Connect on first use, not at import: `next build` imports every route to collect
// its config, and must not need a database to do so.
function getDb(): DB {
  if (real) return real;
  const url = process.env.DATABASE_URL ?? "file:./data/spaceair.db";
  if (process.env.VERCEL && url.startsWith("file:"))
    throw new Error("DATABASE_URL is not set: a local SQLite file can't be used on Vercel. Set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN.");
  const client = g.__libsql ?? createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  if (process.env.NODE_ENV !== "production") g.__libsql = client;
  real = drizzle(client, { schema });
  return real;
}

export const db = new Proxy({} as DB, {
  get(_, prop) {
    const d = getDb();
    const v = Reflect.get(d, prop, d);
    return typeof v === "function" ? v.bind(d) : v;
  },
});
export { schema };
