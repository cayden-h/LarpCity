// NPCs on foot: little toy-brick people walking the sidewalks and strolling
// plazas and parks. Each one has a name, age, job, and a thought that follows
// the economy and the weather, so clicking someone shows who they are. The
// simulation can later drive these with real NPC finances.

import { Container, Sprite, type Texture } from "pixi.js";
import { pixelTexture } from "./pixel/atlas";
import { personArt, residentRingArt, type PersonLook } from "./pixel/people-art";
import type { CityGrid } from "./grid";
import { BRIDGE_Z } from "./ground";
import { iso } from "./iso";
import { pick, rngFor, type Rng } from "./rng";
import type { RoadNet } from "./roads/graph";
import { Sidewalks, type Ped } from "./roads/sidewalks";
import type { Sim } from "./roads/sim";

export type Mood = "normal" | "bear" | "boom" | "pandemic" | "storm" | "night";

export interface ResidentSeed {
  id: string;
  first: string;
  last: string;
  job: string;
  age: number;
  /** Shown as this resident's thought instead of a mood-pool line — their `story` from data/npcs.ts. */
  story: string;
  /** Primary-tier NPCs get the visible gold-ring marker (markResident); background NPCs blend into the crowd like ambient extras but are still real, clickable residents. */
  marked: boolean;
  /** The server route (`/api/bank` or `/api/bank-bg`) this resident's statement lives behind. */
  bankBase: string;
}

export interface NpcInfo {
  name: string;
  age: number;
  job: string;
  thought: string;
  /** Set only for named roster NPCs (primary and background); drives the bank-statement card (ui/npccard.ts). */
  residentId?: string;
  /** Set alongside residentId: which server route to fetch this resident's statement from. */
  bankBase?: string;
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
  // Street walkers: their pedestrian on the sidewalk network.
  ped: Ped | null;
  // Plaza strollers: continuous position and target.
  px: number;
  py: number;
  tx: number;
  ty: number;
  pause: number;
  speed: number;
  phase: number;
  view: Container;
  body: Sprite;
  /** Walk frames (stand, stride, stride) facing right, then left. */
  frames: Texture[][];
  /** 1 faces right, -1 left; drawn per side so the light stays on the left. */
  dir: number;
  info: Omit<NpcInfo, "thought">;
  seedIndex: number;
  leaving: boolean;
  resident: boolean;
  residentId?: string;
  bankBase?: string;
  fixedThought?: string;
}

export class People {
  tint = 0xffffff;
  private readonly walkers: Walker[] = [];
  private readonly plazas: [number, number][] = [];
  private readonly plazaSet = new Set<string>();
  private target = 0;
  private spawned = 0;
  private readonly rng: Rng;
  private readonly grid: CityGrid;
  private readonly objects: Container;
  private readonly seed: number;
  private readonly walk: Sidewalks;

