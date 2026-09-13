// A tiny builder for city layouts, so a city reads as "roads here, a bayou
// there, lots in between" instead of a hand-typed ASCII grid. It still
// produces the same layout strings the engine consumes.

import { defaultLanes, roadTiles, roadWidth, type RoadClass, type RoadDef } from "./roads/types.ts";
import type { TileChar } from "./types";

const ROADISH = new Set<TileChar>(["=", "B", "t", "O"]);

export class LayoutBuilder {
  private readonly g: TileChar[][];
  private readonly defs: RoadDef[] = [];
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
   * A local street along row y. Water crossings up to `maxSpan` tiles become
   * bridges; wider water (a lake or open coast) becomes a bridge only if
   * within range, otherwise it splits the road at the shore.
   */
  roadX(y: number, x0 = 0, x1 = this.w - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.run("local", "x", y, 1, x0, x1, c, maxSpan);
  }

  roadY(x: number, y0 = 0, y1 = this.h - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.run("local", "y", x, 1, y0, y1, c, maxSpan);
  }

  /** A four-lane arterial on rows y and y + 1. */
  arterialX(y: number, x0 = 0, x1 = this.w - 1, maxSpan = Infinity): this {
    return this.run("arterial", "x", y, 2, x0, x1, "=", maxSpan);
  }

  /** A four-lane arterial on columns x and x + 1. */
  arterialY(x: number, y0 = 0, y1 = this.h - 1, maxSpan = Infinity): this {
    return this.run("arterial", "y", x, 2, y0, y1, "=", maxSpan);
  }

  private run(cls: RoadClass, axis: "x" | "y", line: number, width: number, from: number, to: number, c: TileChar, maxSpan: number): this {
    const tile = (i: number, k: number): [number, number] => (axis === "x" ? [i, line + k] : [line + k, i]);
    const wet = (i: number) => {
      for (let k = 0; k < width; k++) {
        const t = this.get(...tile(i, k));
        if (t === "w" || t === "B") return true;
      }
      return false;
    };
    const stamp = (i: number, ch: TileChar) => {
      for (let k = 0; k < width; k++) this.set(...tile(i, k), ch);
    };
    let start = -1;
    const close = (end: number) => {
      if (start >= 0 && end > start) this.record(cls, axis, line, width, start, end, c === "t");
      start = -1;
    };
    for (let i = from; i <= to; i++) {
      if (!wet(i)) {
        stamp(i, c);
        if (start < 0) start = i;
        continue;
      }
      let end = i;
      while (end + 1 <= to && wet(end + 1)) end++;
      if (end - i + 1 <= maxSpan) {
        for (let k = i; k <= end; k++) stamp(k, "B");
        if (start < 0) start = i;
      } else close(i - 1);
      i = end;
    }
    close(to);
    return this;
  }

  private record(cls: RoadClass, axis: "x" | "y", line: number, width: number, from: number, to: number, tram: boolean): void {
    const c = line + width / 2;
    const path: [number, number][] = axis === "x" ? [[from + 0.5, c], [to + 0.5, c]] : [[c, from + 0.5], [c, to + 0.5]];
    const def: RoadDef = { id: `${cls}-${this.defs.length}`, cls, path, lanes: defaultLanes(cls) };
    if (tram) def.tram = true;
    this.defs.push(def);
  }

  /**
   * The recorded roads, trimmed to what is still road in the final layout
   * (parks, landmarks, and clipped corners painted later cut them).
   */
  roads(): RoadDef[] {
    const out: RoadDef[] = [];
    for (const d of this.defs) {
      const [[ax, ay], [bx, by]] = d.path;
      const horiz = ay === by;
      const w = roadWidth(d);
      const first = Math.round((horiz ? ay : ax) - w / 2);
      const lo = Math.floor(Math.min(horiz ? ax : ay, horiz ? bx : by));
      const hi = Math.floor(Math.max(horiz ? ax : ay, horiz ? bx : by));
      const ok = (i: number) => {
        for (let k = first; k < first + w; k++) if (!ROADISH.has(horiz ? this.get(i, k) : this.get(k, i))) return false;
        return true;
      };
      let start = -1;
      let n = 0;
      for (let i = lo; i <= hi + 1; i++) {
        if (i <= hi && ok(i)) {
          if (start < 0) start = i;
          continue;
        }
        if (start >= 0 && i - 1 > start) {
          const c = horiz ? ay : ax;
          const path: [number, number][] = horiz ? [[start + 0.5, c], [i - 0.5, c]] : [[c, start + 0.5], [c, i - 0.5]];
          out.push({ ...d, id: n === 0 ? d.id : `${d.id}.${n}`, path });
          n++;
        }
        start = -1;
      }
    }
    return out;
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

  /** The layout strings. Road tiles no recorded road covers (1-tile stubs) go back to grass or water. */
  build(): string[] {
    const covered = new Set<number>();
    for (const r of this.roads()) for (const [x, y] of roadTiles(r)) covered.add(y * this.w + x);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.g[y][x];
        if (ROADISH.has(c) && !covered.has(y * this.w + x)) this.g[y][x] = c === "B" ? "w" : ".";
      }
    return this.g.map((row) => row.join(""));
  }
}
