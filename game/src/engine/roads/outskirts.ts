// Roads for the generated world around a city's core: a perimeter road
// hugging the core, the core's streets continued outward, a suburban grid of
// collectors and arterials with a local street (or cul-de-sac) in each block,
// a frontage road at the suburbs' edge, an optional highway ring with diamond
// interchanges and one radial highway, and country roads beyond.

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
  ring: boolean;
  seed: number;
  inside: (X: number, Y: number) => boolean;
  /** The world tile before roads are stamped (terrain and the core). */
  tile: (X: number, Y: number) => TileChar;
  /** Open ground inside the core a street may be continued across (no water, homes, or landmarks). */
  free: (X: number, Y: number) => boolean;
}

/** Which way a road runs: along x (it sits in rows) or along y (in columns). */
type Axis = "x" | "y";

interface Line {
  axis: Axis;
  /** First row (axis x) or column (axis y) it covers. */
  at: number;
  width: number;
}

const onLine = (v: number, step: number) => (((v - 2) % step) + step) % step === 0;

export function coreDist(f: Frame, X: number, Y: number): number {
  return Math.max(f.Mx - X, X - (f.Mx + f.cw - 1), f.My - Y, Y - (f.My + f.ch - 1), 0);
}

/** Whether the highway ring fits inside the world when the suburbs are S tiles wide. */
export function ringFits(f: Pick<Frame, "Mx" | "My" | "cw" | "ch" | "inside">, S: number): boolean {
  const d = S + 3, x0 = f.Mx - d, x1 = f.Mx + f.cw - 1 + d, y0 = f.My - d, y1 = f.My + f.ch - 1 + d;
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) => f.inside(x, y));
}

