// The city's tile grid, parsed from the layout strings in a CityDef.

import type { TileChar } from "./types";

const ROADLIKE = new Set<TileChar>(["=", "B", "t", "O"]);
const LAND = new Set<TileChar>([".", "=", "s", "~", "b", "p", "P", "h", "t", "O", "f", "F", "m"]);

export class CityGrid {
  readonly w: number;
  readonly h: number;
  private readonly tiles: TileChar[][];

  constructor(layout: string[]) {
    this.h = layout.length;
    this.w = Math.max(...layout.map((row) => row.length));
    this.tiles = layout.map((row) => row.padEnd(this.w, " ").split("") as TileChar[]);
  }

  at(x: number, y: number): TileChar {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return " ";
    return this.tiles[y][x];
  }

  set(x: number, y: number, c: TileChar): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.tiles[y][x] = c;
  }

  isInside(x: number, y: number): boolean {
    return this.at(x, y) !== " ";
  }

  isRoad(x: number, y: number): boolean {
    return ROADLIKE.has(this.at(x, y));
  }

  isWater(x: number, y: number): boolean {
    const c = this.at(x, y);
    return c === "w" || c === "B";
  }

  isLand(x: number, y: number): boolean {
    return LAND.has(this.at(x, y));
  }

  /** Road connections as [N, E, S, W] booleans. */
  roadLinks(x: number, y: number): [boolean, boolean, boolean, boolean] {
    return [this.isRoad(x, y - 1), this.isRoad(x + 1, y), this.isRoad(x, y + 1), this.isRoad(x - 1, y)];
  }

  *cells(): Generator<{ x: number; y: number; c: TileChar }> {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) yield { x, y, c: this.tiles[y][x] };
  }

  count(c: TileChar): number {
    let n = 0;
    for (const cell of this.cells()) if (cell.c === c) n++;
    return n;
  }
}
