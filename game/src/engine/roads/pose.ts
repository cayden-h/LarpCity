// Small helpers for drawing sim cars: which of 8 facings a heading is, how
// to blend two poses, and how high the road is under a point.

import type { Pose } from "./geometry.ts";

/** Deck height of bridges and overpasses, in screen pixels (matches ground.ts). */
export const DECK_Z = 7;

/** The nearest of 8 facings: 0 = +x, 2 = +y, 4 = -x, 6 = -y (tile space). */
export function facingOf(h: number): number {
  return ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  let dh = b.h - a.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + dh * t };
}

/** Height of the road surface at a point: decks over water, and overpasses for the road on top. */
export function elevation(grid: { at(x: number, y: number): string }, x: number, y: number, underpass: boolean): number {
  const c = grid.at(Math.floor(x), Math.floor(y));
  if (c === "B") return DECK_Z;
  if (c === "O" && !underpass) return DECK_Z;
  return 0;
}