export function outskirtRoads(f: Frame, core: RoadDef[]): RoadDef[] {
  const out: RoadDef[] = [];
  let serial = 0;
  const { Mx, My, cw, ch, S, G } = f;
  // The frontage road sits one tile inside the suburbs' edge, so a street
  // between it and the inner ramps (at S + 1) is long enough to keep its junctions.
  const F = S - 1;
  const cx0 = Mx, cx1 = Mx + cw - 1, cy0 = My, cy1 = My + ch - 1;
  const across = (axis: Axis): [number, number] => (axis === "x" ? [cy0, cy1] : [cx0, cx1]);
  const along = (axis: Axis): [number, number] => (axis === "x" ? [cx0, cx1] : [cy0, cy1]);
  const rel = (axis: Axis, at: number) => at - (axis === "x" ? My : Mx);
  const tileOf = (axis: Axis, a: number, i: number): [number, number] => (axis === "x" ? [i, a] : [a, i]);
  const insideAll = (axis: Axis, at: number, w: number, i: number) => {
    for (let k = 0; k < w; k++) if (!f.inside(...tileOf(axis, at + k, i))) return false;
    return true;
  };
  /** From `start`, step by `dir` while still inside the world; the last inside index. */
  const reach = (axis: Axis, at: number, w: number, start: number, dir: number) => {
    let i = start;
    while (insideAll(axis, at, w, i + dir)) i += dir;
    return i;
  };
  const add = (cls: RoadClass, axis: Axis, at: number, w: number, from: number, to: number, extra: Partial<RoadDef> = {}) => {
    if (Math.abs(to - from) < 1) return;
    const c = at + w / 2, a = from + 0.5, b = to + 0.5;
    const path: [number, number][] = axis === "x" ? [[a, c], [b, c]] : [[c, a], [c, b]];
    out.push({ id: `${cls}-w${serial++}`, cls, path, lanes: defaultLanes(cls), ...extra });
  };
  const reserved: Line[] = [];
  const near = (axis: Axis, at: number, w: number, gap: number) =>
    reserved.some((r) => r.axis === axis && r.at < at + w + gap && at - gap < r.at + r.width);
  const crossers: Line[] = [];

  // 1. The perimeter road and the frontage road.
  const box = (d: number) => {
    const top = cy0 - d, bottom = cy1 + d, left = cx0 - d, right = cx1 + d;
    add("local", "x", top, 1, left, right);
    add("local", "x", bottom, 1, left, right);
    add("local", "y", left, 1, top, bottom);
    add("local", "y", right, 1, top, bottom);
    reserved.push({ axis: "x", at: top, width: 1 }, { axis: "x", at: bottom, width: 1 }, { axis: "y", at: left, width: 1 }, { axis: "y", at: right, width: 1 });
  };
  box(1);
  if (F >= 4) box(F);

  // 2. Core streets that reach the core's edge continue outward, past the perimeter road.
  // A street that stops short of the edge counts when only open ground lies
  // between; a stub of the same street paves that margin.
  for (const r of core) {
    if (r.tram || r.path.length !== 2) continue;
    const [[ax, ay], [bx, by]] = r.path;
    const axis: Axis = ay === by ? "x" : "y";
    const w = roadWidth(r);
    const at = Math.round((axis === "x" ? ay : ax) - w / 2);
    const lo = Math.floor(Math.min(axis === "x" ? ax : ay, axis === "x" ? bx : by));
    const hi = Math.floor(Math.max(axis === "x" ? ax : ay, axis === "x" ? bx : by));
    const [a0, a1] = along(axis);
    // A street on one of the suburbs' arterial lines (every 2G) carries that
    // arterial out to the world's edge, keeping the street's own lanes.
    const upgraded = r.cls !== "arterial" && onLine(rel(axis, at), 2 * G);
    const art = r.cls === "arterial" || upgraded;
    let used = false;
    for (const dir of [-1, 1]) {
      const end = dir < 0 ? lo : hi;
      const edge = dir < 0 ? a0 : a1;
      if ((edge - end) * dir < 0) continue;
      let clear = true;
      for (let i = end + dir; clear && (i - edge) * dir <= 0; i += dir)
        for (let k = 0; k < w; k++) if (!f.free(...tileOf(axis, at + k, i))) clear = false;
      if (!clear) continue;
      const start = edge + 2 * dir;
      if (!insideAll(axis, at, w, start)) continue;
      used = true;
      if (end !== edge) {
        const c = axis === "x" ? ay : ax;
        const e = dir < 0 ? Math.min(axis === "x" ? ax : ay, axis === "x" ? bx : by) : Math.max(axis === "x" ? ax : ay, axis === "x" ? bx : by);
        const path: [number, number][] = axis === "x" ? [[e, c], [edge + 0.5, c]] : [[c, e], [c, edge + 0.5]];
        out.push({ id: `${r.cls}-w${serial++}`, cls: r.cls, path, lanes: r.lanes });
      }
      if (art) add("arterial", axis, at, w, start, reach(axis, at, w, start, dir), upgraded ? { lanes: r.lanes } : {});
      else {
        add("collector", axis, at, w, start, edge + F * dir);
        // With no ring the street runs on as a country road, starting on the
        // frontage road so both meet it at the same junction.
        if (!f.ring && insideAll(axis, at, w, edge + (F + 1) * dir))
          add("local", axis, at, w, edge + F * dir, reach(axis, at, w, edge + (F + 1) * dir, dir), { rural: true });
      }
    }
    if (!used) continue;
    reserved.push({ axis, at, width: w });
    if (art) crossers.push({ axis, at, width: w });
  }

  // 3. The suburban grid: collectors every G, arterials every 2G.
  const accepted: Record<Axis, Map<number, number>> = { x: new Map(), y: new Map() };
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(axis), [a0, a1] = along(axis);
    for (let at = c0 - F + 1; at <= c1 + F - 1; at++) {
      if (!onLine(rel(axis, at), G)) continue;
      const art = onLine(rel(axis, at), 2 * G);
      const w = art ? 2 : 1;
      if (near(axis, at, w, 2)) continue;
      const crossesCore = at + w - 1 >= c0 - 1 && at <= c1 + 1;
      const lo = a0 - F, hi = a1 + F;
      const parts: [number, number][] = crossesCore ? [[lo, a0 - 1], [a1 + 1, hi]] : [[lo, hi]];
      for (const [p, q] of parts) {
        if (!art) {
          add("collector", axis, at, w, p, q);
          continue;
        }
        // Arterials run on to the world's edge on their outer ends.
        const from = p === lo && insideAll(axis, at, w, lo) ? reach(axis, at, w, lo, -1) : p;
        const to = q === hi && insideAll(axis, at, w, hi) ? reach(axis, at, w, hi, 1) : q;
        add("arterial", axis, at, w, from, to);
      }
      accepted[axis].set(at, w);
      reserved.push({ axis, at, width: w });
      if (art) crossers.push({ axis, at, width: w });
    }
  }

  // 4. A local street through each suburban block; some are cul-de-sacs.
  const occupied = new Set<string>();
  for (const d of [...core, ...out]) for (const [x, y] of roadTiles(d)) occupied.add(`${x},${y}`);
  for (const [lx, wx] of accepted.y)
    for (const [ly, wy] of accepted.x) {
      if (!accepted.y.has(lx + G) || !accepted.x.has(ly + G)) continue;
      const ix0 = lx + wx, ix1 = lx + G - 1, iy0 = ly + wy, iy1 = ly + G - 1;
      if (ix1 - ix0 < 3 || iy1 - iy0 < 3) continue;
      let clear = true;
      for (let y = iy0; y <= iy1 && clear; y++)
        for (let x = ix0; x <= ix1; x++) {
          const d = coreDist(f, x, y);
          if (d < 2 || d > F - 1 || occupied.has(`${x},${y}`) || !f.inside(x, y)) {
            clear = false;
            break;
          }
        }
      if (!clear) continue;
      const cul = cellHash(f.seed, "cul", lx, ly) < 0.3;
      if (cellHash(f.seed, "street", lx, ly) < 0.5) add("local", "x", Math.floor((iy0 + iy1) / 2), 1, ix0, cul ? ix1 - 2 : ix1);
      else add("local", "y", Math.floor((ix0 + ix1) / 2), 1, iy0, cul ? iy1 - 2 : iy1);
    }

  // 5. The highway ring, the radial highway, and interchanges.
  const d0 = S + 2;
  const yn = cy0 - d0, ys = cy1 + d0 + 1, xw = cx0 - d0, xe = cx1 + d0 + 1; // centerlines, on tile edges
  const hasRing = f.ring && ringFits(f, S);
  if (hasRing) {
    const hwy = (id: string, path: [number, number][]) => out.push({ id, cls: "highway", path, lanes: [2, 2] });
    hwy("ring-n", [[xw - 0.5, yn], [xe + 0.5, yn]]);
    hwy("ring-s", [[xw - 0.5, ys], [xe + 0.5, ys]]);
    hwy("ring-w", [[xw, yn - 0.5], [xw, ys + 0.5]]);
    hwy("ring-e", [[xe, yn - 0.5], [xe, ys + 0.5]]);

    // Radial: the side with the least water straight out from its middle.
    type Side = "n" | "s" | "e" | "w";
    const mid = (side: Side) => {
      const vertical = side === "n" || side === "s";
      const base = vertical ? Mx + Math.round(cw / 2) : My + Math.round(ch / 2);
      const axisOfCrossers: Axis = vertical ? "y" : "x";
      // Best clear of every crossing arterial by as much as an interchange
      // needs (so the radial vetoes none); failing that, just clear of the arterials.
      for (const clearance of [8, 4])
        for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
          const c = base + k;
          if (!crossers.some((l) => l.axis === axisOfCrossers && Math.abs(l.at + l.width / 2 - c) < clearance)) return c;
        }
      return null;
    };
    const water = (side: Side, c: number) => {
      let wet = 0, len = 0;
      const step = side === "n" || side === "w" ? -1 : 1;
      const startAlong = side === "n" ? yn - 2 : side === "s" ? ys + 1 : side === "w" ? xw - 2 : xe + 1;
      for (let i = startAlong; ; i += step) {
        const [x, y] = side === "n" || side === "s" ? [c, i] : [i, c];
        if (!f.inside(x, y)) break;
        len++;
        if (f.tile(x, y) === "w") wet++;
      }
      return len >= 6 ? wet : Infinity;
    };
    let radial: { side: Side; c: number } | null = null;
    let best = Infinity;
    for (const side of ["s", "e", "n", "w"] as const) {
      const c = mid(side);
      if (c === null) continue;
      const wet = water(side, c);
      if (wet < best) {
        best = wet;
        radial = { side, c };
      }
    }
    // It runs to the world's edge, or stops before water too wide to bridge
    // (a highway bridges up to 8 tiles); too short a stub is no radial at all.
    if (radial) {
      const { side, c } = radial;
      const vertical = side === "n" || side === "s";
      const dir = side === "n" || side === "w" ? -1 : 1;
      const start = side === "n" ? yn - 2 : side === "s" ? ys + 1 : side === "w" ? xw - 2 : xe + 1;
      const ringAt = side === "n" ? yn : side === "s" ? ys : side === "w" ? xw : xe;
      let last: number | null = null, run = 0;
      for (let i = start; ; i += dir) {
        const tiles = [c - 1, c].map((k): [number, number] => (vertical ? [k, i] : [i, k]));
        if (!tiles.every(([x, y]) => f.inside(x, y))) break;
        if (tiles.some(([x, y]) => f.tile(x, y) === "w")) {
          if (++run > 8) break;
        } else {
          run = 0;
          last = i;
        }
      }
      if (last === null || Math.abs(last - start) < 4) radial = null;
      else {
        hwy("radial", vertical ? [[c, ringAt], [c, last + 0.5]] : [[ringAt, c], [last + 0.5, c]]);
        reserved.push({ axis: vertical ? "y" : "x", at: c - 1, width: 2 });
      }
    }

    const used: Record<Side, [number, number][]> = { n: [], s: [], e: [], w: [] };
    /** An interchange needs dry land under the highway and both ramp rows, with room to spare. */
    const dry = (sideAxis: Axis, c: number, A: number) => {
      for (let j = c - 2; j <= c + 1; j++)
        for (let i = Math.floor(A - 7); i <= Math.floor(A + 7); i++) {
          const [x, y] = tileOf(sideAxis, j, i);
          if (!f.inside(x, y) || f.tile(x, y) === "w") return false;
        }
      return true;
    };
    /** Four ramps; their street ends stop half a tile past the arterial's side (w tiles wide) so they meet it. */
    const ramps = (sideAxis: Axis, c: number, A: number, w: number) => {
      const h = w / 2 + 0.5;
      for (const D of [1, -1]) {
        const lat = sideAxis === "x" ? c + 1.5 * D : c - 1.5 * D;
        const p = (v: number): [number, number] => (sideAxis === "x" ? [v, lat] : [lat, v]);
        out.push({ id: `ramp-w${serial++}`, cls: "ramp", ramp: "off", path: [p(A - 5 * D), p(A - h * D)], lanes: [1, 0] });
        out.push({ id: `ramp-w${serial++}`, cls: "ramp", ramp: "on", path: [p(A + h * D), p(A + 5 * D)], lanes: [1, 0] });
      }
    };
    /** Whether an arterial on line l really runs across the ring's centerline c (it may stop at water short of one side). */
    const reaches = (l: Line, c: number) =>
      out.some((d) => {
        if (d.cls !== "arterial") return false;
        const [[ax, ay], [bx, by]] = d.path;
        const horiz = ay === by;
        if ((horiz ? "x" : "y") !== l.axis || Math.abs((horiz ? ay : ax) - (l.at + l.width / 2)) > 0.01) return false;
        const a = horiz ? ax : ay, b = horiz ? bx : by;
        return Math.min(a, b) <= c - 3 && Math.max(a, b) >= c + 3;
      });
    for (const l of crossers) {
      const A = l.at + l.width / 2;
      const sides: [Side, Axis, number, number, number][] =
        l.axis === "y" ? [["n", "x", yn, xw, xe], ["s", "x", ys, xw, xe]] : [["w", "y", xw, yn, ys], ["e", "y", xe, yn, ys]];
      for (const [side, sideAxis, c, s0, s1] of sides) {
        if (A - 5 < s0 + 3.5 || A + 5 > s1 - 3.5) continue;
        if (radial && radial.side === side && Math.abs(A - radial.c) < 8) continue;
        // Neighboring interchanges keep their merge nodes 3.5 tiles apart, or the
        // highway between them is too short to survive both merges' trims.
        if (used[side].some(([u0, u1]) => A - 8.5 < u1 && u0 < A + 8.5)) continue;
        if (!reaches(l, c) || !dry(sideAxis, c, A)) continue;
        used[side].push([A - 5, A + 5]);
        ramps(sideAxis, c, A, l.width);
      }
    }
  }

  // 6. Country roads every 2G, well outside the suburbs (lines that cross the suburbs are arterials).
  const gapOut = S + (hasRing ? 7 : 2);
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(axis);
    for (let at = 0; at < f.N; at++) {
      if (!onLine(rel(axis, at), 2 * G)) continue;
      if (Math.max(c0 - at, at - c1) < gapOut) continue;
      if (near(axis, at, 1, 2)) continue;
      let first = -1, last = -1;
      for (let i = 0; i < f.N; i++)
        if (insideAll(axis, at, 1, i)) {
          if (first < 0) first = i;
          last = i;
        }
      if (first >= 0) add("local", axis, at, 1, first, last, { rural: true });
    }
  }
  return out;
}

