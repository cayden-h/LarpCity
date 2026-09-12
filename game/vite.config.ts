// Vite config: both pages in the build, plus a dev/preview proxy for live
// Alpha Vantage quotes. The key stays on the server (ALPHAVANTAGE_API_KEY in
// .env.local); the browser only calls /api/market/*. Responses are cached on
// disk because the free tier allows 25 requests a day. Without a key, the
// endpoints answer 503 and the pages fall back to the FRED snapshot in
// src/data/market.ts.

import { defineConfig, loadEnv, type Plugin } from "vite";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CACHE_DIR = fileURLToPath(new URL("./.cache/market/", import.meta.url));
const QUOTE_TTL_MS = 6 * 60 * 60 * 1000;
const DAILY_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED = /^[A-Z.]{1,6}$/;

type Json = Record<string, unknown>;

function marketProxy(apiKey: string | undefined): Plugin {
  const cachePath = (name: string) => `${CACHE_DIR}${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;

  async function query(params: Record<string, string>, ttl: number): Promise<{ data: Json; cached: boolean }> {
    const file = cachePath(Object.values(params).join("_"));
    const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < ttl;
    if (fresh) return { data: JSON.parse(readFileSync(file, "utf8")), cached: true };
    const url = `https://www.alphavantage.co/query?${new URLSearchParams({ ...params, apikey: apiKey ?? "" })}`;
    const res = await fetch(url);
    const data = (await res.json()) as Json;
    if (data.Note || data.Information || data["Error Message"]) {
      // Rate limited or bad symbol: serve a stale copy if there is one.
      if (existsSync(file)) return { data: JSON.parse(readFileSync(file, "utf8")), cached: true };
      throw new Error(String(data.Note ?? data.Information ?? data["Error Message"]));
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
    return { data, cached: false };
  }

  /** Alpha Vantage has shipped two GLOBAL_QUOTE shapes; accept both. */
  function normalizeQuote(symbol: string, data: Json) {
    const g = (data["Global Quote"] ?? data) as Json;
    const pick = (...keys: string[]) => keys.map((k) => g[k]).find((v) => v !== undefined);
    const price = Number(pick("05. price", "price"));
    const change = Number(pick("09. change", "change"));
    const pct = String(pick("10. change percent", "change_percent") ?? "0").replace("%", "");
    const day = String(pick("07. latest trading day", "timestamp") ?? "");
    return { symbol, price, change, changePct: Number(pct) / 100, day };
  }

  const handler = async (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b: string): void }) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/status") return send(200, { live: Boolean(apiKey) });
    if (!apiKey) return send(503, { error: "Set ALPHAVANTAGE_API_KEY in game/.env.local to enable live quotes." });
    try {
      if (url.pathname === "/quotes") {
        const symbols = (url.searchParams.get("symbols") ?? "SPY,QQQ,DIA,IWM").split(",").map((s) => s.trim().toUpperCase()).filter((s) => ALLOWED.test(s)).slice(0, 4);
        const quotes = [];
        let cached = true;
        for (const symbol of symbols) {
          const r = await query({ function: "GLOBAL_QUOTE", symbol }, QUOTE_TTL_MS);
          cached &&= r.cached;
          quotes.push(normalizeQuote(symbol, r.data));
        }
        return send(200, { source: "Alpha Vantage", cached, quotes });
      }
      if (url.pathname === "/daily") {
        const symbol = (url.searchParams.get("symbol") ?? "SPY").toUpperCase();
        if (!ALLOWED.test(symbol)) return send(400, { error: "Bad symbol" });
        const r = await query({ function: "TIME_SERIES_DAILY", symbol, outputsize: "compact" }, DAILY_TTL_MS);
        const series = (r.data["Time Series (Daily)"] ?? {}) as Record<string, Record<string, string>>;
        const points = Object.entries(series)
          .map(([d, v]) => [d, Number(v["4. close"])] as [string, number])
          .sort((a, b) => (a[0] < b[0] ? -1 : 1));
        return send(200, { source: "Alpha Vantage", cached: r.cached, symbol, points });
      }
      return send(404, { error: "Unknown market endpoint" });
    } catch (e) {
      return send(502, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    name: "larp-market-proxy",
    configureServer(server) {
      server.middlewares.use("/api/market", (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/market", (req, res) => void handler(req, res));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Keys can live in game/.env.local or in the repo-root .env the server uses; game/ wins.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...loadEnv(mode, root, ""), ...loadEnv(mode, process.cwd(), "") };
  return {
    // Public VITE_* values (VITE_API_BASE_URL, the server's address) live in the repo-root .env
    // next to the server's keys; Vite only ever exposes VITE_-prefixed values to the browser.
    envDir: root,
    plugins: [marketProxy(env.ALPHAVANTAGE_API_KEY || undefined)],
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          debt: fileURLToPath(new URL("./debt.html", import.meta.url)),
        },
      },
    },
  };
});
