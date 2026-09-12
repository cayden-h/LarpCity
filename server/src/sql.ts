// server/src/sql.ts

/**
 * Splits a SQL file into single statements. TimescaleDB refuses to create a
 * continuous aggregate inside a transaction, and Postgres runs a
 * multi-statement query as one, so migrations go one statement at a time.
 * Only for our own migration files: `--` comments are dropped and statements
 * end with a semicolon at the end of a line (no function bodies).
 */
export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
