// Roads for the generated world around a city's core: a perimeter road
// hugging the core, the core's streets continued outward, a suburban grid of
// collectors and arterials with local streets and cul-de-sacs in its blocks,
// a frontage road at the suburbs' edge, an optional highway ring with diamond
// interchanges and one radial highway, and country roads beyond.
//
// outskirtRoads runs the steps in order over a shared context; worldRoads
// then fits the result to the land (bridges, splits at open water), ends every
// highway at an interchange or another highway, and drops whatever the
// splits left unconnected.

import { cellHash } from "../noise.ts";
import type { TileChar } from "../types";
import { defaultLanes, roadTiles, roadWidth, type RoadClass, type RoadDef } from "./types.ts";

export interface Frame {
  N: number;
  /** The core's top-left tile and size in world tiles. */
  Mx: number;
  My: number;
  cw: number;
  ch: number;
  /** Suburb ring width and street spacing. */
  S: number;
  G: number;
  /** Whether the world gets a highway ring (the caller has checked that it fits). */
  ring: boolean;
  seed: number;
  inside: (X: number, Y: number) => boolean;
  /** The world tile before roads are stamped (terrain and the core). */
  tile: (X: number, Y: number) => TileChar;
  /** Open ground inside the core a street may be continued across (no water, homes, parks, or landmarks). */
  free: (X: number, Y: number) => boolean;
}

/** Which way a road runs: along x (it sits in rows) or along y (in columns). */
type Axis = "x" | "y";
type Side = "n" | "s" | "e" | "w";

interface Line {
  axis: Axis;
  /** First row (axis x) or column (axis y) it covers. */
  at: number;
  width: number;
}

/** An arterial line that crosses the ring. Lower ranks claim interchanges first. */
interface Crosser extends Line {
  /** 0: a core arterial, 1: a core street continued as an arterial, 2: a suburban arterial. */
  rank: number;
}

/** The ring's centerlines, on tile edges. */
interface Ring {
  yn: number;
  ys: number;
  xw: number;
  xe: number;
}

/** One side of the ring: its centerline c, the axis it runs along, and its ends. */
interface RingSide {
  side: Side;
  axis: Axis;
  c: number;
  s0: number;
  s1: number;
}

interface Interchange {
  side: RingSide;
  /** Where the arterial crosses, along the side, and the arterial's width. */
  A: number;
  w: number;
  /** Ramp length: the merge nodes sit at A - L and A + L. */
  L: number;
}

interface Ctx {
  f: Frame;
  out: RoadDef[];
  serial: number;
  /** The frontage road's distance from the core. */
  F: number;
  cx0: number;
  cx1: number;
  cy0: number;
  cy1: number;
  /** Lines taken by roads parallel to the core's sides, so new lines keep their distance. */
  reserved: Line[];
  crossers: Crosser[];
}

const onLine = (v: number, step: number) => (((v - 2) % step) + step) % step === 0;

/** A normal interchange's ramps run 5 tiles; a close neighbor shortens them to 4. */
const RAMP_LONG = 5;
const RAMP_SHORT = 4;
/** Merge nodes of neighboring interchanges stay this far apart, or the highway between them is too short to survive both merges' trims. */
const MERGE_GAP = 3.5;
/** How far apart (center to center) the radial highway stays from arterials crossing its side of the ring. */
const RADIAL_CLEARANCE = [8, 6];

export function coreDist(f: Pick<Frame, "Mx" | "My" | "cw" | "ch">, X: number, Y: number): number {
  return Math.max(f.Mx - X, X - (f.Mx + f.cw - 1), f.My - Y, Y - (f.My + f.ch - 1), 0);
}

/** Whether the highway ring fits inside the world when the suburbs are S tiles wide. */
export function ringFits(f: Pick<Frame, "Mx" | "My" | "cw" | "ch" | "inside">, S: number): boolean {
  const d = S + 3, x0 = f.Mx - d, x1 = f.Mx + f.cw - 1 + d, y0 = f.My - d, y1 = f.My + f.ch - 1 + d;
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) => f.inside(x, y));
}

/** Every generated road, fitted to the land and connected to the core's streets. */
export function worldRoads(f: Frame, core: RoadDef[]): RoadDef[] {
  return connectedRoads(core, endHighways(fitRoads(outskirtRoads(f, core), f)));
}

export function outskirtRoads(f: Frame, core: RoadDef[]): RoadDef[] {
  const c: Ctx = {
    f, out: [], serial: 0,
    // The frontage road sits one tile inside the suburbs' edge, so a street
    // between it and the inner ramps (at S + 1) is long enough to keep its junctions.
    F: f.S - 1,
    cx0: f.Mx, cx1: f.Mx + f.cw - 1, cy0: f.My, cy1: f.My + f.ch - 1,
    reserved: [], crossers: [],
  };
  perimeter(c);
  extensions(c, core);
  grid(c);
  blocks(c, core);
  const R = ring(c);
  if (R) {
    const chosen = interchanges(c, R);
    radial(c, R, chosen);
    for (const ic of chosen) ramps(c, ic);
  }
  country(c, R !== null);
  return c.out;
}

// Helpers over the context.