/**
 * Split generated roads where they meet water too wide to bridge, or leave
 * the world. Pieces shorter than two tiles are dropped. Ends that stop at the
 * world's edge are flagged so cars can enter and leave there.
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
    const state = (i: number): "out" | "wet" | "land" => {
      let wet = false;
      for (let k = 0; k < w; k++) {
        const [X, Y] = horiz ? [i, first + k] : [first + k, i];
        if (!f.inside(X, Y)) return "out";
        if (f.tile(X, Y) === "w") wet = true;
      }
      return wet ? "wet" : "land";
    };
    const maxSpan = d.cls === "highway" ? 8 : 5;
    const states: ("out" | "wet" | "land")[] = [];
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
    let n = 0;
    for (let k = 0; k < keep.length; k++) {
      if (!keep[k]) continue;
      let e = k;
      while (e + 1 < keep.length && keep[e + 1]) e++;
      if (e > k) {
        const p = i0 + k, q = i0 + e;
        const from = k === 0 ? lo : p + 0.5, to = e === keep.length - 1 ? hi : q + 0.5;
        const edgeLo = state(p - 1) === "out", edgeHi = state(q + 1) === "out";
        const c = horiz ? ay : ax;
        const pt = (v: number): [number, number] => (horiz ? [v, c] : [c, v]);
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

/**
 * Drop highway pieces that water or the world's edge cut off from every
 * interchange: with no ramp onto them nobody could ever drive there. Run after
 * fitRoads, which splits the ring where it meets open water.
 */
