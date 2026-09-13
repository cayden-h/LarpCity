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
  /** On a highway (as opposed to the arterial or street that overpasses it). */
  hwy: boolean;
  tag: MarkTag;
}

export function roadMarks(net: RoadNet, isBridge: (x: number, y: number) => boolean): Mark[] {
  const out: Mark[] = [];
  const raisedAt = (p: P) => isBridge(Math.floor(p.x), Math.floor(p.y));
  const push = (kind: Mark["kind"], pts: P[], color: MarkColor, width: number, tag: MarkTag, hwy: boolean) => {
    const mid = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    out.push({ kind, pts, color, width, raised: raisedAt(mid), hwy, tag });
  };
  /** A line from a to b shifted `off` to the right; dashed when dash > 0, else in pieces of at most one tile. */
  const line = (a: P, b: P, off: number, color: MarkColor, dash: number, gap: number, width: number, tag: MarkTag, hwy: boolean) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.05) return;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -d.y, y: d.x };
    const at = (s: number): P => ({ x: a.x + d.x * s + n.x * off, y: a.y + d.y * s + n.y * off });
    const step = dash > 0 ? dash + gap : 1;
    for (let s = dash > 0 ? gap / 2 : 0; s < len - 1e-6; s += step) push("line", [at(s), at(Math.min(len, s + (dash > 0 ? dash : step)))], color, width, tag, hwy);
  };
  const quad = (c: P, along: P, across: P, l: number, w: number, color: MarkColor, tag: MarkTag, hwy: boolean) => {
    const p = (u: number, v: number): P => ({ x: c.x + along.x * u + across.x * v, y: c.y + along.y * u + across.y * v });
    push("quad", [p(-l / 2, -w / 2), p(l / 2, -w / 2), p(l / 2, w / 2), p(-l / 2, w / 2)], color, 0, tag, hwy);
  };

  for (const s of net.segments) {
    const cls = s.road.cls, [f, r] = s.road.lanes, hw = s.width / 2;
    const hwy = cls === "highway";
    if (r > 0) {
      if (cls === "arterial" || cls === "highway") {
        line(s.pa, s.pb, 0.04, "yellow", 0, 0, 1.5, "center", hwy);
        line(s.pa, s.pb, -0.04, "yellow", 0, 0, 1.5, "center", hwy);
      } else line(s.pa, s.pb, 0, "yellow", 0.28, 0.22, 2, "center", hwy);
    }
    for (let k = 1; k < f; k++) line(s.pa, s.pb, (r > 0 ? k : k - f / 2) * LANE_W, "white", 0.28, 0.32, 1.5, "divider", hwy);
    for (let k = 1; k < r; k++) line(s.pa, s.pb, -k * LANE_W, "white", 0.28, 0.32, 1.5, "divider", hwy);
    if (cls === "highway" || cls === "ramp") {
      line(s.pa, s.pb, hw - 0.07, "white", 0, 0, 1.5, "edge", hwy);
      line(s.pa, s.pb, -(hw - 0.07), "white", 0, 0, 1.5, "edge", hwy);
    }
  }

  for (const node of net.nodes) {
    const minor = minorArms(node);
    for (const arm of node.arms) {
      const hw = arm.seg.width / 2;
      const d = arm.dir, n = { x: -d.y, y: d.x };
      const armHwy = arm.seg.road.cls === "highway";
      if (arm.crosswalk) {
        const mid = arm.trim - 0.19;
        for (let o = -hw + 0.1; o <= hw - 0.1 + 1e-6; o += 0.2)
          quad({ x: node.p.x + d.x * mid + n.x * o, y: node.p.y + d.y * mid + n.y * o }, d, n, 0.28, 0.09, "white", "crosswalk", armHwy);
      }
      const stops = node.control === "signal" || node.control === "allway" || (node.control === "stop" && minor.has(arm));
      const yields = node.control === "yield" && minor.has(arm);
      for (const l of arm.seg.lanes) {
        if (l.to !== node) continue;
        const e = l.path.at(l.path.length);
        const t = { x: Math.cos(e.h), y: Math.sin(e.h) }, across = { x: -t.y, y: t.x };
        if (stops) quad({ x: e.x - t.x * 0.04, y: e.y - t.y * 0.04 }, t, across, 0.07, 0.46, "white", "stop", armHwy);
        if (yields)
          for (const o of [-0.15, 0, 0.15]) {
            const c = { x: e.x - t.x * 0.08 + across.x * o, y: e.y - t.y * 0.08 + across.y * o };
            push("quad", [
              { x: c.x - t.x * 0.06 - across.x * 0.05, y: c.y - t.y * 0.06 - across.y * 0.05 },
              { x: c.x - t.x * 0.06 + across.x * 0.05, y: c.y - t.y * 0.06 + across.y * 0.05 },
              { x: c.x + t.x * 0.06, y: c.y + t.y * 0.06 },
              { x: c.x + t.x * 0.06, y: c.y + t.y * 0.06 },
            ], "white", 0, "yield", armHwy);
          }
        if (node.control === "signal" && l.count >= 2 && l.index === 0 && l.out.some((m) => m.turn === "left") && l.path.length > 1.4) {
          const tip = l.path.at(l.path.length - 0.7), tail = l.path.at(l.path.length - 1.1);
          const left = { x: t.y, y: -t.x };
          const bend = { x: tip.x + left.x * 0.14, y: tip.y + left.y * 0.14 };
          push("line", [tail, tip, bend], "white", 1.5, "arrow", armHwy);
          push("line", [{ x: bend.x - left.x * 0.06 + t.x * 0.06, y: bend.y - left.y * 0.06 + t.y * 0.06 }, bend, { x: bend.x - left.x * 0.06 - t.x * 0.06, y: bend.y - left.y * 0.06 - t.y * 0.06 }], "white", 1.5, "arrow", armHwy);
        }
      }
    }
  }
  return out;
}