const tileOf = (axis: Axis, a: number, i: number): [number, number] => (axis === "x" ? [i, a] : [a, i]);
/** The core's rows (axis x) or columns (axis y): the range a line of that axis may cross the core in. */
const across = (c: Ctx, axis: Axis): [number, number] => (axis === "x" ? [c.cy0, c.cy1] : [c.cx0, c.cx1]);
/** The core's extent along a line of that axis. */
const along = (c: Ctx, axis: Axis): [number, number] => (axis === "x" ? [c.cx0, c.cx1] : [c.cy0, c.cy1]);
const rel = (c: Ctx, axis: Axis, at: number) => at - (axis === "x" ? c.f.My : c.f.Mx);

function insideAll(c: Ctx, axis: Axis, at: number, w: number, i: number): boolean {
  for (let k = 0; k < w; k++) if (!c.f.inside(...tileOf(axis, at + k, i))) return false;
  return true;
}

/** From `start`, step by `dir` while still inside the world; the last inside index. */
function reach(c: Ctx, axis: Axis, at: number, w: number, start: number, dir: number): number {
  let i = start;
  while (insideAll(c, axis, at, w, i + dir)) i += dir;
  return i;
}

function add(c: Ctx, cls: RoadClass, axis: Axis, at: number, w: number, from: number, to: number, extra: Partial<RoadDef> = {}): void {
  if (Math.abs(to - from) < 1) return;
  const m = at + w / 2, a = from + 0.5, b = to + 0.5;
  const path: [number, number][] = axis === "x" ? [[a, m], [b, m]] : [[m, a], [m, b]];
  c.out.push({ id: `${cls}-w${c.serial++}`, cls, path, lanes: defaultLanes(cls), ...extra });
}

function near(c: Ctx, axis: Axis, at: number, w: number, gap: number): boolean {
  return c.reserved.some((r) => r.axis === axis && r.at < at + w + gap && at - gap < r.at + r.width);
}

// 1. The perimeter road and the frontage road.
function perimeter(c: Ctx): void {
  const box = (d: number) => {
    const top = c.cy0 - d, bottom = c.cy1 + d, left = c.cx0 - d, right = c.cx1 + d;
    add(c, "local", "x", top, 1, left, right);
    add(c, "local", "x", bottom, 1, left, right);
    add(c, "local", "y", left, 1, top, bottom);
    add(c, "local", "y", right, 1, top, bottom);
    c.reserved.push({ axis: "x", at: top, width: 1 }, { axis: "x", at: bottom, width: 1 }, { axis: "y", at: left, width: 1 }, { axis: "y", at: right, width: 1 });
  };
  box(1);
  if (c.F >= 4) box(c.F);
}

// 2. Core streets that reach the core's edge continue outward, past the
// perimeter road. A street that stops short of the edge counts when only open
// ground lies between; a stub of the same street paves that margin.
function extensions(c: Ctx, core: RoadDef[]): void {
  const { f, F } = c;
  const coreArterials = core
    .filter((r) => r.cls === "arterial" && r.path.length === 2)
    .map((r) => (r.path[0][1] === r.path[1][1] ? { axis: "x" as Axis, m: r.path[0][1] } : { axis: "y" as Axis, m: r.path[0][0] }));
  for (const r of core) {
    if (r.tram || r.path.length !== 2) continue;
    const [[ax, ay], [bx, by]] = r.path;
    const axis: Axis = ay === by ? "x" : "y";
    const w = roadWidth(r);
    const at = Math.round((axis === "x" ? ay : ax) - w / 2);
    const a = axis === "x" ? ax : ay, b = axis === "x" ? bx : by;
    const lo = Math.floor(Math.min(a, b)), hi = Math.floor(Math.max(a, b));
    const [a0, a1] = along(c, axis);
    const ends: { dir: number; end: number; edge: number; start: number }[] = [];
    for (const dir of [-1, 1]) {
      const end = dir < 0 ? lo : hi;
      const edge = dir < 0 ? a0 : a1;
      if ((edge - end) * dir < 0) continue;
      let clear = true;
      for (let i = end + dir; clear && (i - edge) * dir <= 0; i += dir)
        for (let k = 0; k < w; k++) if (!f.free(...tileOf(axis, at + k, i))) clear = false;
      const start = edge + 2 * dir;
      if (clear && insideAll(c, axis, at, w, start)) ends.push({ dir, end, edge, start });
    }
    if (!ends.length) continue;
    // A street on one of the suburbs' arterial lines (every 2G) carries a
    // four-lane arterial out to the world's edge, widened by a tile on
    // whichever side stays out of the water; it narrows back to the street at
    // the perimeter road. It stays a collector when both sides are wet, or
    // when one of the core's own arterials runs less than a block (G) away.
    const upgrade =
      r.cls !== "arterial" && onLine(rel(c, axis, at), 2 * f.G) && !coreArterials.some((o) => o.axis === axis && Math.abs(o.m - (at + w / 2)) < f.G);
    const artAt = r.cls === "arterial" ? at : upgrade ? widen(c, axis, at, ends) : null;
    for (const { dir, end, edge, start } of ends) {
      if (end !== edge) {
        const m = axis === "x" ? ay : ax;
        const e = dir < 0 ? Math.min(a, b) : Math.max(a, b);
        const path: [number, number][] = axis === "x" ? [[e, m], [edge + 0.5, m]] : [[m, e], [m, edge + 0.5]];
        c.out.push({ id: `${r.cls}-w${c.serial++}`, cls: r.cls, path, lanes: r.lanes });
      }
      if (artAt !== null) add(c, "arterial", axis, artAt, 2, start, reach(c, axis, artAt, 2, start, dir));
      else {
        add(c, "collector", axis, at, w, start, edge + F * dir);
        // With no ring the street runs on as a country road, starting on the
        // frontage road so both meet it at the same junction.
        if (!f.ring && insideAll(c, axis, at, w, edge + (F + 1) * dir))
          add(c, "local", axis, at, w, edge + F * dir, reach(c, axis, at, w, edge + (F + 1) * dir, dir), { rural: true });
      }
    }
    if (artAt !== null) {
      c.reserved.push({ axis, at: artAt, width: 2 });
      c.crossers.push({ axis, at: artAt, width: 2, rank: r.cls === "arterial" ? 0 : 1 });
    } else c.reserved.push({ axis, at, width: w });
  }
}

