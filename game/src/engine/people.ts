// NPCs on foot: little toy-brick people walking the sidewalks and strolling
// plazas and parks. Each one has a name, age, job, and a thought that follows
// the economy and the weather, so clicking someone shows who they are. The
// simulation can later drive these with real NPC finances.

import { Container, Graphics } from "pixi.js";
import { shade } from "./color";
import type { CityGrid } from "./grid";
import { BRIDGE_Z } from "./ground";
import { DIRS, iso } from "./iso";
import { pick, rngFor, type Rng } from "./rng";

export type Mood = "normal" | "bear" | "boom" | "pandemic" | "storm" | "night";

export interface ResidentSeed {
  id: string;
  first: string;
  last: string;
  job: string;
  age: number;
  /** Shown as this resident's thought instead of a mood-pool line — their `story` from data/npcs.ts. */
  story: string;
}

export interface NpcInfo {
  name: string;
  age: number;
  job: string;
  thought: string;
  /** Set only for the 8 named roster NPCs; drives the bank-statement card (ui/npccard.ts). */
  residentId?: string;
}

const FIRST = ["Maya", "Jordan", "Luis", "Aisha", "Wei", "Priya", "Marcus", "Sofia", "Kenji", "Amara", "Diego", "Hannah", "Omar", "Grace", "Mateo", "Zoe", "Tariq", "Elena", "Kwame", "Lily", "Andre", "Nadia", "Sam", "Rosa", "Jamal", "Mei", "Carlos", "Ava", "Dev", "Fatima", "Noah", "Imani"];
const LAST = ["Nguyen", "Garcia", "Johnson", "Patel", "Kim", "Okafor", "Martinez", "Smith", "Chen", "Williams", "Hernandez", "Brown", "Ali", "Lopez", "Davis", "Singh", "Rossi", "Jackson", "Tanaka", "Moore", "Cohen", "Reyes", "Baker", "Diaz"];
const JOBS = ["nurse", "teacher", "barista", "software developer", "electrician", "student", "accountant", "line cook", "retail associate", "truck driver", "graphic designer", "retiree", "mechanic", "real estate agent", "bus driver", "pharmacist", "welder", "delivery driver", "dental hygienist", "small business owner"];

const THOUGHTS: Record<Mood, string[]> = {
  normal: [
    "Saving up for a down payment.",
    "Just got a raise, putting half in my Roth.",
    "Rent went up again this year...",
    "Paying my card off in full this month.",
    "My emergency fund finally hit three months.",
    "Thinking about a cheaper state with remote work.",
    "Is a 401(k) match free money? (Yes.)",
    "Comparing car loans before I sign anything.",
  ],
  bear: [
    "Should I sell my stocks? Everyone's panicking.",
    "Worried about layoffs at work.",
    "Glad I kept an emergency fund.",
    "Holding. I'm not selling at the bottom.",
    "Groceries cost more and my portfolio's down.",
  ],
  boom: [
    "Everyone's talking about that AI stock.",
    "Thinking about buying a bigger place.",
    "My friend quit to day-trade. Hmm.",
    "Rebalancing before this rally ends.",
  ],
  pandemic: ["Working from home again.", "Glad I have savings for this.", "Ordering everything online now."],
  storm: ["Hope my insurance covers flood damage.", "Stocking up before the storm.", "Our street is flooding again."],
  night: ["Long shift. Heading home.", "Late dinner, then budgeting.", "Picking up extra hours this week."],
};

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const SHIRTS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1, 0xf06292, 0xffffff, 0x3949ab];
const PANTS = [0x263238, 0x3e4a61, 0x5d4037, 0x1565c0, 0x424242, 0x6d4c41];
const HAIR = [0x2b1b0e, 0x5d3a1a, 0xd4a017, 0x111111, 0xa0522d, 0xdcdcdc, 0x7b3f00];

interface Walker {
  street: boolean;
  // Street walkers: tile, direction, progress, and which sidewalk (+1/-1).
  x: number;
  y: number;
  dir: number;
  t: number;
  side: number;
  // Plaza strollers: continuous position and target.
  px: number;
  py: number;
  tx: number;
  ty: number;
  pause: number;
  speed: number;
  phase: number;
  view: Container;
  body: Graphics;
  legL: Graphics;
  legR: Graphics;
  info: Omit<NpcInfo, "thought">;
  seedIndex: number;
  leaving: boolean;
  resident: boolean;
  residentId?: string;
  fixedThought?: string;
}

export class People {
  tint = 0xffffff;
  private readonly walkers: Walker[] = [];
  private readonly sidewalks: [number, number][] = [];
  private readonly plazas: [number, number][] = [];
  private readonly plazaSet = new Set<string>();
  private target = 0;
  private spawned = 0;
  private readonly rng: Rng;
  private readonly grid: CityGrid;
  private readonly objects: Container;
  private readonly seed: number;

