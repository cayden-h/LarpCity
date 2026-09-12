// server/src/http.ts
// Route helpers. Express 4 doesn't catch a rejected promise from an async
// handler, so every async route goes through `handle`, which always answers:
// an HttpError becomes its status and message, anything else a logged 500.
import type { Request, Response } from "express";
import type { z } from "zod";
import { logger } from "./logger.js";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A handler's answer with a status other than 200. */
export class Reply {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
}

/** Maps a provider's error to an HttpError (for example a Nessie outage to a 502); undefined leaves it a 500. */
export type ErrorMap = (err: unknown) => HttpError | undefined;

export function handle(fn: (req: Request) => Promise<unknown>, mapError?: ErrorMap) {
  return (req: Request, res: Response) => {
    fn(req)
      .then((out) => (out instanceof Reply ? res.status(out.status).json(out.body) : res.json(out)))
      .catch((err: unknown) => {
        const http = err instanceof HttpError ? err : mapError?.(err);
        if (http) {
          if (http.status >= 500) logger.error({ status: http.status, message: http.message, path: req.path }, "request failed");
          return res.status(http.status).json({ error: http.message });
        }
        logger.error({ err, path: req.path }, "unhandled request error");
        return res.status(500).json({ error: "internal_error" });
      });
  };
}

/** Validates a body or query; a bad one is a 400 before anything reaches a provider or the database. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "invalid body");
  return r.data;
}
