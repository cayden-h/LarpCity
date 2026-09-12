// A tiny builder for city layouts, so a city reads as "roads here, a bayou
// there, lots in between" instead of a hand-typed ASCII grid. It still
// produces the same layout strings the engine consumes.

import type { TileChar } from "./types";

export class LayoutBuilder {
  private readonly g: TileChar[][];
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number, base: TileChar = ".") {
    this.w = w;
    this.h = h;
    this.g =Array.from({ length: h }, () => Array.from({ length: w }, () => base));
  }

  set(x: number, y: number, c: TileChar): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c;
    return this;
  }

  get(x: number, y: number): TileChar {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.g[y][x] : " ";
  }

  rect(x: number, y: number, w: number, h: number, c: TileChar): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  /**
   * A road along row y. Water crossings up to `maxSpan` tiles become bridges;
   * wider water (a lake or open coast) is left alone and the road stops at the shore.
   */
  roadX(y: number, x0 = 0, x1 = this.w - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.road(x0, x1, (i) => [i, y], c, maxSpan);
  }

  roadY(x: number, y0 = 0, y1 = this.h - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.road(y0, y1, (i) => [x, i], c, maxSpan);
  }

  private road(from: number, to: number, at: (i: number) => [number, number], c: TileChar, maxSpan: number): this {
    const wet = (i: number) => {
      const [x, y] = at(i);
      return this.get(x, y) === "w" || this.get(x, y) === "B";
    };
    for (let i = from; i <= to; i++) {
      if (!wet(i)) {
        const [x, y] = at(i);
        this.set(x, y, c);
        continue;
      }
      let end = i;
      while (end + 1 <= to && wet(end + 1)) end++;
      const span = end - i + 1;
      // Only bridge water that has land (or the plate edge) on both sides within range.
      if (span <= maxSpan)
        for (let k = i; k <= end; k++) {
          const [x, y] = at(k);
          this.set(x, y, "B");
        }
      i = end;
    }
    return this;
  }

  /** Paint a thick line through waypoints (rivers, bayous, coastlines). */
  path(points: [number, number][], c: TileChar, width = 2): this {
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        for (let dy = 0; dy < width; dy++)
          for (let dx = 0; dx < width; dx++) this.set(Math.round(x - width / 2 + dx), Math.round(y - width / 2 + dy), c);
      }
    }
    return this;
  }

  /** Replace every `from` tile inside the rect with `to`. */
  replace(x: number, y: number, w: number, h: number, from: TileChar, to: TileChar): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.get(i, j) === from) this.set(i, j, to);
    return this;
  }

  /** Turn grass that touches a road into building lots (a street frontage). */
  frontage(depth = 2, from: TileChar = ".", to: TileChar = "b"): this {
    const isRoad = (x: number, y: number) => ["=", "t"].includes(this.get(x, y));
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.g[y][x] !== from) continue;
        for (let r = 1; r <= depth; r++)
          if (isRoad(x - r, y) || isRoad(x + r, y) || isRoad(x, y - r) || isRoad(x, y + r)) {
            marks.push([x, y]);
            break;
          }
      }
    for (const [x, y] of marks) this.set(x, y, to);
    return this;
  }

  /** Grass touching water becomes `to` (marsh or beach) where `keep` allows. */
  shore(to: TileChar, keep: (x: number, y: number) => boolean = () => true): this {
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.g[y][x] !== ".") continue;
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(x + dx, y + dy) === "w");
        if (wet && keep(x, y)) marks.push([x, y]);
      }
    for (const [x, y] of marks) this.set(x, y, to);
    return this;
  }

  /** Clip the corners so the baseplate isn't a plain rectangle. */
  clipCorners(size: number): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const cx = Math.min(x, this.w - 1 - x), cy = Math.min(y, this.h - 1 - y);
        if (cx + cy < size) this.set(x, y, " ");
      }
    return this;
  }

  build(): string[] {
    return this.g.map((row) => row.join(""));
  }
}