  constructor(grid: CityGrid, objects: Container, seed: number, residents: ResidentSeed[] = []) {
    this.grid = grid;
    this.objects = objects;
    this.seed = seed;
    this.rng = rngFor(seed, "people");
    for (const { x, y, c } of grid.cells()) {
      if (c === "=" && grid.roadLinks(x, y).filter(Boolean).length < 4) this.sidewalks.push([x, y]);
      if (c === "P" || c === "p") {
        this.plazas.push([x, y]);
        this.plazaSet.add(`${x},${y}`);
      }
    }
    for (const r of residents) this.spawnResident(r);
  }

  setTarget(n: number): void {
    this.target = n;
  }

  get count(): number {
    return this.walkers.filter((w) => !w.leaving && !w.resident).length;
  }

  update(dt: number, night: number): void {
    const live = this.count;
    if (live < this.target && this.rng() < dt * 12) this.spawn();
    if (live > this.target) {
      const w = this.walkers.find((p) => !p.leaving && !p.resident);
      if (w) w.leaving = true;
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (w.street) this.stepStreet(w, dt);
      else this.stepPlaza(w, dt);
      // Walk cycle.
      const moving = w.pause <= 0;
      w.phase += dt * (moving ? 9 : 0);
      const swing = moving ? Math.sin(w.phase) * 1.3 : 0;
      w.legL.y = Math.max(0, swing) * -1;
      w.legR.y = Math.max(0, -swing) * -1;
      w.body.y = moving ? -Math.abs(Math.sin(w.phase)) * 0.6 : 0;
      w.body.tint = this.tint;
      w.legL.tint = w.legR.tint = this.tint;
      if (w.leaving) {
        w.view.alpha -= dt * 1.5;
        if (w.view.alpha <= 0) {
          w.view.destroy({ children: true });
          this.walkers.splice(i, 1);
        }
      } else if (w.view.alpha < 1) w.view.alpha = Math.min(1, w.view.alpha + dt * 2);
    }
    void night;
  }

  /** The NPC nearest a point in world (diorama) coordinates, if any is close. */
  pickAt(wx: number, wy: number, mood: Mood): NpcInfo | null {
    let best: Walker | null = null;
    let bestD = 14;
    for (const w of this.walkers) {
      const dx = w.view.x - wx, dy = w.view.y - 9 - wy;
      const d = Math.hypot(dx, dy * 0.8);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (!best) return null;
    const pool = THOUGHTS[mood];
    return { ...best.info, thought: best.fixedThought ?? pool[best.seedIndex % pool.length], residentId: best.residentId };
  }

  /** A named roster NPC (data/npcs.ts): a fixed walker that never despawns, marked so ui/npccard.ts can fetch its real bank statement. */
  private spawnResident(r: ResidentSeed): void {
    const rng = rngFor(this.seed, "resident", r.id);
    const useStreet = !this.plazas.length || rng() < 0.5;
    const pool = useStreet ? this.sidewalks : this.plazas;
    if (!pool.length) return;
    const [x, y] = pick(rng, pool);
    const fig = drawPerson(rng);
    const dirs = this.grid.roadLinks(x, y).map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    const w: Walker = {
      street: useStreet,
      x, y,
      dir: dirs.length ? pick(rng, dirs) : 0,
      t: rng(),
      side: rng() < 0.5 ? 1 : -1,
      px: x + 0.2 + rng() * 0.6,
      py: y + 0.2 + rng() * 0.6,
      tx: x + 0.5,
      ty: y + 0.5,
      pause: 0,
      speed: 0.24 + rng() * 0.1,
      phase: rng() * 6,
      ...fig,
      info: { name: `${r.first} ${r.last}`, age: r.age, job: r.job },
      seedIndex: 0,
      leaving: false,
      resident: true,
      residentId: r.id,
      fixedThought: r.story,
    };
    markResident(w.view);
    w.view.alpha = 1;
    this.walkers.push(w);
    this.objects.addChild(w.view);
  }

  private spawn(): void {
    const useStreet = !this.plazas.length || this.rng() < 0.7;
    const pool = useStreet ? this.sidewalks : this.plazas;
    if (!pool.length) return;
    const [x, y] = pick(this.rng, pool);
    const index = this.spawned++;
    const r = rngFor(this.seed, "npc", index);
    const fig = drawPerson(r);
    const info = { name: `${pick(r, FIRST)} ${pick(r, LAST)}`, age: 18 + Math.floor(r() * 60), job: pick(r, JOBS) };
    const dirs = this.grid.roadLinks(x, y).map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    const w: Walker = {
      street: useStreet,
      x, y,
      dir: dirs.length ? pick(this.rng, dirs) : 0,
      t: this.rng(),
      side: this.rng() < 0.5 ? 1 : -1,
      px: x + 0.2 + this.rng() * 0.6,
      py: y + 0.2 + this.rng() * 0.6,
      tx: x + 0.5,
      ty: y + 0.5,
      pause: 0,
      speed: 0.28 + this.rng() * 0.14,
      phase: this.rng() * 6,
      ...fig,
      info: { ...info, job: info.age > 67 ? "retiree" : info.age < 22 ? "student" : info.job },
      seedIndex: index,
      leaving: false,
      resident: false,
    };
    w.view.alpha = 0;
    this.walkers.push(w);
    this.objects.addChild(w.view);
  }

  private stepStreet(w: Walker, dt: number): void {
    w.t += w.speed * dt;
    while (w.t >= 1) {
      w.t -= 1;
      w.x += DIRS[w.dir].dx;
      w.y += DIRS[w.dir].dy;
      const links = this.grid.roadLinks(w.x, w.y);
      const back = (w.dir + 2) % 4;
      const options = [0, 1, 2, 3].filter((d) => links[d] && d !== back);
      w.dir = options.length ? (options.includes(w.dir) && this.rng() < 0.7 ? w.dir : pick(this.rng, options)) : back;
    }
    const d = DIRS[w.dir];
    // Sidewalks run along both edges of the road.
    const ox = -d.dy * 0.4 * w.side, oy = d.dx * 0.4 * w.side;
    const px = w.x + 0.5 + d.dx * w.t + ox, py = w.y + 0.5 + d.dy * w.t + oy;
    const z = this.grid.at(w.x, w.y) === "B" ? BRIDGE_Z : 0;
    this.place(w, px, py, z, (d.dx - d.dy) >= 0 ? 1 : -1);
  }

  private stepPlaza(w: Walker, dt: number): void {
    if (w.pause > 0) {
      w.pause -= dt;
      this.place(w, w.px, w.py, 0, w.view.scale.x);
      return;
    }
    const dx = w.tx - w.px, dy = w.ty - w.py;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) {
      w.pause = 0.8 + this.rng() * 2.5;
      // Next stop: a nearby plaza or park tile.
      for (let k = 0; k < 8; k++) {
        const nx = Math.floor(w.px) + Math.round((this.rng() - 0.5) * 6), ny = Math.floor(w.py) + Math.round((this.rng() - 0.5) * 6);
        if (this.plazaSet.has(`${nx},${ny}`)) {
          w.tx = nx + 0.2 + this.rng() * 0.6;
          w.ty = ny + 0.2 + this.rng() * 0.6;
          break;
        }
      }
      return;
    }
    const step = Math.min(dist, w.speed * 0.8 * dt);
    w.px += (dx / dist) * step;
    w.py += (dy / dist) * step;
    this.place(w, w.px, w.py, 0, dx - dy >= 0 ? 1 : -1);
  }

