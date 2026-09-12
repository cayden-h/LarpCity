// Landmarks shared by the regional templates: capitol, lighthouse,
// grain elevator, and church steeple.

import { Graphics } from "pixi.js";
import { shade } from "../engine/color";
import { depthOf, iso } from "../engine/iso";
import { box, cone, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

/** A state capitol: columned wings, a drum, and a dome with a flag. */
export function capitol(domeColor: number, wall = 0xf2efe6): LandmarkFactory {
  return ({ x, y, w, d }, ctx) => {
    const g = new Graphics();
    const lit = new Graphics();
    const flag = new Graphics();
    box(g, x + 0.1, y + 0.3, w - 0.2, d - 0.6, 0, 6, 0xd9d4c7);
    box(g, x + 0.2, y + 0.4, w - 0.4, d - 0.8, 6, 40, wall);
    // Columns on the front face.
    const face = y + d - 0.4;
    for (let i = 0; i <= 9; i++) {
      const t = x + 0.25 + ((w - 0.5) * i) / 9;
      line3(g, [t, face + 0.02, 8], [t, face + 0.02, 34], 3, 0xffffff);
      const win = [iso(t + 0.05, face, 14), iso(t + 0.14, face, 14), iso(t + 0.14, face, 28), iso(t + 0.05, face, 28)];
      if (i < 9) lit.poly(win.flatMap((p) => [p.x, p.y])).fill(0xffd47e);
    }
    // Pediment.
    const pa = iso(x + w / 2 - 0.5, face + 0.02, 40), pb = iso(x + w / 2 + 0.5, face + 0.02, 40), pc = iso(x + w / 2, face + 0.02, 52);
    g.poly([pa.x, pa.y, pb.x, pb.y, pc.x, pc.y]).fill(shade(wall, 0.95));
    box(g, x + 0.2, y + 0.4, w - 0.4, d - 0.8, 40, 43, shade(wall, 0.9));
    // Drum and dome.
    const cx = x + w / 2, cy = y + d / 2;
    cylinder(g, cx, cy, 26, 43, 66, wall);
    for (let k = 0; k < 8; k++) {
      const p = iso(cx, cy, 50);
      g.rect(p.x - 22 + k * 6, p.y - 12, 2, 12).fill(0xffffff);
    }
    const base = iso(cx, cy, 66);
    g.moveTo(base.x - 24, base.y).arc(base.x, base.y, 24, Math.PI, 0).fill(domeColor);
    g.moveTo(base.x - 24, base.y).arc(base.x, base.y, 24, Math.PI, Math.PI * 1.4).lineTo(base.x, base.y).fill({ color: 0xffffff, alpha: 0.25 });
    g.rect(base.x - 3, base.y - 36, 6, 12).fill(shade(domeColor, 0.9));
    const pole = iso(cx, cy, 104);
    g.moveTo(pole.x, pole.y + 10).lineTo(pole.x, pole.y - 14).stroke({ width: 1.5, color: 0x666666 });
    lit.alpha = 0;
    lit.blendMode = "add";
    const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, flag);
    let t = 0;
    return {
      views: [view],
      tintables: [g, flag],
      update: (dt) => {
        t += dt;
        lit.alpha = ctx.night();
        flag.clear();
        const wave = Math.sin(t * 4) * 2;
        flag.poly([pole.x, pole.y - 14, pole.x + 14, pole.y - 12 + wave, pole.x + 14, pole.y - 4 + wave, pole.x, pole.y - 6]).fill(0xe53935);
        flag.poly([pole.x, pole.y - 14, pole.x + 6, pole.y - 13 + wave * 0.4, pole.x + 6, pole.y - 9 + wave * 0.4, pole.x, pole.y - 10]).fill(0x1e3a8a);
      },
    };
  };
}

/** Red-and-white lighthouse with a sweeping lamp at night. */
export const lighthouse: LandmarkFactory = ({ x, y }, ctx) => {
  const g = new Graphics();
  const beam = new Graphics();
  const cx = x + 0.5, cy = y + 0.5;
  box(g, x + 0.15, y + 0.15, 0.7, 0.7, 0, 8, 0x9e9e9e);
  for (let k = 0; k < 5; k++) cylinder(g, cx, cy, 12 - k * 0.8, 8 + k * 18, 26 + k * 18, k % 2 ? 0xffffff : 0xd32f2f);
  cylinder(g, cx, cy, 9, 98, 110, 0x333333);
  cone(g, cx, cy, 10, 110, 12, 0xd32f2f);
  const lamp = iso(cx, cy, 104);
  beam.blendMode = "add";
  const view = layer(depthOf(x, y, 60), g, beam);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      beam.clear();
      if (n < 0.05) return;
      const a = t * 1.4;
      const ex = Math.cos(a) * 240, ey = Math.sin(a) * 120;
      beam.poly([lamp.x, lamp.y, lamp.x + ex - ey * 0.08, lamp.y + ey + ex * 0.04, lamp.x + ex + ey * 0.08, lamp.y + ey - ex * 0.04]).fill({ color: 0xfff6c8, alpha: 0.25 * n });
      beam.circle(lamp.x, lamp.y, 5).fill({ color: 0xfffbe0, alpha: n });
    },
  };
};

/** A row of concrete grain silos with a headhouse. */
export const grainElevator: LandmarkFactory = ({ x, y, w, d }) => {
  const g = new Graphics();
  box(g, x + 0.1, y + 0.1, w - 0.2, d - 0.2, 0, 4, 0xa1887f);
  for (let i = 0; i < 4; i++) cylinder(g, x + 0.35 + i * ((w - 0.6) / 3), y + d / 2 + 0.1, 12, 4, 92, 0xe7e2d8);
  box(g, x + w / 2 - 0.3, y + d / 2 - 0.45, 0.6, 0.45, 4, 124, 0xd8d2c4);
  box(g, x + w / 2 - 0.2, y + d / 2 - 0.35, 0.4, 0.3, 124, 136, 0xc62828);
  return { views: [layer(depthOf(x + w - 1, y + d - 1, 60), g)], tintables: [g] };
};

/** A white church with a tall steeple. */
export const steeple: LandmarkFactory = ({ x, y }) => {
  const g = new Graphics();
  box(g, x + 0.15, y + 0.25, 0.7, 0.55, 0, 30, 0xfafafa);
  const T = iso(x + 0.15, y + 0.25, 30), R = iso(x + 0.85, y + 0.25, 30), B = iso(x + 0.85, y + 0.8, 30), L = iso(x + 0.15, y + 0.8, 30);
  const r0 = iso(x + 0.15, y + 0.52, 44), r1 = iso(x + 0.85, y + 0.52, 44);
  g.poly([T.x, T.y, R.x, R.y, r1.x, r1.y, r0.x, r0.y]).fill(0x546e7a);
  g.poly([L.x, L.y, B.x, B.y, r1.x, r1.y, r0.x, r0.y]).fill(0x607d8b);
  g.poly([R.x, R.y, B.x, B.y, r1.x, r1.y]).fill(0xe0e0e0);
  box(g, x + 0.3, y + 0.35, 0.3, 0.3, 30, 62, 0xffffff);
  cone(g, x + 0.45, y + 0.5, 11, 62, 44, 0x546e7a);
  return { views: [layer(depthOf(x, y, 60), g)], tintables: [g] };
};