  constructor(grid: CityGrid, net: RoadNet, sim: Sim, objects: Container, seed: number, residents: ResidentSeed[] = []) {
    this.grid = grid;
    this.objects = objects;
    this.seed = seed;
    this.rng = rngFor(seed, "people");
    this.walk = new Sidewalks(net, sim, rngFor(seed, "sidewalks"), (x, y) => grid.at(x, y) === "B" || grid.at(x, y) === "O");
    for (const { x, y, c } of grid.cells()) {
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
    this.walk.step(dt);
    const live = this.count;
    if (live < this.target && this.rng() < dt * 12) this.spawn();
    if (live > this.target) {
      const w = this.walkers.find((p) => !p.leaving && !p.resident);
      if (w) w.leaving = true;
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (w.street) this.stepStreet(w);
      else this.stepPlaza(w, dt);
      // Walk cycle.
      const moving = w.pause <= 0;
      w.phase += dt * (moving ? 9 : 0);
      const frame = moving ? [1, 0, 2, 0][Math.floor(w.phase / (Math.PI / 2)) % 4] : 0;
      w.body.texture = w.frames[w.dir < 0 ? 1 : 0][frame];
      w.body.tint = this.tint;
      if (w.leaving) {
        w.view.alpha -= dt * 1.5;
        if (w.view.alpha <= 0) {
          w.view.destroy({ children: true });
          this.walkers.splice(i, 1);
          if (w.ped) this.walk.remove(w.ped);
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
    return { ...best.info, thought: best.fixedThought ?? pool[best.seedIndex % pool.length], residentId: best.residentId, bankBase: best.bankBase };
  }

  /** A named roster NPC (data/npcs.ts): a fixed walker that never despawns, marked so ui/npccard.ts can fetch its real bank statement. */
  private spawnResident(r: ResidentSeed): void {
    const rng = rngFor(this.seed, "resident", r.id);
    // Street residents walk the sidewalk network; plaza residents stroll, and take a plaza if no sidewalk spot is free.
    const ped = !this.plazas.length || rng() < 0.5 ? this.walk.spawn() : null;
    if (!ped && !this.plazas.length) return;
    const [x, y] = ped ? [0, 0] : pick(rng, this.plazas);
    const fig = drawPerson(rng);
    const w: Walker = {
      street: !!ped,
      ped,
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
      bankBase: r.bankBase,
      fixedThought: r.story,
    };
    if (r.marked) markResident(w.view);
    w.view.alpha = 1;
    this.walkers.push(w);
    this.objects.addChild(w.view);
  }

  private spawn(): void {
    const useStreet = !this.plazas.length || this.rng() < 0.7;
    let ped: Ped | null = null;
    let x = 0, y = 0;
    if (useStreet) {
      ped = this.walk.spawn();
      if (!ped) return;
    } else {
      if (!this.plazas.length) return;
      [x, y] = pick(this.rng, this.plazas);
    }
    const index = this.spawned++;
    const r = rngFor(this.seed, "npc", index);
    const fig = drawPerson(r);
    const info = { name: `${pick(r, FIRST)} ${pick(r, LAST)}`, age: 18 + Math.floor(r() * 60), job: pick(r, JOBS) };
    const w: Walker = {
      street: useStreet,
      ped,
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

  private stepStreet(w: Walker): void {
    const p = w.ped!;
    const c = this.grid.at(Math.floor(p.x), Math.floor(p.y));
    const z = c === "B" || c === "O" ? BRIDGE_Z : 0;
    w.pause = p.vx === 0 && p.vy === 0 ? 1 : 0;
    const facing = p.vx - p.vy >= 0 ? 1 : -1;
    this.place(w, p.x, p.y, z, p.vx === 0 && p.vy === 0 ? w.dir : facing);
  }

  private stepPlaza(w: Walker, dt: number): void {
    if (w.pause > 0) {
      w.pause -= dt;
      this.place(w, w.px, w.py, 0, w.dir);
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
    w.view.position.set(Math.round(p.x), Math.round(p.y));
    w.dir = facing;
    w.view.zIndex = (px + py) * 100 + 45 + (z > 0 ? 30 : 0);
  }
}

/** A small gold ring at a resident's feet, so the 8 real NPCs read as distinct from ambient foot traffic. */
function markResident(view: Container): void {
  view.addChildAt(new Sprite(pixelTexture("resident-ring", residentRingArt)), 0);
}

/** A pixel-art figure (pixel/people-art.ts): its walk frames come from the shared atlas. */
function drawPerson(r: Rng): { view: Container; body: Sprite; frames: Texture[][]; dir: number } {
  const look: PersonLook = { skin: pick(r, SKIN), shirt: pick(r, SHIRTS), pants: pick(r, PANTS), hair: pick(r, HAIR), cap: null };
  if (r() < 0.25) look.cap = pick(r, SHIRTS);
  const id = `${look.skin}:${look.shirt}:${look.pants}:${look.hair}:${look.cap}`;
  const frames = ([1, -1] as const).map((dir) => [0, 1, 2].map((f) => pixelTexture(`person:${id}:${dir}:${f}`, () => personArt(look, f, dir))));
  const view = new Container();
  const body = new Sprite(frames[0][0]);
  view.addChild(body);
  return { view, body, frames, dir: 1 };
}