/**
 * The first row or column of a 1-tile street widened to 2 tiles outside the
 * core: its own line plus the next one, or the one before, whichever keeps as
 * much road after water splits as the street alone would (the world's
 * diagonal edge may clip a tile or two). Null when both lose road to water.
 */
function widen(c: Ctx, axis: Axis, at: number, ends: { dir: number; start: number }[]): number | null {
  const kept = (first: number, w: number) => {
    let n = 0;
    for (const { dir, start } of ends) {
      if (!insideAll(c, axis, first, w, start)) return -Infinity;
      const end = reach(c, axis, first, w, start, dir);
      n += keepMask(c.f, axis === "x", first, w, Math.min(start, end), Math.max(start, end), 5).keep.filter(Boolean).length;
    }
    return n;
  };
  const base = kept(at, 1);
  for (const first of [at, at - 1]) {
    if (near(c, axis, first, 2, 0)) continue;
    if (kept(first, 2) >= base - 2 * ends.length) return first;
  }
  return null;
}

// 3. The suburban grid. Lines across the core's span keep the core's lattice
// (collectors every G, arterials every 2G) so they meet its streets; arterials
// run on to the world's edge. Each side band between the perimeter and the
// frontage road gets collectors parallel to the core, spaced evenly so the
// blocks between come out the same depth.
function grid(c: Ctx): void {
  const { f, F } = c;
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(c, axis), [a0, a1] = along(c, axis);
    const lo = a0 - F, hi = a1 + F;
    for (let at = c0 - 2; at <= c1 + 1; at++) {
      if (!onLine(rel(c, axis, at), f.G)) continue;
      const art = onLine(rel(c, axis, at), 2 * f.G);
      const w = art ? 2 : 1;
      if (at + w - 1 < c0 - 1 || near(c, axis, at, w, 2)) continue;
      for (const [p, q] of [[lo, a0 - 1], [a1 + 1, hi]]) {
        if (!art) {
          add(c, "collector", axis, at, w, p, q);
          continue;
        }
        const from = p === lo && insideAll(c, axis, at, w, lo) ? reach(c, axis, at, w, lo, -1) : p;
        const to = q === hi && insideAll(c, axis, at, w, hi) ? reach(c, axis, at, w, hi, 1) : q;
        add(c, "arterial", axis, at, w, from, to);
      }
      c.reserved.push({ axis, at, width: w });
      if (art) c.crossers.push({ axis, at, width: w, rank: 2 });
    }
    // The band holds n rows (d = 2 .. F - 1); k collectors leave blocks at least 3 deep and about G apart.
    const n = F - 2;
    const k = Math.max(0, Math.min(Math.floor((n - 3) / 4), Math.floor(n / f.G)));
    for (let j = 0; j < k; j++) {
      const d = 1 + Math.round(((j + 1) * (n + 1)) / (k + 1));
      for (const at of [c0 - d, c1 + d]) {
        if (near(c, axis, at, 1, 2)) continue;
        add(c, "collector", axis, at, 1, lo, hi);
        c.reserved.push({ axis, at, width: 1 });
      }
    }
  }
}