export function dropStrandedHighways(defs: RoadDef[]): RoadDef[] {
  const near = (p: [number, number], d: RoadDef) => {
    const [[ax, ay], [bx, by]] = [d.path[0], d.path[d.path.length - 1]];
    const x = Math.max(Math.min(ax, bx), Math.min(Math.max(ax, bx), p[0]));
    const y = Math.max(Math.min(ay, by), Math.min(Math.max(ay, by), p[1]));
    return Math.hypot(p[0] - x, p[1] - y) < 1.6;
  };
  const ends = (d: RoadDef) => [d.path[0], d.path[d.path.length - 1]];
  const hwys = defs.filter((d) => d.cls === "highway");
  const rampEnds = defs.filter((d) => d.cls === "ramp").map((d) => (d.ramp === "off" ? d.path[0] : d.path[d.path.length - 1]));
  const keep = new Set(hwys.filter((h) => rampEnds.some((p) => near(p, h))));
  const queue = [...keep];
  while (queue.length) {
    const h = queue.pop()!;
    for (const o of hwys)
      if (!keep.has(o) && (ends(o).some((p) => near(p, h)) || ends(h).some((p) => near(p, o)))) {
        keep.add(o);
        queue.push(o);
      }
  }
  return defs.filter((d) => d.cls !== "highway" || keep.has(d));
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
