// server/src/session.ts
import type { Request, Response, NextFunction } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "./db.js";
import { env } from "./env.js";

const COOKIE_NAME = "larp_session";

declare module "express-serve-static-core" {
  interface Request {
    playerId: string;
  }
}

export function sign(secret: string, value: string): string {
  const sig = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

export function unsign(secret: string, signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(sig, "hex");
  } catch {
    return null;
  }
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
  return value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookies = parseCookies(req.header("cookie"));
  const raw = cookies[COOKIE_NAME];
  let playerId = raw ? unsign(env.SESSION_SECRET, raw) : null;

  if (!playerId) {
    playerId = randomUUID();
    res.cookie(COOKIE_NAME, sign(env.SESSION_SECRET, playerId), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }

  req.playerId = playerId;

  try {
    await pool.query(
      `INSERT INTO players (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [playerId, `guest-${playerId.slice(0, 8)}`],
    );
    next();
  } catch (err) {
    next(err);
  }
}
