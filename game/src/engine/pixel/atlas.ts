// Code-drawn pixel art packed into shared atlas pages, so thousands of trees,
// cars, and people batch into a few draw calls. Each picture is drawn once,
// the first time its key is asked for, and kept for the session.

import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import type { PixelCanvas } from "./canvas";

const PAGE = 2048;
const PAD = 2;

interface Page {
  source: BufferImageSource;
  data: Uint8ClampedArray;
  x: number;
  y: number;
  row: number;
}

const pages: Page[] = [];
const cache = new Map<string, Texture>();

function newPage(): Page {
  const data = new Uint8ClampedArray(PAGE * PAGE * 4);
  const source = new BufferImageSource({ resource: data, width: PAGE, height: PAGE, alphaMode: "no-premultiply-alpha" });
  // Crisp square pixels when zoomed in; smooth when zoomed out, like the building sprites.
  source.style.magFilter = "nearest";
  source.style.minFilter = "linear";
  const page = { source, data, x: PAD, y: PAD, row: 0 };
  pages.push(page);
  return page;
}

function place(w: number, h: number): Page {
  let page = pages[pages.length - 1] ?? newPage();
  if (page.x + w + PAD > PAGE) {
    page.x = PAD;
    page.y += page.row + PAD;
    page.row = 0;
  }
  if (page.y + h + PAD > PAGE) page = newPage();
  return page;
}

/** The texture for `key`, drawn by `make` the first time; its default anchor is the canvas origin. */
export function pixelTexture(key: string, make: () => PixelCanvas): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = make();
  if (c.w + PAD * 2 > PAGE || c.h + PAD * 2 > PAGE) throw new Error(`pixel art ${key} is too big for an atlas page`);
  const page = place(c.w, c.h);
  for (let y = 0; y < c.h; y++) page.data.set(c.rgba.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((page.y + y) * PAGE + page.x) * 4);
  const texture = new Texture({
    source: page.source,
    frame: new Rectangle(page.x, page.y, c.w, c.h),
    defaultAnchor: { x: c.ox / c.w, y: c.oy / c.h },
    label: key,
  });
  page.x += c.w + PAD;
  page.row = Math.max(page.row, c.h);
  page.source.update();
  cache.set(key, texture);
  return texture;
}
