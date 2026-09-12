import { Rectangle } from "pixi.js";

// Isometric projection. Tile (x, y) is a 2:1 diamond; z lifts things up in
// screen pixels. x grows toward the bottom-right, y toward the bottom-left.

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** One brick layer (plate height) in screen pixels. */
export const BRICK_H = 10;

export interface Pt {
  x: number;
  y: number;
}

export function iso(x: number, y: number, z = 0): Pt {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H - z };
}

/** Painter's-order depth for something standing on tile (x, y). */
export function depthOf(x: number, y: number, bias = 0): number {
  return (x + y) * 100 + bias;
}

/** The four screen corners of a tile's top face: top, right, bottom, left. */
export function tileCorners(x: number, y: number, z = 0): [Pt, Pt, Pt, Pt] {
  return [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)];
}

/** Screen corners of a w x d footprint starting at tile (x, y). */
export function footprintCorners(x: number, y: number, w: number, d: number, z = 0): [Pt, Pt, Pt, Pt] {
  return [iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)];
}

export const flat = (pts: Pt[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/**
 * Screen-space bounds of something standing on a w x d footprint and rising
 * `height` pixels, padded a little. Used as a cheap cullArea so the renderer
 * can skip off-screen objects without measuring them every frame.
 */
export function footprintRect(x: number, y: number, w: number, d: number, height: number, pad = 12): Rectangle {
  const left = iso(x, y + d).x, right = iso(x + w, y).x, top = iso(x, y).y - height, bottom = iso(x + w, y + d).y;
  return new Rectangle(left - pad, top - pad, right - left + pad * 2, bottom - top + pad * 2);
}

/** Unit direction vectors in tile space, in the order N, E, S, W. */
export const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;
