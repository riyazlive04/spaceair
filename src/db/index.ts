import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/spaceair.db";

// Reuse one client across hot reloads in development.
const g = globalThis as unknown as { __libsql?: Client };
const client = g.__libsql ?? createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
if (process.env.NODE_ENV !== "production") g.__libsql = client;

export const db = drizzle(client, { schema });
export { schema };