// 4. Local streets in the suburban blocks. A block is the land between two
// neighboring lines on each axis (the inner ramp row bounds the outermost
// ones). A block 5 or more deep gets a local street through the middle (some
// stop short as cul-de-sacs); a shallower one gets short cul-de-sacs off one
// of its long sides.
function blocks(c: Ctx, core: RoadDef[]): void {
  const { f } = c;
  const road = new Map<string, RoadClass>();
  for (const d of [...core, ...c.out]) for (const [x, y] of roadTiles(d)) road.set(`${x},${y}`, d.cls);
  const isRoad = (x: number, y: number) => road.has(`${x},${y}`);
  const lines = (axis: Axis) => {
    const [c0, c1] = across(c, axis);
    const ls = c.reserved.filter((l) => l.axis === axis).map((l): [number, number] => [l.at, l.at + l.width - 1]);
    ls.push([c0 - f.S - 1, c0 - f.S - 1], [c1 + f.S + 1, c1 + f.S + 1]);
    return ls.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  };
  const rows = lines("x"), cols = lines("y");
  const clear = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = coreDist(f, x, y);
        if (d < 2 || d > f.S || !f.inside(x, y) || isRoad(x, y) || f.tile(x, y) === "w") return false;
      }
    return true;
  };
  for (let i = 0; i + 1 < rows.length; i++)
    for (let j = 0; j + 1 < cols.length; j++) {
      const y0 = rows[i][1] + 1, y1 = rows[i + 1][0] - 1, x0 = cols[j][1] + 1, x1 = cols[j + 1][0] - 1;
      const wx = x1 - x0 + 1, wy = y1 - y0 + 1;
      if (Math.min(wx, wy) < 3 || Math.max(wx, wy) < 4 || !clear(x0, y0, x1, y1)) continue;
      if (Math.min(wx, wy) >= 5) throughStreet(c, isRoad, x0, y0, x1, y1);
      else culDeSacs(c, road, x0, y0, x1, y1);
    }
}

/** A local street across the middle of a block, joining the roads at both ends; 30% stop two tiles short. */
function throughStreet(c: Ctx, isRoad: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): void {
  const seed = c.f.seed;
  const alongX = cellHash(seed, "street", x0, y0) < 0.5;
  const axis: Axis = alongX ? "x" : "y";
  const at = alongX ? Math.floor((y0 + y1) / 2) : Math.floor((x0 + x1) / 2);
  const [i0, i1] = alongX ? [x0, x1] : [y0, y1];
  const rootLo = isRoad(...tileOf(axis, at, i0 - 1)), rootHi = isRoad(...tileOf(axis, at, i1 + 1));
  if (!rootLo && !rootHi) return;
  const cul = cellHash(seed, "cul", x0, y0) < 0.3 || !rootLo || !rootHi;
  if (!cul) add(c, "local", axis, at, 1, i0, i1);
  else if (rootLo) add(c, "local", axis, at, 1, i0, i1 - 2);
  else add(c, "local", axis, at, 1, i1, i0 + 2);
}

/**
 * Cul-de-sacs off one long side of a shallow block, every 4 or 5 tiles, each
 * running in until one tile short of the far side. A block keeps 30-50% of
 * them; the side is a quieter road than an arterial when it can be.
 */
function culDeSacs(c: Ctx, road: Map<string, RoadClass>, x0: number, y0: number, x1: number, y1: number): void {
  const seed = c.f.seed;
  const wx = x1 - x0 + 1, wy = y1 - y0 + 1;
  // Streets run across the short side: along y when the block is wider than it is deep.
  const alongY = wx > wy || (wx === wy && cellHash(seed, "culside", x0, y0) < 0.5);
  const axis: Axis = alongY ? "y" : "x";
  const [p0, p1] = alongY ? [x0, x1] : [y0, y1];
  const [i0, i1] = alongY ? [y0, y1] : [x0, x1];
  const depth = i1 - i0 + 1;
  const step = cellHash(seed, "culstep", x0, y0) < 0.5 ? 4 : 5;
  const rate = 0.3 + 0.2 * cellHash(seed, "culrate", x0, y0);
  const roots = (edge: number) => {
    const ps: number[] = [];
    for (let p = p0 + 1; p <= p1 - 1; p += step) if (road.has(tileOf(axis, p, edge).join(","))) ps.push(p);
    return ps;
  };
  const quiet = (edge: number, ps: number[]) => ps.length > 0 && ps.every((p) => road.get(tileOf(axis, p, edge).join(",")) !== "arterial");
  const lo = roots(i0 - 1), hi = roots(i1 + 1);
  const scoreLo = lo.length ? (quiet(i0 - 1, lo) ? 2 : 1) : 0, scoreHi = hi.length ? (quiet(i1 + 1, hi) ? 2 : 1) : 0;
  if (!scoreLo && !scoreHi) return;
  const fromLo = scoreLo > scoreHi || (scoreLo === scoreHi && cellHash(seed, "culedge", x0, y0) < 0.5);
  for (const p of fromLo ? lo : hi) {
    if (cellHash(seed, "cul", ...tileOf(axis, p, fromLo ? i0 : i1)) >= rate) continue;
    if (fromLo) add(c, "local", axis, p, 1, i0, i0 + depth - 2);
    else add(c, "local", axis, p, 1, i1, i1 - (depth - 2));
  }
}

// 5. The highway ring: two lanes each way, at S + 2 and S + 3 from the core.
function ring(c: Ctx): Ring | null {
  const { f } = c;
  if (!f.ring || !ringFits(f, f.S)) return null;
  const d0 = f.S + 2;
  const R: Ring = { yn: c.cy0 - d0, ys: c.cy1 + d0 + 1, xw: c.cx0 - d0, xe: c.cx1 + d0 + 1 };
  const hwy = (id: string, path: [number, number][]) => c.out.push({ id, cls: "highway", path, lanes: [2, 2] });
  hwy("ring-n", [[R.xw - 0.5, R.yn], [R.xe + 0.5, R.yn]]);
  hwy("ring-s", [[R.xw - 0.5, R.ys], [R.xe + 0.5, R.ys]]);
  hwy("ring-w", [[R.xw, R.yn - 0.5], [R.xw, R.ys + 0.5]]);
  hwy("ring-e", [[R.xe, R.yn - 0.5], [R.xe, R.ys + 0.5]]);
  return R;
}

