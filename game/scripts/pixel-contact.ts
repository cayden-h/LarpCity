// Contact sheet for the code-drawn pixel art: every family at 1x and 4x on a
// grass-colored ground, written to art/_contact-code.png (local only, not
// committed). Run from game/: npm run art:contact-code

import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import type { PixelCanvas } from "../src/engine/pixel/canvas.ts";
import { contactFamilies } from "../src/engine/pixel/catalog.ts";

const GROUND = [0x6f, 0x9a, 0x4a];
const GAP = 6;

function sheet(rows: PixelCanvas[][], scale: number): { w: number; h: number; px: Uint8Array } {
  const rowH = rows.map((r) => Math.max(...r.map((c) => c.h)) * scale + GAP);
  const w = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.w * scale + GAP, GAP)));
  const h = rowH.reduce((s, x) => s + x, GAP);
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) px.set(GROUND, i * 3);
  let y = GAP;
  rows.forEach((row, ri) => {
    let x = GAP;
    for (const c of row) {
      for (let cy = 0; cy < c.h * scale; cy++)
        for (let cx = 0; cx < c.w * scale; cx++) {
          const s = (Math.floor(cy / scale) * c.w + Math.floor(cx / scale)) * 4;
          const a = c.rgba[s + 3] / 255;
          if (!a) continue;
          const d = ((y + cy) * w + x + cx) * 3;
          for (let k = 0; k < 3; k++) px[d + k] = Math.round(px[d + k] * (1 - a) + c.rgba[s + k] * a);
        }
      x += c.w * scale + GAP;
    }
    y += rowH[ri];
  });
  return { w, h, px };
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const only = process.argv[2];
const families = contactFamilies().filter((f) => !only || f.name.startsWith(only));
for (const [scale, suffix] of [[1, "1x"], [4, "4x"]] as const) {
  const s = sheet(families.map((f) => f.art), scale);
  const out = `art/_contact-code-${suffix}.png`;
  writeFileSync(out, png(s.w, s.h, s.px));
  console.log(`${out}: ${s.w}x${s.h}, ${families.map((f) => `${f.name} (${f.art.length})`).join(", ")}`);
}
