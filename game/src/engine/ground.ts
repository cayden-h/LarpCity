// The ground: studded grass, recessed water, curbed roads, bridges, farmland,
// forest floor, and mountain rock. The map is large, so it is drawn in
// 16 x 16-tile chunks that the renderer culls when they are off-screen, and
// it is redrawn only when the season, snow, or drought changes a lot.

import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { Season } from "./clock";
import { mix, shade } from "./color";
import type { CityGrid } from "./grid";
import { iso, flat, tileCorners, type Pt } from "./iso";
import { rngFor } from "./rng";
import type { CityPalette } from "./types";

export const WATER_Z = -6;
export const BRIDGE_Z = 7;
const PLATE_T = 18;
const CHUNK = 16;

const ASPHALT = 0x454b55;
const CURB = 0xc9ccd2;
const PLAZA = 0xd9d4c7;
const LOT = 0xbfc3c9;
const PLATE_SIDE = 0x3f8a3a;
const ROCK = 0x8c7f6e;

export interface GroundLook {
  season: Season;
  snow: number; // 0..1 snow cover
  drought: number; // 0..1 browning
}

const SEASON_GRASS: Record<Season, number> = {
  spring: 0x6cc24a,
  summer: 0x5db43f,
  fall: 0x9fb442,
  winter: 0x86a867,
};

const SOIL: Record<Season, number> = { spring: 0x8b6b45, summer: 0x7a5c3a, fall: 0x9a7a4a, winter: 0x8a7a66 };
const CROP: Record<Season, number | null> = { spring: 0x9ccc65, summer: 0x4f8f2f, fall: 0xe0b040, winter: null };

export class Ground {
  readonly waterLayer = new Container();
  readonly landLayer = new Container();
  private readonly waterChunks = new Container();
  private readonly landChunks = new Container();
  private readonly shimmer = new Container();
  private readonly shimmerSprites: { s: Sprite; phase: number; speed: number }[] = [];
  private look: GroundLook | null = null;
  private readonly grid: CityGrid;
  private readonly palette: CityPalette;

  constructor(grid: CityGrid, palette: CityPalette, seed: number) {
    this.grid = grid;
    this.palette = palette;
    this.waterLayer.addChild(this.waterChunks, this.shimmer);
    this.landLayer.addChild(this.landChunks);
    this.buildShimmer(seed);
  }

  setLook(look: GroundLook): void {
    const prev = this.look;
    const changed =
      !prev ||
      prev.season !== look.season ||
      Math.abs(prev.snow - look.snow) > 0.24 ||
      Math.abs(prev.drought - look.drought) > 0.24;
    if (!changed) return;
    this.look = { ...look };
    this.redraw();
  }

  update(time: number, stormy: number): void {
    for (const item of this.shimmerSprites) {
      const a = 0.5 + 0.5 * Math.sin(time * item.speed + item.phase);
      item.s.alpha = a * (0.55 + stormy * 0.35);
      item.s.scale.x = 0.6 + a * 0.6 + stormy * 0.6;
    }
  }

  private grassColor(): number {
    const look = this.look!;
    let c = mix(SEASON_GRASS[look.season], this.palette.grass, 0.5);
    c = mix(c, 0xc4b27a, look.drought * 0.7);
    return mix(c, 0xf4f7fb, look.snow * 0.85);
  }

  private redraw(): void {
    for (const c of [...this.waterChunks.children, ...this.landChunks.children]) c.destroy({ children: true });
    this.waterChunks.removeChildren();
    this.landChunks.removeChildren();
    const g = this.grid;
    for (let cy = 0; cy < g.h; cy += CHUNK)
      for (let cx = 0; cx < g.w; cx += CHUNK) this.drawChunk(cx, cy, Math.min(g.w, cx + CHUNK), Math.min(g.h, cy + CHUNK));
  }

