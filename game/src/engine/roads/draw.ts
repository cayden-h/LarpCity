// Road furniture drawn as objects so it sorts with cars and buildings:
// overpass decks, traffic signal heads (lit by the sim's signal plans), and
// stop and yield signs. Spec C replaces the drawings with pixel sprites.

import { Container, Graphics } from "pixi.js";
import { shade } from "../color";
import type { CityGrid } from "../grid";
import { depthOf, iso, tileCorners, flat } from "../iso";
import { minorArms, signalState, type Light, type SignalPlan } from "./control";
import type { Movement, RoadNet } from "./graph";
import { roadMarks, type Mark } from "./marks";
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

  // Overpass decks, one per overpass tile, facing along the road on top,
  // stamped with the real road markings of whichever road is up there
  // (never the highway underneath, which draws its own at grade).
  const deckMarks = new Map<string, Mark[]>();
  for (const m of roadMarks(net, () => false)) {
    if (m.hwy) continue;
    const mid = m.pts.reduce((s, p) => ({ x: s.x + p.x / m.pts.length, y: s.y + p.y / m.pts.length }), { x: 0, y: 0 });
    const tx = Math.floor(mid.x), ty = Math.floor(mid.y);
    if (grid.at(tx, ty) !== "O") continue;
    const key = `${tx},${ty}`;
    const list = deckMarks.get(key);
    if (list) list.push(m);
    else deckMarks.set(key, [m]);
  }
  const seen = new Set<string>();
  for (const road of new Set(net.segments.map((s) => s.road))) {
    if (road.cls === "highway") continue;
    const alongX = road.path[0][1] === road.path[1][1];
    for (const [x, y] of roadTiles(road)) {
      const key = `${x},${y}`;
      if (grid.at(x, y) !== "O" || seen.has(key)) continue;
      seen.add(key);
      const g = deck(grid, x, y, alongX, deckMarks.get(key) ?? []);
      g.zIndex = depthOf(x, y, 60);
      views.push(g);
      tintables.push(g);
    }
  }

  // A pole planted at the base offset, stepped outward along `side` until it
  // lands off any road tile (up to 1.5 extra tiles), or null if it never does.
  const poleSpot = (baseX: number, baseY: number, side: { x: number; y: number }): { x: number; y: number } | null => {
    for (let extra = 0; extra <= 1.5 + 1e-6; extra += 0.25) {
      const px = baseX + side.x * extra, py = baseY + side.y * extra;
      if (!grid.isRoad(Math.floor(px), Math.floor(py))) return { x: px, y: py };
    }
    return null;
  };

  for (const node of net.nodes) {
    const plan = sim.signals.get(node.id) ?? null;
    const minor = minorArms(node);
    for (const arm of node.arms) {
      const incoming = arm.seg.lanes.filter((l) => l.to === node);
      if (!incoming.length) continue;
      const din = { x: -arm.dir.x, y: -arm.dir.y }, right = { x: -din.y, y: din.x };
      const hw = arm.seg.width / 2;
      const along = arm.trim + 0.05;
      const rightX = node.p.x + arm.dir.x * along + right.x * (hw + 0.08);
      const rightY = node.p.y + arm.dir.y * along + right.y * (hw + 0.08);
      const leftX = node.p.x + arm.dir.x * along - right.x * (hw + 0.08);
      const leftY = node.p.y + arm.dir.y * along - right.y * (hw + 0.08);
      const spot = poleSpot(rightX, rightY, right) ?? poleSpot(leftX, leftY, { x: -right.x, y: -right.y });
      if (!spot) continue;
      const { x: px, y: py } = spot;
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

function deck(grid: CityGrid, x: number, y: number, alongX: boolean, marks: Mark[]): Graphics {
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
  // The deck road's real markings (center line, dividers, edges) stamped on top.
  for (const m of marks) {
    const pts = m.pts.map((p) => iso(p.x, p.y, DECK_Z));
    const color = m.color === "yellow" ? 0xf3d23b : 0xf2f2f2;
    if (m.kind === "quad") g.poly(flat(pts)).fill({ color, alpha: 0.88 });
    else {
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: m.width, color, alpha: 0.9 });
    }
  }
  return g;
}
