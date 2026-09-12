// server/src/routes/snapshot.ts
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const snapshotRouter = Router();

const DAY_ZERO_MS = Date.UTC(2000, 0, 1);

export function dayToTimestamp(day: number): string {
  return new Date(DAY_ZERO_MS + day * 86_400_000).toISOString();
}

const startRunBody = z.object({ seed: z.number().int() });

snapshotRouter.post("/runs", async (req, res) => {
  const parsed = startRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const runId = randomUUID();
  try {
    await pool.query(`INSERT INTO runs (id, player_id, seed) VALUES ($1, $2, $3)`, [
      runId,
      req.playerId,
      parsed.data.seed,
    ]);
    res.status(201).json({ runId });
  } catch (err) {
    logger.error({ err }, "run creation failed");
    res.status(500).json({ error: "run_creation_failed" });
  }
});

async function ownsRun(playerId: string, runId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM runs WHERE id = $1 AND player_id = $2`, [runId, playerId]);
  return rows.length > 0;
}

const snapshotEntry = z.object({
  day: z.number().int().min(0).max(100_000),
  netWorth: z.number().finite(),
  checking: z.number().finite(),
  savings: z.number().finite(),
  brokerage: z.number().finite(),
  retirement: z.number().finite(),
  debt: z.number().finite(),
});

const snapshotBody = z.object({
  runId: z.string().uuid(),
  entries: z.array(snapshotEntry).min(1).max(5000),
});

snapshotRouter.post("/snapshot", async (req, res) => {
  const parsed = snapshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const { runId, entries } = parsed.data;
  if (!(await ownsRun(req.playerId, runId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO player_snapshots (ts, run_id, day, net_worth, checking, savings, brokerage, retirement, debt)
       SELECT '2000-01-01'::timestamptz + d * interval '1 day', $1, d, nw, ch, sv, br, rt, dt
       FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])
         AS t(d, nw, ch, sv, br, rt, dt)
       ON CONFLICT DO NOTHING`,
      [
        runId,
        entries.map((e) => e.day),
        entries.map((e) => e.netWorth),
        entries.map((e) => e.checking),
        entries.map((e) => e.savings),
        entries.map((e) => e.brokerage),
        entries.map((e) => e.retirement),
        entries.map((e) => e.debt),
      ],
    );
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "snapshot insert failed");
    res.status(500).json({ error: "snapshot_failed" });
  }
});

snapshotRouter.get("/history/:runId", async (req, res) => {
  if (!(await ownsRun(req.playerId, req.params.runId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT day, net_worth, checking, savings, brokerage, retirement, debt
     FROM player_snapshots WHERE run_id = $1 ORDER BY day ASC`,
    [req.params.runId],
  );
  res.json(rows);
});

snapshotRouter.get("/leaderboard", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.name, s.day, s.net_worth
    FROM (
      SELECT DISTINCT ON (run_id) run_id, day, net_worth
      FROM player_snapshots ORDER BY run_id, ts DESC
    ) s
    JOIN runs r ON r.id = s.run_id
    JOIN players p ON p.id = r.player_id
    WHERE p.verified = true
    ORDER BY s.net_worth DESC
    LIMIT 50
  `);
  res.json(rows);
});
