// The road graph built from RoadDefs: nodes where roads meet, straight
// segments between them, lanes offset from each segment's centerline, and
// movements (Bezier connectors) through each node with their conflicts.
// Lanes and movements are both "tracks" the traffic sim drives along.

import { controlKind, hasCrosswalks, type ControlKind } from "./control.ts";
import { bezier, pathsClose, Path, type P } from "./geometry.ts";
import { LANE_W, roadSpeed, roadWidth, type RoadDef } from "./types.ts";

export type NodeKind = "cross" | "bend" | "end" | "edge" | "merge";
export type Turn = "straight" | "left" | "right" | "uturn" | "merge" | "diverge";

export interface Arm {
  seg: Segment;
  /** Unit vector from the node along the arm. */
  dir: P;
  /** True when the segment starts at this node. */
  start: boolean;
  /** How far the segment is cut back from the node. */
  trim: number;
  crosswalk: boolean;
}

export interface RNode {
  id: number;
  p: P;
  kind: NodeKind;
  arms: Arm[];
  control: ControlKind;
  inCore: boolean;
  movements: Movement[];
}

export interface Segment {
  id: number;
  road: RoadDef;
  a: RNode;
  b: RNode;
  /** Untrimmed centerline ends (a ramp's end beside a highway is not at its node). */
  ca: P;
  cb: P;
  /** Trimmed centerline ends. */
  pa: P;
  pb: P;
  dir: P;
  width: number;
  lanes: Lane[];
}

export interface Lane {
  kind: "lane";
  tid: number;
  id: number;
  seg: Segment;
  forward: boolean;
  /** 0 is the leftmost lane (next to the center line). */
  index: number;
  count: number;
  path: Path;
  from: RNode;
  to: RNode;
  speed: number;
  out: Movement[];
  left: Lane | null;
  right: Lane | null;
  live: boolean;
}

export interface Movement {
  kind: "move";
  tid: number;
  id: number;
  node: RNode;
  from: Lane;
  to: Lane;
  turn: Turn;
  path: Path;
  speed: number;
  conflicts: Movement[];
  /** Higher goes first; set by control (Task 5). */
  priority: number;
  /** Arms whose crosswalk this movement crosses. */
  crosswalks: Arm[];
  flyover: boolean;
  /** A U-turn at the world's edge: cars leave the map here instead of turning. */
  portal: boolean;
  live: boolean;
}

export type Track = Lane | Movement;

export interface RoadNet {
  nodes: RNode[];
  segments: Segment[];
  lanes: Lane[];
  movements: Movement[];
  tracks: Track[];
}

export interface GraphOptions {
  /** The hand-made core, in the same coordinates as the roads. */
  core?: { x: number; y: number; w: number; h: number };
}

interface Stop {
  t: number;
  node: RNode;
}

