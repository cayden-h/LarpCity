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
