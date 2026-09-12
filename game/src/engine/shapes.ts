// Iso primitives for landmarks: boxes, cylinders, cones, lines in 3D.

import { Container, Graphics } from "pixi.js";
import { shade } from "./color";
import { iso } from "./iso";

export function box(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  z0: number,
  z1: number,
  color: number,
  top?: number,
): void {
  const T = iso(x, y, z1), R = iso(x + w, y, z1), B = iso(x + w, y + d, z1), L = iso(x, y + d, z1);
  const Rd = iso(x + w, y, z0), Bd = iso(x + w, y + d, z0), Ld = iso(x, y + d, z0);
  g.poly([L.x, L.y, B.x, B.y, Bd.x, Bd.y, Ld.x, Ld.y]).fill(shade(color, 0.95));
  g.poly([B.x, B.y, R.x, R.y, Rd.x, Rd.y, Bd.x, Bd.y]).fill(shade(color, 0.74));
  g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill(top ?? shade(color, 1.1));
}

/** Upright cylinder centered on tile point (cx, cy); r in screen pixels. */
export function cylinder(g: Graphics, cx: number, cy: number, r: number, z0: number, z1: number, color: number): void {
  const b = iso(cx, cy, z0), t = iso(cx, cy, z1);
  g.ellipse(b.x, b.y, r, r / 2).fill(shade(color, 0.78));
  g.rect(b.x - r, t.y, r * 2, b.y - t.y).fill(shade(color, 0.86));
  g.rect(b.x - r, t.y, r * 0.8, b.y - t.y).fill(shade(color, 1.0));
  g.rect(b.x + r * 0.45, t.y, r * 0.55, b.y - t.y).fill(shade(color, 0.72));
  g.ellipse(t.x, t.y, r, r / 2).fill(shade(color, 1.12));
}

export function cone(g: Graphics, cx: number, cy: number, r: number, z0: number, h: number, color: number): void {
  const b = iso(cx, cy, z0), t = iso(cx, cy, z0 + h);
  g.poly([b.x - r, b.y, b.x + r, b.y, t.x, t.y]).fill(shade(color, 0.9));
  g.poly([b.x - r, b.y, b.x - r * 0.1, b.y, t.x, t.y]).fill(shade(color, 1.08));
  g.ellipse(b.x, b.y, r, r / 2).fill(shade(color, 0.8));
}

export function line3(
  g: Graphics,
  a: [number, number, number],
  b: [number, number, number],
  width: number,
  color: number,
  alpha = 1,
): void {
  const p = iso(a[0], a[1], a[2]), q = iso(b[0], b[1], b[2]);
  g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width, color, alpha, cap: "round" });
}

/** Wrap graphics in a container with a depth. */
export function layer(zIndex: number, ...children: Container[]): Container {
  const c = new Container();
  c.zIndex = zIndex;
  for (const child of children) c.addChild(child);
  return c;
}
