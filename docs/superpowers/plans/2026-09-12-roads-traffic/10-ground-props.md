# Task 10: Markings from the network, overpass decks, signals and signs

**Files:**
- Create: `game/src/engine/roads/marks.ts` (pure geometry of every road marking)
- Create: `game/src/engine/roads/draw.ts` (overpass decks, signal heads, stop and yield signs)
- Modify: `game/src/engine/ground.ts` (markings from the network; bridge railings on outer edges only)
- Modify: `game/src/engine/scene.ts` (pass the network to `Ground`; add the props)
- Test: `game/tests/roads-marks.test.ts`

Markings, per segment and node:

| Where | Marking |
|---|---|
| Two-way 1-tile road | Dashed yellow center line |
| Arterial, highway | Double solid yellow center line |
| Between lanes of one direction | Dashed white |
| Highway and ramp edges | Solid white |
| Signal, all-way stop, minor arm of a stop | White stop bar at each incoming lane's end |
| Minor arm of a yield | Yield teeth |
| Signal and all-way nodes | Zebra crosswalk on every arm |
| Signal approach, leftmost of 2+ lanes with a left turn | Left-turn arrow |

Markings over bridge tiles are drawn at deck height in the bridge layer; on overpass tiles the deck object draws the center line.

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-marks.test.ts`:

```ts
// Road markings come from the network. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/engine/roads/graph.ts";
import { roadMarks } from "../src/engine/roads/marks.ts";
import type { RoadDef } from "../src/engine/roads/types.ts";

const noBridge = () => false;

test("a signal has crosswalks on every arm and a stop bar on every incoming lane", () => {
  const net = buildGraph([
    { id: "x", cls: "arterial", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] } as RoadDef,
    { id: "y", cls: "arterial", path: [[15, 0.5], [15, 30.5]], lanes: [2, 2] } as RoadDef,
  ]);
  const marks = roadMarks(net, noBridge);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  const near = (m: { pts: { x: number; y: number }[] }) => Math.hypot(m.pts[0].x - node.p.x, m.pts[0].y - node.p.y) < 3;
  assert.equal(marks.filter((m) => m.tag === "stop" && near(m)).length, 8);
  for (const arm of node.arms) {
    const d = arm.dir;
    const onArm = marks.filter((m) => m.tag === "crosswalk" && near(m) && (m.pts[0].x - node.p.x) * d.x + (m.pts[0].y - node.p.y) * d.y > 0.5);
    assert.ok(onArm.length >= 5, `arm (${d.x},${d.y}) has ${onArm.length} stripes`);
  }
  assert.ok(marks.some((m) => m.tag === "arrow"), "left-turn arrows");
  assert.ok(marks.filter((m) => m.tag === "center" && m.color === "yellow").length > 0);
});

test("a stop T puts the stop bar only on the stem", () => {
  const net = buildGraph([
    { id: "a", cls: "arterial", path: [[0.5, 7], [15.5, 7]], lanes: [2, 2] } as RoadDef,
    { id: "s", cls: "local", path: [[7.5, 8.5], [7.5, 14.5]], lanes: [1, 1] } as RoadDef,
  ]);
  const stops = roadMarks(net, noBridge).filter((m) => m.tag === "stop");
  assert.equal(stops.length, 1);
  assert.ok(Math.abs(stops[0].pts[0].x - 7.5) < 0.5 && stops[0].pts[0].y > 7.5);
  assert.equal(roadMarks(net, noBridge).filter((m) => m.tag === "crosswalk").length, 0);
});

test("a local street gets a dashed yellow center line and nothing else", () => {
  const net = buildGraph([{ id: "a", cls: "local", path: [[0.5, 2.5], [10.5, 2.5]], lanes: [1, 1] } as RoadDef]);
  const marks = roadMarks(net, noBridge);
  assert.ok(marks.every((m) => m.tag === "center" && m.color === "yellow"));
  assert.ok(marks.length >= 18 && marks.length <= 22, `${marks.length} dashes over 10 tiles`);
});