/** The two ring sides a line of this axis crosses. */
function sidesCrossed(R: Ring, axis: Axis): RingSide[] {
  return axis === "y"
    ? [{ side: "n", axis: "x", c: R.yn, s0: R.xw, s1: R.xe }, { side: "s", axis: "x", c: R.ys, s0: R.xw, s1: R.xe }]
    : [{ side: "w", axis: "y", c: R.xw, s0: R.yn, s1: R.ys }, { side: "e", axis: "y", c: R.xe, s0: R.yn, s1: R.ys }];
}

/** Whether the arterial on line l really runs across the ring's centerline c (it may stop at water short of one side). */
function reaches(c: Ctx, l: Line, rc: number): boolean {
  return c.out.some((d) => {
    if (d.cls !== "arterial") return false;
    const [[ax, ay], [bx, by]] = d.path;
    const horiz = ay === by;
    if ((horiz ? "x" : "y") !== l.axis || Math.abs((horiz ? ay : ax) - (l.at + l.width / 2)) > 0.01) return false;
    const a = horiz ? ax : ay, b = horiz ? bx : by;
    return Math.min(a, b) <= rc - 3 && Math.max(a, b) >= rc + 3;
  });
}

/** An interchange needs dry land under the highway and both ramp rows, with a tile to spare. */
function dry(c: Ctx, s: RingSide, A: number, L: number): boolean {
  for (let j = s.c - 2; j <= s.c + 1; j++)
    for (let i = Math.floor(A - L - 1); i <= Math.floor(A + L + 1); i++) {
      const [x, y] = tileOf(s.axis, j, i);
      if (!c.f.inside(x, y) || c.f.tile(x, y) === "w") return false;
    }
  return true;
}

// 6. Diamond interchanges where arterials cross the ring. The core's own
// arterials claim their slots first, then the core streets continued as
// arterials, then the suburbs' arterials; within a rank, the ones nearest the
// middle of the side go first. An interchange too close to a neighbor
// shortens its ramps (and the neighbor's) rather than giving up.
function interchanges(c: Ctx, R: Ring): Interchange[] {
  const chosen: Interchange[] = [];
  const middle = (l: Line) => {
    const { s0, s1 } = sidesCrossed(R, l.axis)[0];
    return Math.abs(l.at + l.width / 2 - (s0 + s1) / 2);
  };
  const order = [...c.crossers].sort((p, q) => p.rank - q.rank || middle(p) - middle(q) || p.at - q.at);
  for (const l of order) {
    const A = l.at + l.width / 2;
    for (const s of sidesCrossed(R, l.axis)) {
      if (!reaches(c, l, s.c)) continue;
      const others = chosen.filter((o) => o.side.side === s.side);
      const options: [number, boolean][] = [[RAMP_LONG, false], [RAMP_SHORT, false], [RAMP_SHORT, true]];
      for (const [L, shorten] of options) {
        if (A - L < s.s0 + 3.5 || A + L > s.s1 - 3.5) continue;
        const gap = (o: Interchange) => Math.abs(o.A - A) - L - MERGE_GAP;
        if (others.some((o) => gap(o) < (shorten ? RAMP_SHORT : o.L))) continue;
        // The ramps (and a tile past their ends) stay off every other arterial crossing this side.
        const r0 = Math.floor(A - L) - 1, r1 = Math.floor(A + L) + 1;
        if (c.crossers.some((o) => o !== l && o.axis === l.axis && o.at <= r1 && o.at + o.width - 1 >= r0)) continue;
        if (!dry(c, s, A, L)) continue;
        if (shorten) for (const o of others) if (gap(o) < o.L) o.L = RAMP_SHORT;
        chosen.push({ side: s, A, w: l.width, L });
        break;
      }
    }
  }
  return chosen;
}

