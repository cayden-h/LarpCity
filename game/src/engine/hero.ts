// The player's home. Its look follows the player's net-worth tier, and when
// the tier changes the new building drops into place with a toy-like bounce.

import { Container, Graphics } from "pixi.js";
import { buildBrick, type Built } from "./bricks";
import { shade } from "./color";
import { depthOf, iso } from "./iso";
import { box } from "./shapes";

export const HOME_TIERS = ["Tent (bankrupt)", "Studio apartment", "Small house", "Townhouse", "Large house", "Retirement villa"] as const;

export class HeroHome {
  readonly view = new Container();
  private current: Container | null = null;
  private body: Container[] = [];
  private lights: Container[] = [];
  private readonly pin = new Graphics();
  private readonly ring = new Graphics();
  private anim = 1;
  private old: Container | null = null;
  private time = 0;
  tier = 2;
  readonly x: number;
  readonly y: number;
  private readonly seed: number;

  constructor(x: number, y: number, seed: number) {
    this.x = x;
    this.y = y;
    this.seed = seed;
    this.view.zIndex = depthOf(x, y, 70);
    const p = iso(x + 0.5, y + 0.5, 0);
    // A pulsing ring on the ground marks the lot; the pin floats above the roof.
    this.ring.ellipse(0, 0, 30, 15).stroke({ width: 3, color: 0x2ecc71 });
    this.ring.position.set(p.x, p.y);
    this.pin.poly([0, 0, -11, -17, 11, -17]).fill(0x27ae60);
    this.pin.circle(0, -25, 14).fill(0x2ecc71).stroke({ width: 3, color: 0xffffff });
    this.pin.circle(0, -25, 5.5).fill(0xffffff);
    this.pin.position.set(p.x, p.y - 70);
    this.view.addChild(this.ring, this.pin);
    this.build(this.tier, false);
  }

  get tintables(): Container[] {
    return this.body;
  }

  setTier(tier: number): void {
    const t = Math.max(0, Math.min(HOME_TIERS.length - 1, tier));
    if (t === this.tier) return;
    this.tier = t;
    this.build(t, true);
  }

  update(dt: number, night: number): void {
    this.time += dt;
    this.pin.y = iso(this.x + 0.5, this.y + 0.5, 0).y - 78 + Math.sin(this.time * 2.4) * 4;
    const pulse = (Math.sin(this.time * 2.4) + 1) / 2;
    this.ring.scale.set(0.9 + pulse * 0.25);
    this.ring.alpha = 0.45 + pulse * 0.45;
    for (const l of this.lights) l.alpha = night;
    if (this.anim < 1 && this.current) {
      this.anim = Math.min(1, this.anim + dt * 1.6);
      const k = this.anim;
      // Drop in with a small bounce.
      const bounce = k < 0.7 ? -60 * (1 - k / 0.7) ** 2 : Math.sin(((k - 0.7) / 0.3) * Math.PI) * -6;
      this.current.y = bounce;
      this.current.alpha = Math.min(1, k * 2);
      if (this.old) {
        this.old.alpha = 1 - k;
        this.old.y = k * 12;
        if (k >= 1) {
          this.old.destroy({ children: true });
          this.old = null;
        }
      }
    }
  }

  private build(tier: number, animate: boolean): void {
    if (this.old) this.old.destroy({ children: true });
    this.old = animate ? this.current : null;
    if (!animate && this.current) this.current.destroy({ children: true });
    const { x, y, seed } = this;
    const c = new Container();
    this.body = [];
    this.lights = [];
    const add = (b: Built) => {
      c.addChild(b.view);
      this.body.push(b.view.children[0] as Container);
      this.lights.push(b.lights);
    };
    switch (tier) {
      case 0: {
        const g = new Graphics();
        // A shopping cart of belongings behind the tent, drawn first so the tent overlaps it.
        box(g, x + 0.1, y + 0.08, 0.25, 0.2, 0, 9, 0x9e9e9e);
        const a = iso(x + 0.25, y + 0.7), b = iso(x + 0.75, y + 0.7), top = iso(x + 0.5, y + 0.5, 22);
        const back = iso(x + 0.5, y + 0.2, 0);
        g.poly([a.x, a.y, b.x, b.y, top.x, top.y]).fill(0xe67e22);
        g.poly([b.x, b.y, back.x + 16, back.y, top.x, top.y]).fill(shade(0xe67e22, 0.7));
        g.poly([a.x + 10, a.y - 1, a.x + 18, a.y - 1, top.x, top.y + 6]).fill(0x5d3a1a);
        c.addChild(g);
        this.body.push(g);
        break;
      }
      case 1:
        add(buildBrick({ x: x + 0.1, y: y + 0.1, w: 0.8, d: 0.8, floors: 3, wall: 0xc9a27e, trim: 0x455a64, roof: 0x8d969e, roofType: "flat", windows: "grid", seed, litShare: 0.8 }));
        break;
      case 2:
        add(buildBrick({ x: x + 0.12, y: y + 0.12, w: 0.76, d: 0.76, floors: 1, wall: 0x81c784, trim: 0xffffff, roof: 0xc0392b, roofType: "gable", windows: "grid", seed, litShare: 1 }));
        break;
      case 3:
        add(buildBrick({ x: x + 0.05, y: y + 0.1, w: 0.9, d: 0.8, floors: 2, wall: 0x64b5f6, trim: 0xffffff, roof: 0x37474f, roofType: "gable", windows: "tall", seed, litShare: 1 }));
        break;
      case 4:
        add(buildBrick({ x: x + 0.02, y: y + 0.02, w: 0.96, d: 0.96, floors: 2, wall: 0xfff3e0, trim: 0x8d6e63, roof: 0x6d4c41, roofType: "hip", windows: "tall", seed, litShare: 1 }));
        break;
      default: {
        const g = new Graphics();
        const pool = [iso(x + 0.55, y + 0.62), iso(x + 0.95, y + 0.62), iso(x + 0.95, y + 0.95), iso(x + 0.55, y + 0.95)];
        g.poly(pool.flatMap((p) => [p.x, p.y])).fill(0x4fc3f7);
        c.addChild(g);
        this.body.push(g);
        add(buildBrick({ x: x + 0.02, y: y + 0.02, w: 0.6, d: 0.96, floors: 2, wall: 0xfffde7, trim: 0x4db6ac, roof: 0xe67e22, roofType: "hip", windows: "tall", seed, litShare: 1 }));
      }
    }
    // Above the ground ring, below the pin.
    this.view.addChildAt(c, this.view.getChildIndex(this.pin));
    this.current = c;
    this.anim = animate ? 0 : 1;
    if (animate) c.alpha = 0;
  }
}
