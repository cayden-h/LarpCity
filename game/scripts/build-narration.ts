// Builds the narration pack: every line the owl can say (src/narration/lines.ts),
// voiced once and saved with the game (public/narration/*.mp3 plus index.json
// with each line's word timings), so playing a line never calls ElevenLabs.
//
//   node scripts/build-narration.ts [server]    (default: the Vultr deploy)
//
// The server's /api/voice/tts caches every line it has voiced, so rebuilding
// costs credits only for new or changed lines. Rerun it after editing lines;
// tests/narration-pack.test.ts fails until the pack matches.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allLines } from "../src/narration/lines.ts";

const SERVER = process.argv[2] ?? "https://144-202-68-33.sslip.io";
const OUT = fileURLToPath(new URL("../public/narration/", import.meta.url));
/** The voice routes allow 20 requests a minute. */
const SPACING_MS = 3_200;

export const packFile = (line: string) => `${createHash("sha256").update(line).digest("hex").slice(0, 16)}.mp3`;

interface Spoken {
  audioBase64: string;
  words: { word: string; start: number }[];
}

mkdirSync(OUT, { recursive: true });
const lines = allLines();
const index: Record<string, { file: string; words: Spoken["words"] }> = {};
for (const [i, line] of lines.entries()) {
  if (i > 0) await new Promise((done) => setTimeout(done, SPACING_MS));
  const r = await fetch(`${SERVER}/api/voice/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line, voice: "narrator" }),
  });
  if (!r.ok) throw new Error(`${r.status} for: ${line}`);
  const spoken = (await r.json()) as Spoken;
  const file = packFile(line);
  writeFileSync(OUT + file, Buffer.from(spoken.audioBase64, "base64"));
  index[line] = { file, words: spoken.words };
  console.log(`${String(i + 1).padStart(2)}/${lines.length}  ${file}  ${line.slice(0, 60)}`);
}

// Drop clips for lines that no longer exist.
const keep = new Set(Object.values(index).map((e) => e.file));
for (const f of readdirSync(OUT)) if (f.endsWith(".mp3") && !keep.has(f)) rmSync(OUT + f);
writeFileSync(OUT + "index.json", JSON.stringify({ voice: "narrator", lines: index }, null, 1) + "\n");
console.log(`\n${lines.length} lines in public/narration/`);
