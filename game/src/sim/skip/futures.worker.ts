// Builds the preview's futures off the main thread (see futures.ts) and posts
// each one back as it finishes, so the setup screen can show progress.

import { buildFuture, previewSeed } from "./futures.ts";

interface BuildRequest {
  seed: number;
  runs: number;
  years: number;
}

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (ev) => {
  const { seed, runs, years } = ev.data;
  for (let i = 0; i < runs; i++) {
    const f = buildFuture(previewSeed(seed, i), years);
    scope.postMessage({ i, stock: f.stock, bond: f.bond }, [f.stock.buffer, f.bond.buffer]);
  }
};