  private drawChunk(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.grid;
    const look = this.look!;
    const water = new Graphics();
    const edges = new Graphics();
    const tops = new Graphics();
    const marks = new Graphics();
    const bridges = new Graphics();
    const grass = this.grassColor();
    const snow = look.snow;
    const waterColor = mix(this.palette.water, 0xdfe9f0, snow * 0.25);
    const forest = mix(grass, 0x2f5d2a, 0.35);
    const rock = mix(ROCK, 0xf4f7fb, Math.min(1, snow * 1.1));
    const soil = mix(SOIL[look.season], 0xf4f7fb, snow * 0.8);
    const crop = CROP[look.season];

    // Plate edges at the world boundary (and banks), drawn first so tops overlap them.
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const c = g.at(x, y);
        if (c === " ") continue;
        const isW = g.isWater(x, y);
        const top = isW ? WATER_Z : 0;
        const side = isW ? shade(waterColor, 0.75) : PLATE_SIDE;
        if (!g.isInside(x, y + 1)) face(edges, iso(x, y + 1, top), iso(x + 1, y + 1, top), PLATE_T + top, side, 0.92);
        if (!g.isInside(x + 1, y)) face(edges, iso(x + 1, y + 1, top), iso(x + 1, y, top), PLATE_T + top, shade(side, 0.8), 0.92);
      }

    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const c = g.at(x, y);
        if (c === " ") continue;
        if (g.isWater(x, y)) {
          water.poly(flat(tileCorners(x, y, WATER_Z))).fill(waterColor);
          continue;
        }
        const corners = tileCorners(x, y, 0);
        const fill =
          c === "=" || c === "t"
            ? mix(ASPHALT, 0xeef2f6, snow * 0.35)
            : c === "s"
              ? mix(this.palette.sand, 0xffffff, snow * 0.6)
              : c === "P"
                ? PLAZA
                : c === "b" || c === "h"
                  ? mix(LOT, grass, 0.15)
                  : c === "~"
                    ? mix(grass, 0x6f8f55, 0.45)
                    : c === "f"
                      ? soil
                      : c === "F"
                        ? forest
                        : c === "m"
                          ? rock
                          : grass;
        tops.poly(flat(corners)).fill(fill);
        // Banks where land meets water.
        if (g.isWater(x, y + 1)) face(edges, iso(x, y + 1, 0), iso(x + 1, y + 1, 0), -WATER_Z, shade(fill, 0.72), 1);
        if (g.isWater(x + 1, y)) face(edges, iso(x + 1, y + 1, 0), iso(x + 1, y, 0), -WATER_Z, shade(fill, 0.6), 1);

