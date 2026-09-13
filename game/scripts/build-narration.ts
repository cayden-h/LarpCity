// Builds the narration pack: every line the owl can say (src/narration/lines.ts),
// voiced once and saved with the game (public/narration/*.mp3 plus index.json
// with each line's word timings), so playing a line never calls ElevenLabs.
//
//   node scripts/build-narration.ts [server]    (default: the Vultr deploy)
//
// Only lines with no clip yet go to ElevenLabs (scripts/narration-plan.ts): a
// line already in the pack keeps its clip and costs nothing, so rerunning it
// after adding a line pays for that line alone. Lines the game no longer says
// lose their clips. The index is rewritten after every line voiced, so a run
// that stops partway (a 502, out of credits) keeps what it paid for.
// Lines with the player's numbers in them (the welcome back, tour lines) are
// never in the pack: the game voices those live through the same server.
// Rerun it after editing lines; tests/narration-pack.test.ts fails until the pack matches.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allLines } from "../src/narration/lines.ts";
import { planPack, type PackEntry } from "./narration-plan.ts";

const SERVER = process.argv[2] ?? "https://144-202-68-33.sslip.io";
const OUT = fileURLToPath(new URL("../public/narration/", import.meta.url));
const INDEX = OUT + "index.json";
/** The voice routes allow 20 requests a minute. */
const SPACING_MS = 3_200;

export const packFile = (line: string) => `${createHash("sha256").update(line).digest("hex").slice(0, 16)}.mp3`;

mkdirSync(OUT, { recursive: true });
const lines = allLines();
const existing = existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")) as { lines: Record<string, PackEntry> }).lines : {};
const plan = planPack(lines, existing, (file) => existsSync(OUT + file));
const voiced: Record<string, PackEntry> = { ...plan.keep };

/** The index in the game's line order, holding every line voiced so far. */
function writeIndex(): void {
  const ordered = Object.fromEntries(lines.filter((l) => voiced[l]).map((l) => [l, voiced[l]]));
  writeFileSync(INDEX, JSON.stringify({ voice: "narrator", lines: ordered }, null, 1) + "\n");
}

// Drop every clip no kept line points at: lines the game no longer says, and strays. Lines about to be voiced get fresh files.
const used = new Set(Object.values(plan.keep).map((e) => e.file));
for (const f of readdirSync(OUT)) if (f.endsWith(".mp3") && !used.has(f)) rmSync(OUT + f);
writeIndex();
console.log(`${Object.keys(plan.keep).length} lines already voiced, ${plan.voice.length} to voice, ${plan.drop.length} dropped`);

for (const [i, line] of plan.voice.entries()) {
  if (i > 0) await new Promise((done) => setTimeout(done, SPACING_MS));
  const r = await fetch(`${SERVER}/api/voice/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line, voice: "narrator" }),
  });
  if (!r.ok) throw new Error(`${r.status} for: ${line} (the ${i} lines voiced before it are saved)`);
  const spoken = (await r.json()) as { audioBase64: string; words: PackEntry["words"] };
  const file = packFile(line);
  writeFileSync(OUT + file, Buffer.from(spoken.audioBase64, "base64"));
  voiced[line] = { file, words: spoken.words };
  writeIndex();
  console.log(`${String(i + 1).padStart(2)}/${plan.voice.length}  ${file}  ${line.slice(0, 60)}`);
}

console.log(`\n${Object.keys(voiced).length} of ${new Set(lines).size} lines in public/narration/`);