test("marks over bridge tiles are raised", () => {
  const net = buildGraph([{ id: "a", cls: "local", path: [[0.5, 2.5], [10.5, 2.5]], lanes: [1, 1] } as RoadDef]);
  const marks = roadMarks(net, (x) => x >= 4 && x < 6);
  assert.ok(marks.some((m) => m.raised) && marks.some((m) => !m.raised));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-marks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `game/src/engine/roads/marks.ts`**

```ts
// Every road marking as tile-space geometry: center lines, lane dividers,
// edge lines, stop bars, yield teeth, crosswalks, and turn arrows. The
// ground (ground.ts) projects and paints them chunk by chunk.

import { minorArms } from "./control.ts";
import type { P } from "./geometry.ts";
import type { RoadNet } from "./graph.ts";
import { LANE_W } from "./types.ts";

export type MarkColor = "white" | "yellow";
export type MarkTag = "center" | "divider" | "edge" | "stop" | "yield" | "crosswalk" | "arrow";

export interface Mark {
  /** A line (2 or more points, stroked) or a quad (4 points, filled). */
  kind: "line" | "quad";
  pts: P[];
  color: MarkColor;
  width: number;
  /** On a bridge deck. */
  raised: boolean;
  tag: MarkTag;
}

export function roadMarks(net: RoadNet, isBridge: (x: number, y: number) => boolean): Mark[] {
  const out: Mark[] = [];
  const raisedAt = (p: P) => isBridge(Math.floor(p.x), Math.floor(p.y));
  const push = (kind: Mark["kind"], pts: P[], color: MarkColor, width: number, tag: MarkTag) => {
    const mid = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    out.push({ kind, pts, color, width, raised: raisedAt(mid), tag });
  };
  /** A line from a to b shifted `off` to the right; dashed when dash > 0, else in pieces of at most one tile. */
  const line = (a: P, b: P, off: number, color: MarkColor, dash: number, gap: number, width: number, tag: MarkTag) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.05) return;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -d.y, y: d.x };
    const at = (s: number): P => ({ x: a.x + d.x * s + n.x * off, y: a.y + d.y * s + n.y * off });
    const step = dash > 0 ? dash + gap : 1;
    for (let s = dash > 0 ? gap / 2 : 0; s < len - 1e-6; s += step) push("line", [at(s), at(Math.min(len, s + (dash > 0 ? dash : step)))], color, width, tag);
  };
  const quad = (c: P, along: P, across: P, l: number, w: number, color: MarkColor, tag: MarkTag) => {
    const p = (u: number, v: number): P => ({ x: c.x + along.x * u + across.x * v, y: c.y + along.y * u + across.y * v });
    push("quad", [p(-l / 2, -w / 2), p(l / 2, -w / 2), p(l / 2, w / 2), p(-l / 2, w / 2)], color, 0, tag);
  };

  for (const s of net.segments) {
    const cls = s.road.cls, [f, r] = s.road.lanes, hw = s.width / 2;
    if (r > 0) {
      if (cls === "arterial" || cls === "highway") {
        line(s.pa, s.pb, 0.04, "yellow", 0, 0, 1.5, "center");
        line(s.pa, s.pb, -0.04, "yellow", 0, 0, 1.5, "center");
      } else line(s.pa, s.pb, 0, "yellow", 0.28, 0.22, 2, "center");
    }
    for (let k = 1; k < f; k++) line(s.pa, s.pb, (r > 0 ? k : k - f / 2) * LANE_W, "white", 0.28, 0.32, 1.5, "divider");
    for (let k = 1; k < r; k++) line(s.pa, s.pb, -k * LANE_W, "white", 0.28, 0.32, 1.5, "divider");
    if (cls === "highway" || cls === "ramp") {
      line(s.pa, s.pb, hw - 0.07, "white", 0, 0, 1.5, "edge");
      line(s.pa, s.pb, -(hw - 0.07), "white", 0, 0, 1.5, "edge");
    }
  }

  for (const node of net.nodes) {
    const minor = minorArms(node);
    for (const arm of node.arms) {
      const hw = arm.seg.width / 2;
      const d = arm.dir, n = { x: -d.y, y: d.x };
      if (arm.crosswalk) {
        const mid = arm.trim - 0.19;
        for (let o = -hw + 0.1; o <= hw - 0.1 + 1e-6; o += 0.2)
          quad({ x: node.p.x + d.x * mid + n.x * o, y: node.p.y + d.y * mid + n.y * o }, d, n, 0.28, 0.09, "white", "crosswalk");
      }
      const stops = node.control === "signal" || node.control === "allway" || (node.control === "stop" && minor.has(arm));
      const yields = node.control === "yield" && minor.has(arm);
      for (const l of arm.seg.lanes) {
        if (l.to !== node) continue;
        const e = l.path.at(l.path.length);
        const t = { x: Math.cos(e.h), y: Math.sin(e.h) }, across = { x: -t.y, y: t.x };
        if (stops) quad({ x: e.x - t.x * 0.04, y: e.y - t.y * 0.04 }, t, across, 0.07, 0.46, "white", "stop");
        if (yields)
          for (const o of [-0.15, 0, 0.15]) {
            const c = { x: e.x - t.x * 0.08 + across.x * o, y: e.y - t.y * 0.08 + across.y * o };
            push("quad", [
              { x: c.x - t.x * 0.06 - across.x * 0.05, y: c.y - t.y * 0.06 - across.y * 0.05 },
              { x: c.x - t.x * 0.06 + across.x * 0.05, y: c.y - t.y * 0.06 + across.y * 0.05 },
              { x: c.x + t.x * 0.06, y: c.y + t.y * 0.06 },
              { x: c.x + t.x * 0.06, y: c.y + t.y * 0.06 },
            ], "white", 0, "yield");
          }
        if (node.control === "signal" && l.count >= 2 && l.index === 0 && l.out.some((m) => m.turn === "left") && l.path.length > 1.4) {
          const tip = l.path.at(l.path.length - 0.7), tail = l.path.at(l.path.length - 1.1);
          const left = { x: t.y, y: -t.x };
          const bend = { x: tip.x + left.x * 0.14, y: tip.y + left.y * 0.14 };
          push("line", [tail, tip, bend], "white", 1.5, "arrow");
          push("line", [{ x: bend.x - left.x * 0.06 + t.x * 0.06, y: bend.y - left.y * 0.06 + t.y * 0.06 }, bend, { x: bend.x - left.x * 0.06 - t.x * 0.06, y: bend.y - left.y * 0.06 - t.y * 0.06 }], "white", 1.5, "arrow");
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/roads-marks.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Paint the markings in `game/src/engine/ground.ts`**

Imports: add

```ts
import type { RoadNet } from "./roads/graph";
import { roadMarks, type Mark } from "./roads/marks";
```

Fields and constructor: add `private readonly marksByChunk = new Map<string, Mark[]>();`, give the constructor a fourth parameter `net: RoadNet | null = null`, and at its end:

```ts
    if (net)
      for (const m of roadMarks(net, (x, y) => grid.at(x, y) === "B")) {
        const p = m.pts[0];
        const key = `${Math.floor(p.x / CHUNK) * CHUNK},${Math.floor(p.y / CHUNK) * CHUNK}`;
        const list = this.marksByChunk.get(key) ?? [];
        list.push(m);
        this.marksByChunk.set(key, list);
      }
```

In `drawChunk`, create `const raisedMarks = new Graphics();`, add it last in `l.addChild(tops, marks, bridges, raisedMarks);`, and before building the containers paint the chunk's marks:

```ts
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
```

Replace `drawRoad` with the curbs and tram rails only (the network draws everything else):

```ts
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
```

In `drawBridge`, decide the direction by the longer run of bridge tiles, put railings only on edges with no bridge beside them, and drop the old center dash (the network's raised marks replace it):

```ts
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
```

- [ ] **Step 6: Create `game/src/engine/roads/draw.ts`**

```ts
// Road furniture drawn as objects so it sorts with cars and buildings:
// overpass decks, traffic signal heads (lit by the sim's signal plans), and
// stop and yield signs. Spec C replaces the drawings with pixel sprites.

import { Container, Graphics } from "pixi.js";
import { shade } from "../color";
import type { CityGrid } from "../grid";
import { depthOf, iso, tileCorners, flat } from "../iso";
import { minorArms, signalState, type Light, type SignalPlan } from "./control";
import type { Movement, RoadNet } from "./graph";
import { DECK_Z } from "./pose";
import type { Sim } from "./sim";
import { roadTiles } from "./types";

export interface RoadProps {
  views: Container[];
  /** Parts that take the time-of-day tint (lamps are left out so they glow). */
  tintables: Container[];
  update(): void;
}

interface Head {
  lamps: Graphics;
  plan: SignalPlan;
  thru: Movement;
  left: Movement | null;
  x: number;
  y: number;
  state: string;
}

export function buildRoadProps(net: RoadNet, sim: Sim, grid: CityGrid): RoadProps {
  const views: Container[] = [], tintables: Container[] = [], heads: Head[] = [];

  // Overpass decks, one per overpass tile, facing along the road on top.
  const seen = new Set<string>();
  for (const road of new Set(net.segments.map((s) => s.road))) {
    if (road.cls === "highway") continue;
    const alongX = road.path[0][1] === road.path[1][1];
    for (const [x, y] of roadTiles(road)) {
      const key = `${x},${y}`;
      if (grid.at(x, y) !== "O" || seen.has(key)) continue;
      seen.add(key);
      const g = deck(grid, x, y, alongX, road.cls === "arterial");
      g.zIndex = depthOf(x, y, 60);
      views.push(g);
      tintables.push(g);
    }
  }

  for (const node of net.nodes) {
    const plan = sim.signals.get(node.id) ?? null;
    const minor = minorArms(node);
    for (const arm of node.arms) {
      const incoming = arm.seg.lanes.filter((l) => l.to === node);
      if (!incoming.length) continue;
      const din = { x: -arm.dir.x, y: -arm.dir.y }, right = { x: -din.y, y: din.x };
      const hw = arm.seg.width / 2;
      const px = node.p.x + arm.dir.x * (arm.trim + 0.05) + right.x * (hw + 0.08);
      const py = node.p.y + arm.dir.y * (arm.trim + 0.05) + right.y * (hw + 0.08);
      const base = iso(px, py);
      const pole = new Container();
      const g = new Graphics();
      pole.addChild(g);
      pole.zIndex = (px + py) * 100 + 55;
      if (plan) {
        const moves = incoming.flatMap((l) => l.out);
        const thru = moves.find((m) => m.turn === "straight") ?? moves[0];
        const left = moves.find((m) => m.turn === "left" && plan.phases.some((p) => p.green.has(m))) ?? null;
        g.rect(base.x - 0.75, base.y - 22, 1.5, 22).fill(0x4a4f57);
        g.rect(base.x - 2.6, base.y - 31, 5.2, 11).fill(0x23262b);
        if (left) g.rect(base.x + 2.6, base.y - 24, 4, 4).fill(0x23262b);
        const lamps = new Graphics();
        pole.addChild(lamps);
        heads.push({ lamps, plan, thru, left, x: base.x, y: base.y, state: "" });
      } else if (node.control === "allway" || (node.control === "stop" && minor.has(arm))) {
        g.rect(base.x - 0.6, base.y - 14, 1.2, 14).fill(0x8d949c);
        const oct = Array.from({ length: 8 }, (_, k) => {
          const a = (k * Math.PI) / 4 + Math.PI / 8;
          return [base.x + Math.cos(a) * 3.4, base.y - 17 + Math.sin(a) * 3.4];
        }).flat();
        g.poly(oct).fill(0xd32f2f).stroke({ width: 0.8, color: 0xffffff });
      } else if (node.control === "yield" && minor.has(arm)) {
        g.rect(base.x - 0.6, base.y - 14, 1.2, 14).fill(0x8d949c);
        g.poly([base.x - 3.6, base.y - 20, base.x + 3.6, base.y - 20, base.x, base.y - 14]).fill(0xffffff).stroke({ width: 1, color: 0xd32f2f });
      } else continue;
      views.push(pole);
      tintables.push(g);
    }
  }

  const color = (on: boolean, c: number) => (on ? c : shade(c, 0.28));
  return {
    views,
    tintables,
    update() {
      for (const h of heads) {
        const l: Light = signalState(h.plan, h.thru, sim.time);
        const ll: Light | "" = h.left ? signalState(h.plan, h.left, sim.time) : "";
        const state = l + ll;
        if (state === h.state) continue;
        h.state = state;
        const g = h.lamps;
        g.clear();
        g.circle(h.x, h.y - 28.5, 1.5).fill(color(l === "R", 0xff3b30));
        g.circle(h.x, h.y - 25.5, 1.5).fill(color(l === "Y", 0xffc107));
        g.circle(h.x, h.y - 22.5, 1.5).fill(color(l === "G" || l === "P", 0x3ddc84));
        if (h.left) g.poly([h.x + 5.8, h.y - 22.2, h.x + 3.4, h.y - 22.2, h.x + 4.6, h.y - 23.6]).fill(color(ll === "G", ll === "Y" ? 0xffc107 : 0x3ddc84));
      }
    },
  };
}

function deck(grid: CityGrid, x: number, y: number, alongX: boolean, doubleYellow: boolean): Graphics {
  const g = new Graphics();
  const top = 0x5b616b;
  const [T, R, B, L] = tileCorners(x, y, DECK_Z);
  const mid = iso(x + 0.5, y + 0.5, DECK_Z);
  g.rect(mid.x - 4, mid.y, 8, DECK_Z + 3).fill(0xb9b3a8);
  g.poly([L.x, L.y, B.x, B.y, B.x, B.y + 6, L.x, L.y + 6]).fill(shade(top, 0.8));
  g.poly([B.x, B.y, R.x, R.y, R.x, R.y + 6, B.x, B.y + 6]).fill(shade(top, 0.62));
  g.poly(flat([T, R, B, L])).fill(top);
  // Railings where the deck ends (no more overpass beside it).
  const edges: [typeof T, typeof T, number, number][] = alongX ? [[T, R, x, y - 1], [L, B, x, y + 1]] : [[T, L, x - 1, y], [R, B, x + 1, y]];
  for (const [p, q, nx, ny] of edges) if (grid.at(nx, ny) !== "O") g.moveTo(p.x, p.y - 4).lineTo(q.x, q.y - 4).stroke({ width: 1.5, color: 0xc9ccd2 });
  // The center line where the road's centerline crosses this tile.
  const yellow = 0xf3d23b;
  if (alongX) {
    const onEdge = doubleYellow ? grid.at(x, y + 1) === "O" : true;
    if (onEdge) {
      const cy = doubleYellow ? y + 1 : y + 0.5;
      const a = iso(x, cy, DECK_Z), b = iso(x + 1, cy, DECK_Z);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: yellow });
    }
  } else {
    const onEdge = doubleYellow ? grid.at(x + 1, y) === "O" : true;
    if (onEdge) {
      const cx = doubleYellow ? x + 1 : x + 0.5;
      const a = iso(cx, y, DECK_Z), b = iso(cx, y + 1, DECK_Z);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: yellow });
    }
  }
  return g;
}
```

- [ ] **Step 7: Wire the scene**

In `game/src/engine/scene.ts`:

- Import `import { buildRoadProps, type RoadProps } from "./roads/draw";`.
- Add the field `private readonly roadProps: RoadProps;`.
- Make sure `this.net` is built before the `Ground`, and pass it: `this.ground = new Ground(this.grid, this.city.palette, seed, this.net);`.
- After `this.traffic = new Traffic(...)`:

```ts
    this.roadProps = buildRoadProps(this.net, this.traffic.sim, this.grid);
    for (const v of this.roadProps.views) {
      v.cullable = true;
      this.objects.addChild(v);
    }
```

- In the tint block of `update()`, add `for (const t of this.roadProps.tintables) t.tint = tint;`.
- After `this.traffic.update(dt, night);` add `this.roadProps.update();`.

- [ ] **Step 8: Typecheck, suite, and a close look**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.
Run `npm run dev` and inspect, day and night, at zoom 1 and max zoom:

- an SF arterial signal: double yellow, lane dividers, crosswalks on all arms, stop bars, left arrows, and signal heads that change with the traffic;
- a local street T: the stop sign and stop bar on the stem only;
- an all-way stop in the core: four stop signs and four crosswalks;
- a highway interchange: edge lines, ramps, and the overpass deck with its railings, with highway cars passing under it and arterial cars over it;
- a 2-tile arterial bridge: railings only on the outer edges, and the marks on the deck.

Fix anything misaligned (a mark off by a pixel counts).

- [ ] **Step 9: Commit**

```bash
git add src/engine/roads/marks.ts src/engine/roads/draw.ts src/engine/ground.ts src/engine/scene.ts tests/roads-marks.test.ts
git commit -m "Roads: markings from the network, signals, stop signs, and overpass decks"
```