interface Piece {
  road: RoadDef;
  a: P;
  b: P;
  horiz: boolean;
  hw: number;
  stops: Stop[];
  edgeA: boolean;
  edgeB: boolean;
}

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const cross = (a: P, b: P) => a.x * b.y - a.y * b.x;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: P): P => {
  const l = Math.hypot(a.x, a.y);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
const isHwy = (r: RoadDef) => r.cls === "highway";

export function buildGraph(roads: RoadDef[], opts: GraphOptions = {}): RoadNet {
  const nodes: RNode[] = [];
  const merges = new Set<RNode>();
  // Spatial hash for nodeAt: cells are 1 tile square, well over twice the 0.3
  // match radius, so any node within range of a point lies in its 3x3
  // neighborhood of cells. Keeps the same "first node created that matches"
  // semantics as the old linear scan by picking the lowest id among matches.
  const cellOf = (p: P) => `${Math.floor(p.x)},${Math.floor(p.y)}`;
  const cells = new Map<string, RNode[]>();
  const nodeAt = (p: P): RNode => {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    let best: RNode | null = null;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const n of bucket) if (dist(n.p, p) < 0.3 && (!best || n.id < best.id)) best = n;
      }
    if (best) return best;
    const n: RNode = { id: nodes.length, p: { ...p }, kind: "end", arms: [], control: "none", inCore: false, movements: [] };
    nodes.push(n);
    const key = cellOf(n.p);
    const bucket = cells.get(key);
    if (bucket) bucket.push(n);
    else cells.set(key, [n]);
    return n;
  };

  // 1. Straight pieces.
  const pieces: Piece[] = [];
  for (const road of roads) {
    const hw = roadWidth(road) / 2;
    for (let k = 0; k + 1 < road.path.length; k++) {
      const [ax, ay] = road.path[k], [bx, by] = road.path[k + 1];
      if (ax === bx && ay === by) continue;
      pieces.push({
        road, a: { x: ax, y: ay }, b: { x: bx, y: by }, horiz: ay === by, hw, stops: [],
        edgeA: k === 0 && !!road.edge?.[0], edgeB: k + 2 === road.path.length && !!road.edge?.[1],
      });
    }
  }
  const along = (pc: Piece, p: P) => (pc.horiz ? p.x : p.y);
  const lo = (pc: Piece) => Math.min(along(pc, pc.a), along(pc, pc.b));
  const hi = (pc: Piece) => Math.max(along(pc, pc.a), along(pc, pc.b));
  /** Move the piece end nearest v (an along-axis coordinate) out or in to v. */
  const snapEnd = (pc: Piece, v: number) => {
    if (v >= lo(pc) && v <= hi(pc)) return;
    const endA = Math.abs(along(pc, pc.a) - v) < Math.abs(along(pc, pc.b) - v);
    const e = endA ? pc.a : pc.b;
    if (pc.horiz) e.x = v;
    else e.y = v;
  };
  const tOf = (pc: Piece, p: P) => dist(pc.a, p);

  // 2. Junctions between pieces.
  const pending: { pc: Piece; p: P; merge?: boolean }[] = [];
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const A = pieces[i], B = pieces[j];
      if (A.road === B.road) continue;
      if (A.horiz !== B.horiz) {
        const H = A.horiz ? A : B, V = A.horiz ? B : A;
        const x = V.a.x, y = H.a.y;
        const eH = V.hw + 0.51, eV = H.hw + 0.51;
        if (x < lo(H) - eH || x > hi(H) + eH || y < lo(V) - eV || y > hi(V) + eV) continue;
        const through = (pc: Piece, v: number) => v > lo(pc) + 0.51 && v < hi(pc) - 0.51;
        const hwyH = isHwy(H.road), hwyV = isHwy(V.road);
        if (hwyH !== hwyV) continue; // overpass, or a street dead-ending beside a highway
        if (hwyH && hwyV && through(H, x) && through(V, y)) continue; // highways cross on a flyover
        snapEnd(H, x);
        snapEnd(V, y);
        const p = { x, y };
        pending.push({ pc: H, p }, { pc: V, p });
        continue;
      }
      const across = (pc: Piece) => (pc.horiz ? pc.a.y : pc.a.x);
      const gapAcross = Math.abs(across(A) - across(B));
      if (gapAcross < 0.01) {
        // Collinear: join ends at most one tile apart.
        const [first, second] = lo(A) <= lo(B) ? [A, B] : [B, A];
        const gap = lo(second) - hi(first);
        if (gap < -0.01 || gap > 1.01) continue;
        const v = (hi(first) + lo(second)) / 2;
        snapEnd(first, v);
        snapEnd(second, v);
        const p = first.horiz ? { x: v, y: across(first) } : { x: across(first), y: v };
        pending.push({ pc: first, p }, { pc: second, p });
        continue;
      }
      // A ramp end beside a highway.
      const ramp = A.road.cls === "ramp" ? A : B.road.cls === "ramp" ? B : null;
      const hwy = ramp === A ? B : A;
      if (!ramp || !isHwy(hwy.road) || gapAcross > hwy.hw + 0.51) continue;
      // Only the ramp's highway end joins: the first point of an off-ramp, the last of an on-ramp.
      const road = ramp.road;
      const isFirst = ramp.a.x === road.path[0][0] && ramp.a.y === road.path[0][1];
      const isLast = ramp.b.x === road.path[road.path.length - 1][0] && ramp.b.y === road.path[road.path.length - 1][1];
      const ends = road.ramp === "off" ? (isFirst ? [ramp.a] : []) : road.ramp === "on" ? (isLast ? [ramp.b] : []) : [];
      for (const e of ends) {
        const v = along(hwy, e);
        if (v <= lo(hwy) + 1.5 || v >= hi(hwy) - 1.5) continue;
        const p = hwy.horiz ? { x: v, y: across(hwy) } : { x: across(hwy), y: v };
        const n = nodeAt(p);
        merges.add(n);
        pending.push({ pc: hwy, p });
        ramp.stops.push({ t: tOf(ramp, e), node: n });
      }
    }
  for (const { pc, p } of pending) pc.stops.push({ t: tOf(pc, p), node: nodeAt(p) });
  const edgeNodes = new Set<RNode>();
  for (const pc of pieces) {
    const len = dist(pc.a, pc.b);
    for (const [t, p, edge] of [[0, pc.a, pc.edgeA], [len, pc.b, pc.edgeB]] as const) {
      if (pc.stops.some((s) => Math.abs(s.t - t) < 0.3)) continue;
      const n = nodeAt(p);
      if (edge) edgeNodes.add(n);
      pc.stops.push({ t, node: n });
    }
  }

  // 3. Segments between consecutive stops.
  let segments: Segment[] = [];
  for (const pc of pieces) {
    const stops = pc.stops.sort((a, b) => a.t - b.t).filter((s, k, arr) => k === 0 || s.node !== arr[k - 1].node);
    const dir = unit(sub(pc.b, pc.a));
    for (let k = 0; k + 1 < stops.length; k++) {
      const s0 = stops[k], s1 = stops[k + 1];
      if (s1.t - s0.t < 1e-6) continue;
      const ca = add(pc.a, mul(dir, s0.t)), cb = add(pc.a, mul(dir, s1.t));
      segments.push({ id: 0, road: pc.road, a: s0.node, b: s1.node, ca, cb, pa: ca, pb: cb, dir, width: pc.hw * 2, lanes: [] });
    }
  }

  // 4-5. Arms, kinds, control, and trims; drop stubs until stable.
  const core = opts.core;
  for (let pass = 0; pass < 4; pass++) {
    for (const n of nodes) n.arms = [];
    for (const s of segments) {
      s.a.arms.push({ seg: s, dir: s.dir, start: true, trim: 0, crosswalk: false });
      s.b.arms.push({ seg: s, dir: mul(s.dir, -1), start: false, trim: 0, crosswalk: false });
    }
    for (const n of nodes) {
      n.kind = merges.has(n) ? "merge" : n.arms.length >= 3 ? "cross" : n.arms.length === 2 ? "bend" : edgeNodes.has(n) ? "edge" : "end";
      n.inCore = !!core && n.p.x >= core.x && n.p.x <= core.x + core.w && n.p.y >= core.y && n.p.y <= core.y + core.h;
      const infos = n.arms.map((a) => ({ cls: a.seg.road.cls, axis: (Math.abs(a.dir.x) > 0.5 ? 0 : 1) as 0 | 1 }));
      n.control = controlKind(n.kind, infos, n.inCore);
      const walks = hasCrosswalks(n.control);
      for (const a of n.arms) {
        const others = n.arms.filter((o) => o !== a && Math.abs(dot(o.dir, a.dir)) < 0.5);
        if (n.kind === "merge") a.trim = a.seg.road.cls === "ramp" ? 0 : 1.5;
        else if (n.kind === "cross" || n.kind === "bend") a.trim = Math.max(0, ...others.map((o) => o.seg.width / 2)) + (walks ? 0.35 : 0);
        else a.trim = 0;
        a.crosswalk = walks;
      }
    }
    const trimOf = (s: Segment, n: RNode) => n.arms.find((a) => a.seg === s)!.trim;
    const kept = segments.filter((s) => dist(s.ca, s.cb) - trimOf(s, s.a) - trimOf(s, s.b) >= 0.25);
    if (kept.length === segments.length) break;
    segments = kept;
  }
  segments.forEach((s, i) => {
    s.id = i;
    const ta = s.a.arms.find((a) => a.seg === s)!.trim, tb = s.b.arms.find((a) => a.seg === s)!.trim;
    s.pa = add(s.ca, mul(s.dir, ta));
    s.pb = sub(s.cb, mul(s.dir, tb));
  });
  const liveNodes = nodes.filter((n) => n.arms.length > 0);
  liveNodes.forEach((n, i) => (n.id = i));

  // 6. Lanes.
  const lanes: Lane[] = [];
  for (const s of segments) {
    const n = { x: -s.dir.y, y: s.dir.x }; // right of travel along the segment
    const [f, r] = s.road.lanes;
    const oneWay = r === 0;
    const make = (forward: boolean, index: number, count: number, off: number): Lane => {
      const a = add(s.pa, mul(n, off)), b = add(s.pb, mul(n, off));
      const lane: Lane = {
        kind: "lane", tid: 0, id: lanes.length, seg: s, forward, index, count,
        path: new Path(forward ? [a, b] : [b, a]), from: forward ? s.a : s.b, to: forward ? s.b : s.a,
        speed: roadSpeed(s.road), out: [], left: null, right: null, live: false,
      };
      lanes.push(lane);
      s.lanes.push(lane);
      return lane;
    };
    const fwd = Array.from({ length: f }, (_, k) => make(true, k, f, oneWay ? (k - (f - 1) / 2) * LANE_W : (k + 0.5) * LANE_W));
    const back = Array.from({ length: r }, (_, k) => make(false, k, r, -(k + 0.5) * LANE_W));
    for (const group of [fwd, back])
      group.forEach((l, k) => {
        l.left = group[k - 1] ?? null;
        l.right = group[k + 1] ?? null;
      });
  }

  // 7. Movements.
  const movements: Movement[] = [];
  const addMove = (node: RNode, from: Lane, to: Lane, turn: Turn) => {
    const p0 = from.path.at(from.path.length), p3 = to.path.at(0);
    const din = { x: Math.cos(p0.h), y: Math.sin(p0.h) }, dout = { x: Math.cos(p3.h), y: Math.sin(p3.h) };
    const k = turn === "uturn" ? 0.6 : dist(p0, p3) * 0.4;
    const path = new Path(bezier(p0, add(p0, mul(din, k)), sub(p3, mul(dout, k)), p3));
    const slow = Math.min(from.speed, to.speed);
    const speed = turn === "uturn" ? 0.35 : turn === "left" || turn === "right" ? (node.kind === "bend" ? slow * 0.75 : Math.min(0.55, slow)) : slow;
    const allHwy = node.arms.every((a) => isHwy(a.seg.road));
    const m: Movement = {
      kind: "move", tid: 0, id: movements.length, node, from, to, turn, path, speed, conflicts: [], priority: 2,
      crosswalks: node.arms.filter((a) => a.crosswalk && (a.seg === from.seg || a.seg === to.seg)),
      flyover: allHwy && turn === "left", portal: node.kind === "edge", live: false,
    };
    movements.push(m);
    node.movements.push(m);
    from.out.push(m);
  };
  for (const node of liveNodes) {
    // Each arm's lanes into and out of this node, sorted once per arm and reused across
    // every (ai, ao) pair below instead of refiltering and resorting per pair.
    const insByArm: Lane[][] = node.arms.map((a) => a.seg.lanes.filter((l) => l.to === node).sort((x, y) => x.index - y.index));
    const outsByArm: Lane[][] = node.arms.map((a) => a.seg.lanes.filter((l) => l.from === node).sort((x, y) => x.index - y.index));
    const ins = (a: Arm) => insByArm[node.arms.indexOf(a)];
    const outs = (a: Arm) => outsByArm[node.arms.indexOf(a)];
    if (node.kind === "merge") {
      const rampArm = node.arms.find((a) => a.seg.road.cls === "ramp");
      const hwyArms = node.arms.filter((a) => a !== rampArm);
      for (const hin of hwyArms) {
        const hout = hwyArms.find((a) => a !== hin);
        if (!hout) continue;
        const I = ins(hin), O = outs(hout);
        I.forEach((l, k) => O.length && addMove(node, l, O[Math.min(k, O.length - 1)], "straight"));
      }
      if (!rampArm) continue;
      const rampSide = sub(rampArm.start ? rampArm.seg.ca : rampArm.seg.cb, node.p);
      for (const rl of rampArm.seg.lanes) {
        const rdir = unit(sub(rl.path.at(rl.path.length), rl.path.at(0)));
        if (rl.to === node) {
          for (const hout of hwyArms) {
            const O = outs(hout);
            if (O.length && dot(hout.dir, rdir) > 0.5) addMove(node, rl, O[O.length - 1], "merge");
          }
        } else {
          for (const hin of hwyArms) {
            const I = ins(hin);
            if (!I.length) continue;
            const din = mul(hin.dir, -1);
            if (dot(din, rdir) > 0.5 && cross(din, rampSide) > 0) addMove(node, I[I.length - 1], rl, "diverge");
          }
        }
      }
      continue;
    }
    for (const ai of node.arms)
      for (const ao of node.arms) {
        const I = ins(ai), O = outs(ao);
        if (!I.length || !O.length) continue;
        if (ai === ao) {
          if (node.arms.length === 1) addMove(node, I[0], O[0], "uturn");
          continue;
        }
        const din = mul(ai.dir, -1), dout = ao.dir;
        const d = dot(din, dout);
        if (d < -0.7) continue;
        const bendTurn: Turn = d > 0.7 ? "straight" : cross(din, dout) > 0 ? "right" : "left";
        // A bend (a corner of one road, or two roads meeting end to end) keeps every lane.
        if (d > 0.7 || node.kind === "bend") I.forEach((l, k) => addMove(node, l, O[Math.min(k, O.length - 1)], bendTurn));
        else if (cross(din, dout) > 0) addMove(node, I[I.length - 1], O[O.length - 1], "right");
        else addMove(node, I[0], O[0], "left");
      }
  }

  // 8. Conflicts.
  for (const node of liveNodes) {
    const ms = node.movements;
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i], b = ms[j];
        if (a.from === b.from) continue;
        const clash = a.to === b.to || (!a.flyover && !b.flyover && pathsClose(a.path, b.path, 0.3));
        if (clash) {
          a.conflicts.push(b);
          b.conflicts.push(a);
        }
      }
  }

  // 9. The largest strongly connected set of lanes is live.
  markLive(lanes);
  for (const m of movements) m.live = m.from.live && m.to.live;

  const tracks: Track[] = [...lanes, ...movements];
  tracks.forEach((t, i) => (t.tid = i));
  return { nodes: liveNodes, segments, lanes, movements, tracks };
}

/** Tarjan's algorithm, iterative: lanes link through movements and lane changes. */
function markLive(lanes: Lane[]): void {
  const next = (l: Lane): Lane[] => [...l.out.map((m) => m.to), ...(l.left ? [l.left] : []), ...(l.right ? [l.right] : [])];
  const index = new Map<Lane, number>(), low = new Map<Lane, number>(), onStack = new Set<Lane>();
  const stack: Lane[] = [];
  let counter = 0;
  let best: Lane[] = [];
  for (const root of lanes) {
    if (index.has(root)) continue;
    const work: { l: Lane; i: number; succ: Lane[] }[] = [{ l: root, i: 0, succ: next(root) }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      if (top.i < top.succ.length) {
        const w = top.succ[top.i++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ l: w, i: 0, succ: next(w) });
        } else if (onStack.has(w)) low.set(top.l, Math.min(low.get(top.l)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].l;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.l)!));
      }
      if (low.get(top.l) === index.get(top.l)) {
        const comp: Lane[] = [];
        let w: Lane;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.l);
        if (comp.length > best.length) best = comp;
      }
    }
  }
  for (const l of best) l.live = true;
}