  private place(w: Walker, px: number, py: number, z: number, facing: number): void {
    const p = iso(px, py, z);
    w.view.position.set(p.x, p.y);
    w.view.scale.x = facing;
    w.view.zIndex = (px + py) * 100 + 45 + (z > 0 ? 30 : 0);
  }
}

/** A small gold ring at a resident's feet, so the 8 real NPCs read as distinct from ambient foot traffic. */
function markResident(view: Container): void {
  const ring = new Graphics().ellipse(0, 0.5, 5.5, 2.4).stroke({ width: 0.8, color: 0xf4c430, alpha: 0.85 });
  view.addChildAt(ring, 0);
}

function drawPerson(r: Rng): { view: Container; body: Graphics; legL: Graphics; legR: Graphics } {
  const skin = pick(r, SKIN), shirt = pick(r, SHIRTS), pants = pick(r, PANTS), hair = pick(r, HAIR);
  const view = new Container();
  const shadow = new Graphics().ellipse(0, 0, 4.5, 2).fill({ color: 0x000000, alpha: 0.18 });
  const legL = new Graphics().rect(-2.7, -6.5, 2.4, 6.5).fill(pants);
  const legR = new Graphics().rect(0.3, -6.5, 2.4, 6.5).fill(shade(pants, 0.85));
  const body = new Graphics();
  body.roundRect(-3.6, -13, 7.2, 7, 1.6).fill(shirt);
  body.rect(-4.9, -12.4, 1.5, 5.2).fill(shade(shirt, 0.85));
  body.rect(3.4, -12.4, 1.5, 5.2).fill(shade(shirt, 0.75));
  body.circle(-4.2, -7, 1).fill(skin);
  body.circle(4.2, -7, 1).fill(skin);
  body.rect(-1.2, -14.2, 2.4, 1.4).fill(skin);
  body.circle(0, -16.6, 3.1).fill(skin);
  if (r() < 0.25) {
    // A cap.
    const cap = pick(r, SHIRTS);
    body.roundRect(-3.3, -20.4, 6.6, 2.6, 1).fill(cap);
    body.rect(0.5, -18.2, 3.6, 1).fill(shade(cap, 0.8));
  } else body.ellipse(0, -18.6, 3.3, 1.9).fill(hair);
  body.circle(1.2, -16.8, 0.45).fill(0x222222);
  view.addChild(shadow, legL, legR, body);
  return { view, body, legL, legR };
}