// 7. The radial highway: from the middle of the side with the least water
// straight out to the world's edge (bridging water up to 8 tiles). It keeps
// clear of the arterials crossing that side, and of the interchanges' merges.
function radial(c: Ctx, R: Ring, chosen: Interchange[]): void {
  const { f } = c;
  const sides: RingSide[] = [...sidesCrossed(R, "y"), ...sidesCrossed(R, "x")];
  const bySide = new Map(sides.map((s) => [s.side, s]));
  const column = (s: RingSide) => {
    const vertical = s.axis === "x";
    const base = vertical ? f.Mx + Math.round(f.cw / 2) : f.My + Math.round(f.ch / 2);
    const crossAxis: Axis = vertical ? "y" : "x";
    const ics = chosen.filter((o) => o.side.side === s.side);
    for (const clearance of RADIAL_CLEARANCE)
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
        const cc = base + k;
        if (c.crossers.some((l) => l.axis === crossAxis && Math.abs(l.at + l.width / 2 - cc) < clearance)) continue;
        // Its junction with the ring stays 3 tiles past an interchange's merge node (a long one may shorten).
        if (ics.some((o) => Math.abs(o.A - cc) < RAMP_SHORT + 3)) continue;
        return cc;
      }
    return null;
  };
  const outward = (s: Side) => (s === "n" || s === "w" ? -1 : 1);
  const startOf = (s: Side) => (s === "n" ? R.yn - 2 : s === "s" ? R.ys + 1 : s === "w" ? R.xw - 2 : R.xe + 1);
  const tilesAt = (s: RingSide, cc: number, i: number) => [cc - 1, cc].map((k): [number, number] => (s.axis === "x" ? [k, i] : [i, k]));
  /** Wet tiles on the way out, or null when the way out is too short or blocked by water too wide to bridge. */
  const survey = (s: RingSide, cc: number) => {
    let wet = 0, run = 0, len = 0, last = startOf(s.side);
    for (let i = startOf(s.side); ; i += outward(s.side)) {
      const tiles = tilesAt(s, cc, i);
      if (!tiles.every(([x, y]) => f.inside(x, y))) break;
      len++;
      if (tiles.some(([x, y]) => f.tile(x, y) === "w")) {
        wet++;
        if (++run > 8) return null;
      } else {
        run = 0;
        last = i;
      }
    }
    // It has to reach the world's edge on land, or its end would be a dead end.
    return len >= 6 && run === 0 ? { wet, last } : null;
  };
  let best: { s: RingSide; cc: number; last: number; wet: number } | null = null;
  for (const side of ["s", "e", "n", "w"] as const) {
    const s = bySide.get(side)!;
    const cc = column(s);
    if (cc === null) continue;
    const got = survey(s, cc);
    if (got && (!best || got.wet < best.wet)) best = { s, cc, ...got };
  }
  if (!best) return;
  const { s, cc, last } = best;
  const vertical = s.axis === "x";
  c.out.push({ id: "radial", cls: "highway", path: vertical ? [[cc, s.c], [cc, last + 0.5]] : [[s.c, cc], [last + 0.5, cc]], lanes: [2, 2] });
  c.reserved.push({ axis: vertical ? "y" : "x", at: cc - 1, width: 2 });
  for (const o of chosen) if (o.side.side === s.side && Math.abs(o.A - cc) < o.L + 3) o.L = RAMP_SHORT;
}

/** Four ramps; their street ends stop half a tile past the arterial's side (w tiles wide) so they meet it. */
function ramps(c: Ctx, { side: s, A, w, L }: Interchange): void {
  const h = w / 2 + 0.5;
  for (const D of [1, -1]) {
    const lat = s.axis === "x" ? s.c + 1.5 * D : s.c - 1.5 * D;
    const p = (v: number): [number, number] => (s.axis === "x" ? [v, lat] : [lat, v]);
    c.out.push({ id: `ramp-w${c.serial++}`, cls: "ramp", ramp: "off", path: [p(A - L * D), p(A - h * D)], lanes: [1, 0] });
    c.out.push({ id: `ramp-w${c.serial++}`, cls: "ramp", ramp: "on", path: [p(A + h * D), p(A + L * D)], lanes: [1, 0] });
  }
}

// 8. Country roads every 2G, well outside the suburbs (lines that cross the suburbs are arterials).
function country(c: Ctx, hasRing: boolean): void {
  const { f } = c;
  const gapOut = f.S + (hasRing ? 7 : 2);
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(c, axis);
    for (let at = 0; at < f.N; at++) {
      if (!onLine(rel(c, axis, at), 2 * f.G)) continue;
      if (Math.max(c0 - at, at - c1) < gapOut) continue;
      if (near(c, axis, at, 1, 2)) continue;
      let first = -1, last = -1;
      for (let i = 0; i < f.N; i++)
        if (insideAll(c, axis, at, 1, i)) {
          if (first < 0) first = i;
          last = i;
        }
      if (first >= 0) add(c, "local", axis, at, 1, first, last, { rural: true });
    }
  }
}

type TileState = "out" | "wet" | "land";

/**
 * The tiles a w-wide line (rows `first`.. when horizontal, columns when not)
 * keeps from i0 to i1: land, and water spans up to maxSpan with land on both sides.
 */
function keepMask(f: Frame, horiz: boolean, first: number, w: number, i0: number, i1: number, maxSpan: number) {
  const state = (i: number): TileState => {
    let wet = false;
    for (let k = 0; k < w; k++) {
      const [X, Y] = horiz ? [i, first + k] : [first + k, i];
      if (!f.inside(X, Y)) return "out";
      if (f.tile(X, Y) === "w") wet = true;
    }
    return wet ? "wet" : "land";
  };
  const states: TileState[] = [];
  for (let i = i0; i <= i1; i++) states.push(state(i));
  const keep = states.map((s) => s === "land");
  for (let k = 0; k < states.length; k++) {
    if (states[k] !== "wet") continue;
    let e = k;
    while (e + 1 < states.length && states[e + 1] === "wet") e++;
    if (e - k + 1 <= maxSpan && k > 0 && e + 1 < states.length && states[k - 1] === "land" && states[e + 1] === "land")
      for (let j = k; j <= e; j++) keep[j] = true;
    k = e;
  }
  return { keep, state };
}

