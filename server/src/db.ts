// server/src/db.ts
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { env } from "./env.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "migrations.sql"), "utf8");
  await pool.query(sql);
  logger.info("server migrations applied");
}
