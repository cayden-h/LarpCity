// server/src/db.ts
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { splitSql } from "./sql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pg lets an sslmode in the URL override the `ssl` option below, and it treats
// sslmode=require as verify-full, which rejects Tiger Data's certificate chain.
// So strip sslmode from the URL and decide TLS here.
const dbUrl = new URL(env.DATABASE_URL);
const sslDisabled = dbUrl.searchParams.get("sslmode") === "disable";
dbUrl.searchParams.delete("sslmode");

export const pool = new pg.Pool({
  connectionString: dbUrl.toString(),
  // Tiger Data requires TLS; a local Postgres (a DATABASE_URL with sslmode=disable) doesn't speak it.
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 10,
});

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "migrations.sql"), "utf8");
  // One statement at a time: a continuous aggregate can't be created inside a transaction.
  for (const statement of splitSql(sql)) await pool.query(statement);
  logger.info("server migrations applied");
}