/**
 * Split generated roads where they meet water too wide to bridge (5 tiles, 8
 * for highways), or leave the world. Pieces shorter than two tiles are
 * dropped. Ends that stop at the world's edge are flagged so cars can enter
 * and leave there.
 */
export function fitRoads(defs: RoadDef[], f: Frame): RoadDef[] {
  const out: RoadDef[] = [];
  for (const d of defs) {
    const [[ax, ay], [bx, by]] = d.path;
    const horiz = ay === by;
    const w = roadWidth(d);
    const first = Math.round((horiz ? ay : ax) - w / 2);
    const a = horiz ? ax : ay, b = horiz ? bx : by;
    const lo = Math.min(a, b), hi = Math.max(a, b), rev = a > b;
    const i0 = Math.floor(lo), i1 = Math.floor(hi);
    const { keep, state } = keepMask(f, horiz, first, w, i0, i1, d.cls === "highway" ? 8 : 5);
    let n = 0;
    for (let k = 0; k < keep.length; k++) {
      if (!keep[k]) continue;
      let e = k;
      while (e + 1 < keep.length && keep[e + 1]) e++;
      if (e > k) {
        const p = i0 + k, q = i0 + e;
        const from = k === 0 ? lo : p + 0.5, to = e === keep.length - 1 ? hi : q + 0.5;
        const edgeLo = state(p - 1) === "out", edgeHi = state(q + 1) === "out";
        const m = horiz ? ay : ax;
        const pt = (v: number): [number, number] => (horiz ? [v, m] : [m, v]);
        out.push({
          ...d,
          id: n === 0 ? d.id : `${d.id}.${n}`,
          path: rev ? [pt(to), pt(from)] : [pt(from), pt(to)],
          edge: rev ? [edgeHi, edgeLo] : [edgeLo, edgeHi],
        });
        n++;
      }
      k = e;
    }
  }
  return out;
}

const isHwy = (d: RoadDef) => d.cls === "highway";
const endsOf = (d: RoadDef) => [d.path[0], d.path[d.path.length - 1]];
/** Whether point p lies within 1.6 tiles of road d's centerline. */
function touches(p: [number, number], d: RoadDef): boolean {
  const [[ax, ay], [bx, by]] = endsOf(d);
  const x = Math.max(Math.min(ax, bx), Math.min(Math.max(ax, bx), p[0]));
  const y = Math.max(Math.min(ay, by), Math.min(Math.max(ay, by), p[1]));
  return Math.hypot(p[0] - x, p[1] - y) < 1.6;
}
/** Where a ramp meets its highway: the start of an off-ramp, the end of an on-ramp. */
const rampHighwayEnd = (r: RoadDef) => (r.ramp === "off" ? r.path[0] : r.path[r.path.length - 1]);

/**
 * End every highway where cars can get off it. Water can cut the ring (or
 * the world can end it) away from any interchange, which would leave a dead
 * end cars U-turn in. Each such end is cut back to the nearest place a driver
 * can leave: the radial highway's junction, or an interchange's merge node
 * whose on-ramp heads away from the cut, which becomes a terminal where one
 * direction's traffic all exits and the other's begins (the interchange's
 * other two ramps, now past the end, go). A piece with no such place goes
 * with its ramps, and the pieces it joined are checked again.
 */
