import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys live in the repo-root .env (see SETUP.md); load it before anything
// else touches process.env. Note: static ES module imports are hoisted and
// evaluated before any top-level code in this file runs, so any module that
// reads process.env at import time (e.g. ./env.js) must be imported
// dynamically, after dotenv.config() has actually executed.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { default: express } = await import("express");
const { default: helmet } = await import("helmet");
const { default: cors } = await import("cors");
const { env } = await import("./env.js");
const { logger } = await import("./logger.js");
const { generalLimiter } = await import("./middleware/rateLimit.js");
const { errorHandler } = await import("./middleware/errorHandler.js");
const { healthRouter } = await import("./routes/health.js");
const { runMigrations } = await import("./db.js");
const { sessionMiddleware } = await import("./session.js");

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware);
app.use(generalLimiter);

app.use("/api", healthRouter);

app.use(errorHandler);

async function main(): Promise<void> {
  await runMigrations();
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, "larp-city server listening"));
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
