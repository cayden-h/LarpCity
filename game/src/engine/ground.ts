// The ground: studded grass, recessed water, curbed roads, bridges, farmland,
// forest floor, and mountain rock. The map is large, so it is drawn in
// 16 x 16-tile chunks that the renderer culls when they are off-screen, and
// it is redrawn only when the season, snow, or drought changes a lot.

import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { pixelTexture } from "./pixel/atlas";
import { glintArt, type Terrain } from "./pixel/ground-art";
import { groundPattern } from "./pixel/patterns";
import type { Season } from "./clock";
import { mix, shade } from "./color";
import type { CityGrid } from "./grid";
import { iso, flat, tileCorners, type Pt } from "./iso";
import { rngFor } from "./rng";
import type { RoadNet } from "./roads/graph";
import { roadMarks, type Mark } from "./roads/marks";
import { DECK_Z } from "./roads/pose.ts";
import type { CityPalette } from "./types";

export const WATER_Z = -6;
export const BRIDGE_Z = DECK_Z;
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
  private readonly glints = new Container();
  private readonly glintSprites: { s: Sprite; phase: number }[] = [];
  private glintFrames: Texture[] = [];
  /** Each chunk's two foam frames, shown alternately. */
  private foam: [Graphics, Graphics][] = [];
  private lastStep = -1;
  private readonly marksByChunk = new Map<string, Mark[]>();
  private look: GroundLook | null = null;
  private readonly grid: CityGrid;
  private readonly palette: CityPalette;

  constructor(grid: CityGrid, palette: CityPalette, seed: number, net: RoadNet | null = null) {
    this.grid = grid;
    this.palette = palette;
    this.waterLayer.addChild(this.waterChunks, this.glints);
    this.landLayer.addChild(this.landChunks);
    this.buildGlints(seed);
    if (net)
      for (const m of roadMarks(net, (x, y) => grid.at(x, y) === "B")) {
        const p = m.pts[0];
        const key = `${Math.floor(p.x / CHUNK) * CHUNK},${Math.floor(p.y / CHUNK) * CHUNK}`;
        const list = this.marksByChunk.get(key) ?? [];
        list.push(m);
        this.marksByChunk.set(key, list);
      }
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

  /** Water animation in whole steps (never fades): glints at 4 frames a second, foam at 2. */
  update(time: number, stormy: number): void {
    const step = Math.floor(time * 4);
    if (step === this.lastStep || !this.glintFrames.length) return;
    this.lastStep = step;
    // Calm water rests between glints; stormy water glints all the time.
    const cycle = stormy > 0.5 ? 3 : 6;
    for (const g of this.glintSprites) {
      const f = (step + g.phase) % cycle;
      g.s.visible = f < 3;
      if (f < 3) g.s.texture = this.glintFrames[f];
    }
    const odd = Math.floor(step / 2) % 2 === 1;
    for (const [a, b] of this.foam) {
      a.visible = !odd;
      b.visible = odd;
    }
  }

  private waterColor(): number {
    return mix(this.palette.water, 0xdfe9f0, this.look!.snow * 0.25);
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
    this.foam = [];
    const water = this.waterColor();
    this.glintFrames = [0, 1, 2].map((f) => pixelTexture(`glint:${f}:${water.toString(16)}`, () => glintArt(f, water)));
    this.lastStep = -1;
    const g = this.grid;
    for (let cy = 0; cy < g.h; cy += CHUNK)
      for (let cx = 0; cx < g.w; cx += CHUNK) this.drawChunk(cx, cy, Math.min(g.w, cx + CHUNK), Math.min(g.h, cy + CHUNK));
  }

  private drawChunk(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.grid;
    const look = this.look!;
    const water = new Graphics();
    const foamA = new Graphics();
    const foamB = new Graphics();
    const landFoamA = new Graphics();
    const landFoamB = new Graphics();
    const edges = new Graphics();
    const tops = new Graphics();
    const marks = new Graphics();
    const bridges = new Graphics();
    const raisedMarks = new Graphics();
    const grass = this.grassColor();
    const snow = look.snow;
    const waterColor = this.waterColor();
    const shallow = mix(waterColor, 0x9fd8e8, 0.3);
    const foam = mix(waterColor, 0xffffff, 0.78);
    const land = (x: number, y: number) => g.isInside(x, y) && g.at(x, y) !== " " && !g.isWater(x, y);
    const pattern = (kind: Terrain, color: number) => ({ texture: groundPattern(kind, color), textureSpace: "global" as const });
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
        if (!g.isInside(x, y + 1)) face(edges, iso(x, y + 1, top), iso(x + 1, y + 1, top), PLATE_T + top, side, 1);
        if (!g.isInside(x + 1, y)) face(edges, iso(x + 1, y + 1, top), iso(x + 1, y, top), PLATE_T + top, shade(side, 0.8), 1);
      }

    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const c = g.at(x, y);
        if (c === " ") continue;
        // The four sides of a tile, each with the neighbor across it.
        const sides = (z: number): [boolean, Pt, Pt][] => {
          const [T, R, B, L] = tileCorners(x, y, z);
          return [[land(x, y - 1), T, R], [land(x + 1, y), R, B], [land(x, y + 1), B, L], [land(x - 1, y), L, T]];
        };
        if (g.isWater(x, y)) {
          const around = sides(WATER_Z);
          const shore = around.some(([l]) => l);
          water.poly(flat(tileCorners(x, y, WATER_Z))).fill(pattern(shore ? "shallow" : "deep", shore ? shallow : waterColor));
          // Foam at the waterline: a thin constant line, plus dashes that alternate between two frames.
          const mid = iso(x + 0.5, y + 0.5, WATER_Z);
          // Only the back sides: land in front stands higher and hides the water there, so its foam
          // is drawn on the land's own back edge instead (below).
          for (const [isLand, a, b] of [around[0], around[3]]) {
            if (!isLand) continue;
            band(water, a, b, mid, 0, 1, 0.07, foam);
            for (let i = 0; i < 4; i++) band(i % 2 ? foamB : foamA, a, b, mid, i / 4, (i + 1) / 4, 0.13, foam);
          }
          continue;
        }
        const corners = tileCorners(x, y, 0);
        const kind: Terrain =
          c === "=" || c === "t" || c === "O" ? "asphalt" : c === "s" ? "sand" : c === "P" ? "plaza" : c === "b" || c === "h" ? "lot" : c === "~" ? "marsh" : c === "f" ? "soil" : c === "F" ? "forest" : c === "m" ? "rock" : "grass";
        const fill =
          c === "=" || c === "t" || c === "O"
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
        tops.poly(flat(corners)).fill(pattern(kind, fill));
        // Wet sand where a beach meets the water, and surf on the land's back edges.
        const mid = iso(x + 0.5, y + 0.5);
        const across = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
        sides(0).forEach(([, a, b], i) => {
          const [nx, ny] = across[i];
          if (!g.isWater(nx, ny) || g.at(nx, ny) === "B") return;
          if (c === "s") band(tops, a, b, mid, 0, 1, 0.16, mix(fill, waterColor, 0.28));
          if (i !== 0 && i !== 3) return;
          band(landFoamA, a, b, mid, 0, 1, 0.05, foam);
          band(landFoamB, a, b, mid, 0, 1, 0.05, foam);
          for (let k = 0; k < 4; k++) band(k % 2 ? landFoamB : landFoamA, a, b, mid, k / 4, (k + 1) / 4, 0.1, foam);
        });
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
        if (c === "=" || c === "t" || c === "O") this.drawRoad(marks, x, y, c === "t");
      }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.at(x, y) === "B") this.drawBridge(bridges, x, y);

    const markColor = (c: Mark["color"]) => mix(c === "yellow" ? 0xf3d23b : 0xf2f2f2, 0xffffff, snow * 0.6);
    for (const m of this.marksByChunk.get(`${x0},${y0}`) ?? []) {
      const target = m.raised ? raisedMarks : marks;
      const pts = m.pts.map((p) => iso(p.x, p.y, m.raised ? BRIDGE_Z : 0));
      if (m.kind === "quad") target.poly(flat(pts)).fill({ color: markColor(m.color), alpha: 0.88 });
      else {
        target.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) target.lineTo(p.x, p.y);
        target.stroke({ width: m.width, color: markColor(m.color), alpha: 0.9 });
      }
    }

    const area = chunkRect(x0, y0, x1, y1);
    const w = new Container();
    w.addChild(water, foamA, foamB, edges);
    foamB.visible = landFoamB.visible = false;
    this.foam.push([foamA, foamB], [landFoamA, landFoamB]);
    const l = new Container();
    l.addChild(tops, landFoamA, landFoamB, marks, bridges, raisedMarks);
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
    if (!tram) return;
    const rails = (a: Pt, b: Pt, off: Pt) => {
      for (const k of [-1, 1]) marks.moveTo(a.x + off.x * k, a.y + off.y * k).lineTo(b.x + off.x * k, b.y + off.y * k);
      marks.stroke({ width: 1.5, color: 0x9aa3ad });
    };
    if (n || s) rails(iso(x + 0.5, y), iso(x + 0.5, y + 1), { x: 7, y: -3.5 });
    if (e || w) rails(iso(x, y + 0.5), iso(x + 1, y + 0.5), { x: 7, y: 3.5 });
  }

  private drawBridge(gfx: Graphics, x: number, y: number): void {
    const g = this.grid;
    const run = (dx: number, dy: number) => {
      let k = 1;
      while (g.at(x + dx * k, y + dy * k) === "B" || g.isRoad(x + dx * k, y + dy * k)) k++;
      let j = 1;
      while (g.at(x - dx * j, y - dy * j) === "B" || g.isRoad(x - dx * j, y - dy * j)) j++;
      return k + j;
    };
    const alongX = run(1, 0) >= run(0, 1);
    const deck = 0x5b616b;
    const [T, R, B, L] = tileCorners(x, y, BRIDGE_Z);
    const mid = iso(x + 0.5, y + 0.5, BRIDGE_Z);
    gfx.rect(mid.x - 5, mid.y, 10, BRIDGE_Z - WATER_Z + 6).fill(0xb9b3a8);
    gfx.rect(mid.x - 5, mid.y, 4, BRIDGE_Z - WATER_Z + 6).fill(0xd4cec2);
    face(gfx, L, B, 6, shade(deck, 0.8), 1);
    face(gfx, B, R, 6, shade(deck, 0.62), 1);
    gfx.poly(flat([T, R, B, L])).fill(deck);
    // Railings on the long edges that have no more bridge beside them.
    const edges: [Pt, Pt, number, number][] = alongX ? [[T, R, x, y - 1], [L, B, x, y + 1]] : [[T, L, x - 1, y], [R, B, x + 1, y]];
    for (const [p, q, nx, ny] of edges) {
      if (g.at(nx, ny) === "B") continue;
      gfx.moveTo(p.x, p.y - 5).lineTo(q.x, q.y - 5).stroke({ width: 2, color: 0xe24b3b });
      for (let i = 0; i <= 3; i++) {
        const m = lerp(p, q, i / 3);
        gfx.moveTo(m.x, m.y).lineTo(m.x, m.y - 5).stroke({ width: 1.5, color: 0xb83a2e });
      }
    }
  }

  /** Pixel glints scattered over open water, each stepping through its frames at its own phase. */
  private buildGlints(seed: number): void {
    const rng = rngFor(seed, "shimmer");
    for (const { x, y } of this.grid.cells()) {
      if (!this.grid.isWater(x, y) || this.grid.at(x, y) === "B") continue;
      if (rng() > 0.28) continue;
      const p = iso(x + 0.2 + rng() * 0.6, y + 0.2 + rng() * 0.6, WATER_Z);
      const s = new Sprite();
      s.position.set(Math.round(p.x), Math.round(p.y));
      s.cullable = true;
      s.visible = false;
      this.glints.addChild(s);
      this.glintSprites.push({ s, phase: Math.floor(rng() * 6) });
    }
  }
}

/** A strip along the part [t0, t1] of edge a-b, reaching `depth` of the way toward `mid`. */
function band(g: Graphics, a: Pt, b: Pt, mid: Pt, t0: number, t1: number, depth: number, color: number): void {
  const p = lerp(a, b, t0), q = lerp(a, b, t1);
  g.poly(flat([p, q, lerp(q, mid, depth * 2), lerp(p, mid, depth * 2)])).fill(color);
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