export function endHighways(defs: RoadDef[]): RoadDef[] {
  let roads = defs;
  for (let changed = true; changed; ) {
    changed = false;
    const hwys = roads.filter(isHwy);
    for (const h of hwys) {
      const horiz = h.path[0][1] === h.path[1][1];
      const alongOf = (p: [number, number]) => (horiz ? p[0] : p[1]);
      const acrossOf = (p: [number, number]) => (horiz ? p[1] : p[0]);
      const line = acrossOf(h.path[0]);
      const [e0, e1] = endsOf(h).map(alongOf);
      const lo = Math.min(e0, e1), hi = Math.max(e0, e1);
      const onH = (p: [number, number]) => Math.abs(acrossOf(p) - line) < 1.6 && alongOf(p) >= lo - 0.01 && alongOf(p) <= hi + 0.01;
      const rampsOn = roads.filter((r) => r.cls === "ramp" && onH(rampHighwayEnd(r)));
      for (const k of [0, 1] as const) {
        const e = endsOf(h)[k];
        if (h.edge?.[k] || hwys.some((o) => o !== h && touches(e, o))) continue;
        const dead = alongOf(e), away = Math.sign((k === 0 ? e1 : e0) - dead);
        const exits: number[] = [];
        for (const r of rampsOn)
          if (r.ramp === "on" && Math.sign(alongOf(r.path[r.path.length - 1]) - alongOf(r.path[0])) === away) exits.push(alongOf(rampHighwayEnd(r)));
        for (const o of hwys)
          if (o !== h) for (const p of endsOf(o)) if (Math.abs(acrossOf(p) - line) < 0.01 && alongOf(p) > lo + 0.01 && alongOf(p) < hi - 0.01) exits.push(alongOf(p));
        const cut = exits.length ? exits.reduce((m, v) => (Math.abs(v - dead) < Math.abs(m - dead) ? v : m)) : null;
        if (cut !== null && Math.abs(cut - dead) < 0.01) continue; // already a terminal
        if (cut === null || Math.abs(cut - (k === 0 ? e1 : e0)) < 2) {
          roads = roads.filter((r) => r !== h && !rampsOn.includes(r));
        } else {
          const beyond = (r: RoadDef) => (alongOf(rampHighwayEnd(r)) - cut) * (dead - cut) > 0.01;
          const path = h.path.map((p): [number, number] => [...p]);
          const idx = k === 0 ? 0 : path.length - 1;
          path[idx] = horiz ? [cut, line] : [line, cut];
          const edge: [boolean, boolean] = [h.edge?.[0] ?? false, h.edge?.[1] ?? false];
          edge[k] = false;
          const cutH: RoadDef = { ...h, path, edge };
          roads = roads.filter((r) => !(rampsOn.includes(r) && beyond(r))).map((r) => (r === h ? cutH : r));
        }
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return roads;
}

/**
 * The generated roads connected to the main network: the largest set of
 * roads (the core's and the generated ones) that meet each other, by the
 * graph's rules (a street crossing a highway does not meet it; a ramp meets
 * its highway beside it). Water splits can leave pieces with no way in.
 */
export function connectedRoads(core: RoadDef[], generated: RoadDef[]): RoadDef[] {
  const all = [...core, ...generated];
  interface Seg { i: number; horiz: boolean; c: number; lo: number; hi: number; hw: number; hwy: boolean }
  const segs: Seg[] = [];
  all.forEach((d, i) => {
    for (let k = 0; k + 1 < d.path.length; k++) {
      const [ax, ay] = d.path[k], [bx, by] = d.path[k + 1];
      const horiz = ay === by;
      const a = horiz ? ax : ay, b = horiz ? bx : by;
      segs.push({ i, horiz, c: horiz ? ay : ax, lo: Math.min(a, b), hi: Math.max(a, b), hw: roadWidth(d) / 2, hwy: isHwy(d) });
    }
  });
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };
  const meets = (A: Seg, B: Seg): boolean => {
    if (A.horiz !== B.horiz) {
      if (A.hwy !== B.hwy) return false;
      const H = A.horiz ? A : B, V = A.horiz ? B : A;
      const eH = V.hw + 0.51, eV = H.hw + 0.51;
      if (V.c < H.lo - eH || V.c > H.hi + eH || H.c < V.lo - eV || H.c > V.hi + eV) return false;
      // Highways that run through each other cross on a flyover.
      return !(A.hwy && V.c > H.lo + 0.51 && V.c < H.hi - 0.51 && H.c > V.lo + 0.51 && H.c < V.hi - 0.51);
    }
    if (Math.abs(A.c - B.c) < 0.01) return B.lo - A.hi <= 1.01 && A.lo - B.hi <= 1.01;
    const ramp = all[A.i].cls === "ramp" ? A : all[B.i].cls === "ramp" ? B : null;
    const hwy = ramp === A ? B : A;
    if (!ramp || !hwy.hwy || Math.abs(ramp.c - hwy.c) > hwy.hw + 0.51) return false;
    const e = rampHighwayEnd(all[ramp.i]);
    const v = ramp.horiz ? e[0] : e[1];
    return v >= hwy.lo - 0.01 && v <= hwy.hi + 0.01;
  };
  for (let a = 0; a < segs.length; a++)
    for (let b = a + 1; b < segs.length; b++) if (segs[a].i !== segs[b].i && meets(segs[a], segs[b])) union(segs[a].i, segs[b].i);
  const size = new Map<number, number>();
  for (const s of segs) size.set(find(s.i), (size.get(find(s.i)) ?? 0) + 1);
  let main = -1, best = -1;
  for (const [root, n] of size) if (n > best || (n === best && root < main)) [main, best] = [root, n];
  return generated.filter((_, k) => find(core.length + k) === main);
}

/**
 * Stamp road tiles: highways first, then ramps, then everything else; a street
 * over a highway is an overpass. Returns the street tiles (not highways or
 * ramps) as "x,y" keys, for placing lots along them.
 */
export function stampRoads(g: TileChar[][], defs: RoadDef[]): Set<string> {
  const order = (r: RoadDef) => (r.cls === "highway" ? 0 : r.cls === "ramp" ? 1 : 2);
  const hwy = new Set<string>(), streets = new Set<string>();
  for (const d of [...defs].sort((a, b) => order(a) - order(b)))
    for (const [x, y] of roadTiles(d)) {
      const c = g[y]?.[x];
      if (c === undefined || c === " ") continue;
      const k = `${x},${y}`;
      if (c === "w" || c === "B") g[y][x] = "B";
      else if (hwy.has(k) && d.cls !== "highway") g[y][x] = "O";
      else if (c !== "O") g[y][x] = d.tram ? "t" : "=";
      if (d.cls === "highway") hwy.add(k);
      else if (d.cls !== "ramp") streets.add(k);
    }
  return streets;
}
