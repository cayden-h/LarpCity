import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  // Tests assert on responses; the error logs they trigger on purpose would only be noise.
  level: env.NODE_ENV === "production" ? "info" : env.NODE_ENV === "test" ? "silent" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.api_key",
      "*.password",
      "*.secret",
    ],
    remove: true,
  },
});