        if (c === "f" && crop !== null) {
          // Crop rows along the field.
          for (const k of [0.25, 0.5, 0.75]) {
            const a = iso(x + 0.1, y + k), b = iso(x + 0.9, y + k);
            marks.moveTo(a.x, a.y).lineTo(b.x, b.y);
          }
          marks.stroke({ width: 3, color: mix(crop, 0xffffff, snow * 0.7), cap: "round" });
        }
        if (c === "=" || c === "t") this.drawRoad(marks, x, y, c === "t");
      }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.at(x, y) === "B") this.drawBridge(bridges, x, y);

    const area = chunkRect(x0, y0, x1, y1);
    const w = new Container();
    w.addChild(water, edges);
    const l = new Container();
    l.addChild(tops, marks, bridges);
    for (const c of [w, l]) {
      c.cullable = true;
      c.cullArea = area;
    }
    this.waterChunks.addChild(w);
    this.landChunks.addChild(l);
  }

  private drawRoad(marks: Graphics, x: number, y: number, tram: boolean): void {
    const g = this.grid;
    const [n, e, s, w] = g.roadLinks(x, y);
    const links = [n, e, s, w].filter(Boolean).length;
    const snow = this.look!.snow;
    const dash = mix(0xf3d23b, 0xffffff, snow * 0.6);

    // Curbs on sides that touch non-road land.
    const curb = (from: Pt, to: Pt, inward: Pt) => {
      const k = 0.14;
      marks
        .poly(flat([from, to, { x: to.x + inward.x * k, y: to.y + inward.y * k }, { x: from.x + inward.x * k, y: from.y + inward.y * k }]))
        .fill(CURB);
    };
    const T = iso(x, y), R = iso(x + 1, y), B = iso(x + 1, y + 1), L = iso(x, y + 1);
    const v = (a: Pt, b: Pt) => ({ x: b.x - a.x, y: b.y - a.y });
    if (!n && !g.isWater(x, y - 1)) curb(T, R, v(T, L));
    if (!e && !g.isWater(x + 1, y)) curb(R, B, v(R, T));
    if (!s && !g.isWater(x, y + 1)) curb(L, B, v(L, T));
    if (!w && !g.isWater(x - 1, y)) curb(T, L, v(T, R));

    if (links >= 3) {
      // Intersection: zebra crossings on each connected side.
      const zebra = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => {
        for (let i = 0; i < 4; i++) {
          const t0 = 0.18 + i * 0.18, t1 = t0 + 0.09;
          const a = lerp(p0, p1, t0), b = lerp(p0, p1, t1), c = lerp(p3, p2, t1), d = lerp(p3, p2, t0);
          marks.poly(flat([a, b, c, d])).fill({ color: 0xf2f2f2, alpha: 0.85 });
        }
      };
      const inset = 0.16;
      if (n) zebra(iso(x, y), iso(x + 1, y), iso(x + 1, y + inset), iso(x, y + inset));
      if (s) zebra(iso(x, y + 1 - inset), iso(x + 1, y + 1 - inset), iso(x + 1, y + 1), iso(x, y + 1));
      if (w) zebra(iso(x, y), iso(x, y + 1), iso(x + inset, y + 1), iso(x + inset, y));
      if (e) zebra(iso(x + 1 - inset, y), iso(x + 1 - inset, y + 1), iso(x + 1, y + 1), iso(x + 1, y));
      return;
    }
    // Straight or corner: dashed center line along each connected axis.
    const along = (a: Pt, b: Pt) => {
      for (const [t0, t1] of [[0.08, 0.36], [0.6, 0.88]]) {
        const p = lerp(a, b, t0), q = lerp(a, b, t1);
        marks.moveTo(p.x, p.y).lineTo(q.x, q.y);
      }
      marks.stroke({ width: 2, color: dash, alpha: 0.9 });
    };
    const c = iso(x + 0.5, y + 0.5);
    if (n) along(iso(x + 0.5, y), c);
    if (s) along(c, iso(x + 0.5, y + 1));
    if (w) along(iso(x, y + 0.5), c);
    if (e) along(c, iso(x + 1, y + 0.5));
    if (tram) {
      const rails = (a: Pt, b: Pt, off: Pt) => {
        for (const k of [-1, 1]) marks.moveTo(a.x + off.x * k, a.y + off.y * k).lineTo(b.x + off.x * k, b.y + off.y * k);
        marks.stroke({ width: 1.5, color: 0x9aa3ad });
      };
      if (n || s) rails(iso(x + 0.5, y), iso(x + 0.5, y + 1), { x: 7, y: -3.5 });
      if (e || w) rails(iso(x, y + 0.5), iso(x + 1, y + 0.5), { x: 7, y: 3.5 });
    }
  }

  private drawBridge(gfx: Graphics, x: number, y: number): void {
    const g = this.grid;
    const alongX = g.isRoad(x - 1, y) || g.isRoad(x + 1, y);
    const deck = 0x5b616b;
    const [T, R, B, L] = tileCorners(x, y, BRIDGE_Z);
    // Pillar under the deck.
    const mid = iso(x + 0.5, y + 0.5, BRIDGE_Z);
    gfx.rect(mid.x - 5, mid.y, 10, BRIDGE_Z - WATER_Z + 6).fill(0xb9b3a8);
    gfx.rect(mid.x - 5, mid.y, 4, BRIDGE_Z - WATER_Z + 6).fill(0xd4cec2);
    // Deck sides.
    face(gfx, L, B, 6, shade(deck, 0.8), 1);
    face(gfx, B, R, 6, shade(deck, 0.62), 1);
    gfx.poly(flat([T, R, B, L])).fill(deck);
    // Railings on both long edges, with posts.
    const [a0, a1, b0, b1] = alongX ? [T, R, L, B] : [T, L, R, B];
    for (const [p, q] of [[a0, a1], [b0, b1]] as const) {
      gfx.moveTo(p.x, p.y - 5).lineTo(q.x, q.y - 5).stroke({ width: 2, color: 0xe24b3b });
      for (let i = 0; i <= 3; i++) {
        const m = lerp(p, q, i / 3);
        gfx.moveTo(m.x, m.y).lineTo(m.x, m.y - 5).stroke({ width: 1.5, color: 0xb83a2e });
      }
    }
    const c0 = alongX ? iso(x, y + 0.5, BRIDGE_Z) : iso(x + 0.5, y, BRIDGE_Z);
    const c1 = alongX ? iso(x + 1, y + 0.5, BRIDGE_Z) : iso(x + 0.5, y + 1, BRIDGE_Z);
    gfx.moveTo(lerp(c0, c1, 0.15).x, lerp(c0, c1, 0.15).y).lineTo(lerp(c0, c1, 0.45).x, lerp(c0, c1, 0.45).y);
    gfx.moveTo(lerp(c0, c1, 0.6).x, lerp(c0, c1, 0.6).y).lineTo(lerp(c0, c1, 0.9).x, lerp(c0, c1, 0.9).y);
    gfx.stroke({ width: 2, color: 0xf3d23b });
  }

  private buildShimmer(seed: number): void {
    const rng = rngFor(seed, "shimmer");
    for (const { x, y } of this.grid.cells()) {
      if (!this.grid.isWater(x, y) || this.grid.at(x, y) === "B") continue;
      if (rng() > 0.28) continue;
      const p = iso(x + 0.2 + rng() * 0.6, y + 0.2 + rng() * 0.6, WATER_Z);
      const s = new Sprite(Texture.WHITE);
      s.width = 12;
      s.height = 2;
      s.anchor.set(0.5);
      s.position.set(p.x, p.y);
      s.tint = 0xe8f6ff;
      s.skew.set(0, 0.46);
      s.cullable = true;
      this.shimmer.addChild(s);
      this.shimmerSprites.push({ s, phase: rng() * Math.PI * 2, speed: 0.8 + rng() * 1.6 });
    }
  }
}

/** Screen-space bounds of a block of tiles, padded for bridges, banks, and edges. */
function chunkRect(x0: number, y0: number, x1: number, y1: number): Rectangle {
  const left = iso(x0, y1).x, right = iso(x1, y0).x, top = iso(x0, y0).y, bottom = iso(x1, y1).y;
  return new Rectangle(left - 8, top - 30, right - left + 16, bottom - top + 60);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A vertical face hanging down `depth` pixels from the edge a-b. */
export function face(g: Graphics, a: Pt, b: Pt, depth: number, color: number, alpha = 1): void {
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y + depth, a.x, a.y + depth]).fill({ color, alpha });
}

