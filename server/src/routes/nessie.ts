// server/src/routes/nessie.ts
import { Router } from "express";
import { z } from "zod";
import { provisionPlayer, getAccount, postDeposit } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const nessieRouter = Router();

async function ownsAccount(playerId: string, accountId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM players
     WHERE id = $1 AND $2 IN (nessie_checking_id, nessie_savings_id, nessie_credit_id)`,
    [playerId, accountId],
  );
  return rows.length > 0;
}

nessieRouter.post("/provision", async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT nessie_checking_id, nessie_savings_id, nessie_credit_id FROM players WHERE id = $1`,
      [req.playerId],
    );
    const row = existing.rows[0];
    if (row?.nessie_checking_id) {
      res.json({
        checkingId: row.nessie_checking_id,
        savingsId: row.nessie_savings_id,
        creditId: row.nessie_credit_id,
      });
      return;
    }
    const accounts = await provisionPlayer(req.playerId);
    await pool.query(
      `UPDATE players
       SET nessie_customer_id = $1, nessie_checking_id = $2, nessie_savings_id = $3, nessie_credit_id = $4
       WHERE id = $5`,
      [accounts.customerId, accounts.checkingId, accounts.savingsId, accounts.creditId, req.playerId],
    );
    res.json({ checkingId: accounts.checkingId, savingsId: accounts.savingsId, creditId: accounts.creditId });
  } catch (err) {
    logger.error({ err }, "nessie provision failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});

const syncBody = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive().max(1_000_000),
  description: z.string().min(1).max(200),
});

nessieRouter.post("/sync", async (req, res) => {
  const parsed = syncBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  if (!(await ownsAccount(req.playerId, parsed.data.accountId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const result = await postDeposit(parsed.data.accountId, parsed.data.amount, parsed.data.description);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nessie sync failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});

nessieRouter.get("/:accountId", async (req, res) => {
  if (!(await ownsAccount(req.playerId, req.params.accountId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const account = await getAccount(req.params.accountId);
    res.json(account);
  } catch (err) {
    logger.error({ err }, "nessie get account failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});
