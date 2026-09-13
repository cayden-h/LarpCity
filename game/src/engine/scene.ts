// A city scene: the whole screen is the city. The hand-made (or template)
// core sits inside a generated world of suburbs, farms, forest, and terrain,
// and the camera can roam it but never shows past its edge. The scene owns
// the daily weather roll, snow and drought, economy mood, traffic, NPCs, and
// the events the dev panel (and later the simulation) can fire.

import { ColorMatrixFilter, Container, Rectangle, type Application } from "pixi.js";
import { goldenAt, type Clock, type Season } from "./clock";
import { mix } from "./color";
import { CityGrid } from "./grid";
import { Ground } from "./ground";
import { HeroHome } from "./hero";
import { depthOf, footprintRect, HALF_H, HALF_W, iso } from "./iso";
import { People, type Mood, type NpcInfo, type ResidentSeed } from "./people";
import { plant, populate, zoneAt, type Placed, type Plant } from "./populate";
import { rngFor } from "./rng";
import { buildRoadProps, type RoadProps } from "./roads/draw";
import { buildGraph, type RoadNet } from "./roads/graph";
import { buildPlaces, demand } from "./roads/trips";
import { placeShelters } from "./sprite-pick";
import { buildSprite, type SpriteSet } from "./sprites";
import { Traffic } from "./traffic";
import type { CityDef, EconomyMood, LandmarkFactory, LandmarkInstance, WeatherKind } from "./types";
import { WeatherFx } from "./weather";
import { expandWorld, type Region } from "./world";

export type CityEvent = "hurricane" | "snowstorm" | "wildfire" | "drought" | "fog" | "pandemic" | "crash" | "boom" | "clear";

export interface SceneStatus {
  weather: WeatherKind;
  season: Season;
  economy: EconomyMood;
  snow: number;
  drought: number;
  cars: number;
  people: number;
  event: string | null;
}

const EVENT_WEATHER: Partial<Record<CityEvent, { kind: WeatherKind; days: number; label: string }>> = {
  hurricane: { kind: "storm", days: 5, label: "Hurricane" },
  snowstorm: { kind: "snow", days: 4, label: "Snowstorm" },
  wildfire: { kind: "smoke", days: 6, label: "Wildfire smoke" },
  drought: { kind: "heat", days: 12, label: "Drought" },
  fog: { kind: "fog", days: 3, label: "Fog bank" },
};

// Start a little zoomed out so the city's surroundings show, not just downtown.
const DEFAULT_ZOOM = 0.72;
const MAX_ZOOM = 3;

export class CityScene {
  readonly root = new Container();
  readonly hero: HeroHome | null = null;
  /** The expanded city (core plus generated outskirts). */
  readonly city: CityDef;
  /** Called when the player clicks an NPC (or empty ground, with null). */
  onPick: ((npc: NpcInfo | null, sx: number, sy: number) => void) | null = null;
  private readonly world = new Container();
  private readonly objects = new Container();
  private readonly ground: Ground;
  private readonly net: RoadNet;
  private readonly traffic: Traffic;
  private readonly roadProps: RoadProps;
  private readonly people: People;
  private readonly weatherFx = new WeatherFx();
  private readonly grid: CityGrid;
  private readonly buildings: Placed[];
  private plants: Plant[] = [];
  private readonly landmarks: LandmarkInstance[] = [];
  private readonly region: Region;
  private zoom = DEFAULT_ZOOM;
  private readonly cam: { x: number; y: number };
  private w = 1;
  private h = 1;
  private time = 0;
  private weather: WeatherKind = "clear";
  private override: { kind: WeatherKind; days: number; label: string } | null = null;
  private snow = 0;
  private drought = 0;
  private economy: EconomyMood = "normal";
  private economyDays = 0;
  private pandemicDays = 0;
  private season: Season;
  private readonly desat = new ColorMatrixFilter();
  private desatLevel = 0;
  private lastTint = -1;
  private readonly unsubscribe: () => void;
  private readonly cleanup: (() => void)[] = [];
  private readonly app: Application;
  private readonly clock: Clock;
  private readonly seed: number;

  constructor(
    app: Application,
    city: CityDef,
    clock: Clock,
    factories: Record<string, LandmarkFactory>,
    sprites: SpriteSet | null = null,
    seed = 7,
    residents: ResidentSeed[] = [],
  ) {
    this.app = app;
    this.clock = clock;
    this.seed = seed;
    const world = expandWorld(city, seed);
    this.city = world.city;
    this.region = world.region;
    this.cam = { ...world.center };
    this.grid = new CityGrid(this.city.layout);
    // Keep a yard in front of the player's home so nothing hides it.
    for (const { x, y, c } of this.grid.cells())
      if (c === "h")
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]])
          if (this.grid.at(x + dx, y + dy) === "b") this.grid.set(x + dx, y + dy, ".");

    this.net = buildGraph(this.city.roads, { core: this.city.core });
    this.ground = new Ground(this.grid, this.city.palette, seed, this.net);
    this.objects.sortableChildren = true;
    this.world.addChild(this.ground.waterLayer, this.ground.landLayer, this.objects);
    this.root.addChild(this.world, this.weatherFx.view);

    this.season = clock.season;
    this.snow = this.city.snowInWinter && this.season === "winter" ? 0.6 : 0;
    this.ground.setLook({ season: this.season, snow: this.snow, drought: 0 });

    this.buildings = [...populate(this.grid, this.city, seed, sprites).buildings, ...this.shelters(sprites)];
    for (const b of this.buildings) {
      const v = b.built.view;
      v.zIndex = depthOf(b.x + b.w - 1, b.y + b.d - 1, 60);
      v.cullable = true;
      v.cullArea = footprintRect(b.x, b.y, b.w, b.d, b.built.topZ + 40);
      this.objects.addChild(v);
    }
    this.replant();

    const places = buildPlaces(this.net, this.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })), (x, y) => zoneAt(this.city, x, y));
    this.traffic = new Traffic(this.net, this.grid, this.objects, this.ground.waterLayer, this.city.vehicles, this.city.boats, places, seed, clock.visualDaySeconds / 24);
    this.roadProps = buildRoadProps(this.net, this.traffic.sim, this.grid);
    for (const v of this.roadProps.views) {
      v.cullable = true;
      this.objects.addChild(v);
    }
    this.people = new People(this.grid, this.net, this.traffic.sim, this.objects, seed, residents);

    const ctx = { clock, night: () => this.clock.nightness, time: () => this.time, storm: () => this.weatherFx.stormy, sprites };
    for (const place of this.city.landmarks) {
      const factory = factories[place.id];
      if (!factory) {
        console.warn(`[larp] no landmark factory for ${place.id}`);
        continue;
      }
      const inst = factory(place, ctx);
      for (const v of inst.views) {
        // Measure once; animated parts (beams, smoke) get generous padding.
        const b = v.getLocalBounds();
        v.cullArea = new Rectangle(b.x - 120, b.y - 160, b.width + 240, b.height + 220);
        v.cullable = true;
        this.objects.addChild(v);
      }
      this.landmarks.push(inst);
    }

    for (const { x, y, c } of this.grid.cells())
      if (c === "h") {
        this.hero = new HeroHome(x, y, seed);
        this.objects.addChild(this.hero.view);
        break;
      }

    this.unsubscribe = clock.onDay((day) => this.onDay(day));
    this.rollWeather(clock.day);
    this.bindInput();
  }

  /** Muni bus shelters beside the busy streets; drawn, tinted, and lit like buildings. */
  private shelters(sprites: SpriteSet | null): Placed[] {
    if (!sprites) return [];
    const inLandmark = (x: number, y: number) => this.city.landmarks.some((l) => x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.d);
    const inHomeYard = (x: number, y: number) => [[1, 0], [0, 1], [1, 1]].some(([dx, dy]) => this.grid.at(x - dx, y - dy) === "h");
    const site = {
      w: this.grid.w,
      h: this.grid.h,
      at: (x: number, y: number) => this.grid.at(x, y),
      zone: (x: number, y: number) => zoneAt(this.city, x, y),
      blocked: (x: number, y: number) => inLandmark(x, y) || inHomeYard(x, y),
    };
    return placeShelters(sprites.manifest, site, rngFor(this.seed, this.city.id, "shelters")).map(({ entry, x, y }) => ({
      built: buildSprite(sprites, entry, x, y),
      x,
      y,
      w: 1,
      d: 1,
    }));
  }

  // ---------------------------------------------------------------- camera

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.weatherFx.layout(w, h);
    this.applyCamera();
  }

  /** Half-size of the world on screen (at zoom 1), inset a tile so its zigzag border never shows. */
  private get halfWorld(): { x: number; y: number } {
    return { x: (this.region.ru - 1.5) * HALF_W, y: (this.region.rv - 1.5) * HALF_H };
  }

  /** Smallest zoom at which the view still fits inside the world. */
  private get minZoom(): number {
    const hw = this.halfWorld;
    return Math.max(0.3, this.w / (2 * hw.x), this.h / (2 * hw.y)) * 1.01;
  }

  /** Screen offset from the view center, in tiles. */
  private screenToTiles(dx: number, dy: number): { x: number; y: number } {
    return { x: (dx / HALF_W + dy / HALF_H) / 2 / this.zoom, y: (dy / HALF_H - dx / HALF_W) / 2 / this.zoom };
  }

  zoomBy(factor: number, sx = this.w / 2, sy = this.h / 2): void {
    const before = this.screenToTiles(sx - this.w / 2, sy - this.h / 2);
    const anchor = { x: this.cam.x + before.x, y: this.cam.y + before.y };
    this.zoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.zoom * factor));
    const after = this.screenToTiles(sx - this.w / 2, sy - this.h / 2);
    this.cam.x = anchor.x - after.x;
    this.cam.y = anchor.y - after.y;
    this.applyCamera();
  }

  resetCamera(): void {
    this.zoom = DEFAULT_ZOOM;
    const c = this.coreCenter();
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.applyCamera();
  }

  /** Zoom in and center the camera on the player's home. */
  focusHome(zoom = 2): void {
    if (!this.hero) return;
    this.zoom = zoom;
    this.cam.x = this.hero.x + 0.5;
    this.cam.y = this.hero.y + 0.5;
    this.applyCamera();
  }

  private coreCenter(): { x: number; y: number } {
    return { x: this.region.cx, y: this.region.cy };
  }

  private applyCamera(): void {
    this.zoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.zoom));
    // The world is a rectangle on screen: keep the view inside it.
    const c = iso(this.region.cx, this.region.cy);
    const hw = this.halfWorld;
    const vx = this.w / 2 / this.zoom, vy = this.h / 2 / this.zoom;
    const at = iso(this.cam.x, this.cam.y);
    const px = Math.max(c.x - hw.x + vx, Math.min(c.x + hw.x - vx, at.x));
    const py = Math.max(c.y - hw.y + vy, Math.min(c.y + hw.y - vy, at.y));
    this.cam.x = (px / HALF_W + py / HALF_H) / 2;
    this.cam.y = (py / HALF_H - px / HALF_W) / 2;
    const p = iso(this.cam.x, this.cam.y);
    this.world.scale.set(this.zoom);
    this.world.position.set(this.w / 2 - p.x * this.zoom, this.h / 2 - p.y * this.zoom);
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number; moved: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      const t = this.screenToTiles(dx, dy);
      this.cam.x -= t.x;
      this.cam.y -= t.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.applyCamera();
    };
    const up = (e: PointerEvent) => {
      const clicked = drag && drag.moved < 6;
      drag = null;
      canvas.style.cursor = "grab";
      if (!clicked) return;
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const wx = (sx - this.world.x) / this.zoom, wy = (sy - this.world.y) / this.zoom;
      this.onPick?.(this.people.pickAt(wx, wy, this.mood()), sx, sy);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    });
  }

  // ------------------------------------------------------------- simulation

  trigger(event: CityEvent): void {
    const w = EVENT_WEATHER[event];
    if (w) {
      this.override = { ...w };
      if (event === "snowstorm") this.snow = Math.max(this.snow, 0.45);
      if (event === "drought") this.drought = Math.max(this.drought, 0.6);
    } else if (event === "pandemic") this.pandemicDays = 30;
    else if (event === "crash" || event === "boom") {
      this.economy = event === "crash" ? "bear" : "boom";
      this.economyDays = 90;
    } else if (event === "clear") {
      this.override = null;
      this.pandemicDays = 0;
      this.economy = "normal";
      this.economyDays = 0;
      this.snow = 0;
      this.drought = 0;
      this.weather = "clear";
      this.weatherFx.set("clear");
    }
    this.rollWeather(this.clock.day);
    this.ground.setLook({ season: this.season, snow: this.snow, drought: this.drought });
  }

  status(): SceneStatus {
    return {
      weather: this.weather,
      season: this.season,
      economy: this.economy,
      snow: this.snow,
      drought: this.drought,
      cars: this.traffic.count,
      people: this.people.count,
      event: this.override?.label ?? (this.pandemicDays > 0 ? "Pandemic" : this.economy === "bear" ? "Bear market" : this.economy === "boom" ? "Boom" : null),
    };
  }

  private mood(): Mood {
    if (this.weather === "storm" || this.override?.kind === "storm") return "storm";
    if (this.pandemicDays > 0) return "pandemic";
    if (this.economy === "bear") return "bear";
    if (this.economy === "boom") return "boom";
    if (this.clock.nightness > 0.6) return "night";
    return "normal";
  }

  private onDay(day: number): void {
    if (this.override && --this.override.days <= 0) this.override = null;
    if (this.pandemicDays > 0) this.pandemicDays--;
    if (this.economyDays > 0 && --this.economyDays === 0) this.economy = "normal";
    this.rollWeather(day);
    const winter = this.clock.season === "winter";
    if (this.weather === "snow") this.snow = Math.min(1, this.snow + 0.3);
    else this.snow = Math.max(0, this.snow - (winter && this.city.snowInWinter ? 0.03 : 0.2));
    // Drought needs a long hot spell to build; any ordinary day lets the grass recover.
    if (this.weather === "heat") this.drought = Math.min(1, this.drought + 0.07);
    else if (this.weather === "rain" || this.weather === "storm") this.drought = Math.max(0, this.drought - 0.35);
    else if (!this.override) this.drought = Math.max(0, this.drought - 0.06);
    if (this.clock.season !== this.season) {
      this.season = this.clock.season;
      this.replant();
    }
    this.ground.setLook({ season: this.season, snow: this.snow, drought: this.drought });
  }

  private rollWeather(day: number): void {
    let next: WeatherKind;
    if (this.override) next = this.override.kind;
    else {
      const rng = rngFor(this.seed, this.city.id, day, "weather");
      if (day > 0 && rng() < 0.55 && this.weather !== "storm") next = this.weather;
      else {
        const c = this.city.climate[this.clock.month];
        let r = rng();
        next = "clear";
        for (const kind of ["storm", "snow", "rain", "fog", "heat", "smoke", "cloudy"] as const) {
          const p = c[kind] ?? 0;
          if (kind === "snow" && !this.city.snowInWinter && p < 0.01) continue;
          if (r < p) {
            next = kind;
            break;
          }
          r -= p;
        }
      }
    }
    this.weather = next;
    this.weatherFx.set(next);
  }

  private replant(): void {
    for (const p of this.plants) p.view.destroy({ children: true });
    const north = this.city.snowInWinter;
    const leaf =
      this.season === "spring" ? 0x6cc24a : this.season === "summer" ? 0x46a83f : this.season === "fall" ? (north ? 0xe0892e : 0x86a83a) : 0x4f8f3a;
    const desert = this.city.outskirts?.terrain === "desert";
    this.plants = plant(this.grid, this.city, this.seed, leaf, north && this.season === "winter", this.snow, desert);
    for (const p of this.plants) {
      p.view.zIndex = depthOf(p.x, p.y, 50);
      p.view.cullable = true;
      p.view.cullArea = footprintRect(p.x, p.y, 1, 1, 60);
      this.objects.addChild(p.view);
    }
    this.lastTint = -1;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.time += dt;
    const night = this.clock.nightness;
    const golden = goldenAt(this.clock.timeOfDay);
    this.weatherFx.update(dt, night);
    const overcast = this.weatherFx.overcast;

    let tint = 0xffffff;
    tint = mix(tint, 0xffd2a6, golden * 0.55);
    tint = mix(tint, 0xc3cbd6, overcast * 0.55);
    tint = mix(tint, 0x46558f, night * 0.82);
    // Retinting thousands of objects is cheap but not free: only when it changes.
    if (tint !== this.lastTint) {
      this.lastTint = tint;
      this.ground.waterLayer.tint = tint;
      this.ground.landLayer.tint = tint;
      for (const b of this.buildings) (b.built.view.children[0] as Container).tint = tint;
      for (const p of this.plants) p.view.tint = tint;
      for (const l of this.landmarks) for (const t of l.tintables) t.tint = tint;
      if (this.hero) for (const t of this.hero.tintables) t.tint = tint;
      for (const t of this.roadProps.tintables) t.tint = tint;
    }
    const lit = night * (this.economy === "bear" ? 0.55 : 1) * (this.pandemicDays > 0 ? 0.7 : 1);
    this.buildings.forEach((b, i) => {
      b.built.lights.alpha = lit;
      for (const blink of b.built.blinkers) blink.alpha = (Math.sin(this.time * 3 + i) > 0.2 ? 1 : 0.15) * Math.max(0.35, night);
    });
    for (const l of this.landmarks) l.update?.(dt);
    this.hero?.update(dt, night);

    // Traffic and foot traffic follow the economy, events, weather, and the hour.
    let cars = this.city.traffic * (this.economy === "bear" ? 0.45 : this.economy === "boom" ? 1.25 : 1);
    let walkers = 150 * (this.economy === "boom" ? 1.2 : 1);
    if (this.pandemicDays > 0) {
      cars *= 0.18;
      walkers *= 0.12;
    }
    if (this.weather === "storm") {
      cars *= 0.4;
      walkers *= 0.2;
    } else if (this.weather === "snow" || this.weather === "rain") {
      cars *= this.weather === "snow" ? 0.55 : 0.9;
      walkers *= 0.5;
    }
    cars *= demand(this.clock.timeOfDay * 24);
    walkers *= 1 - night * 0.7;
    this.traffic.setHour(this.clock.timeOfDay * 24);
    this.traffic.setTarget(Math.round(cars));
    this.traffic.tint = tint;
    this.traffic.update(dt, night);
    this.roadProps.update();
    this.people.setTarget(Math.round(walkers));
    this.people.tint = tint;
    this.people.update(dt, night);
    this.ground.update(this.time, this.weatherFx.stormy);

    // Bear markets drain the color out of the city.
    const wantDesat = this.economy === "bear" ? 1 : 0;
    this.desatLevel += (wantDesat - this.desatLevel) * Math.min(1, dt * 1.5);
    if (this.desatLevel > 0.02) {
      this.desat.saturate(-0.6 * this.desatLevel, false);
      this.world.filters = [this.desat];
    } else this.world.filters = [];
  }

  destroy(): void {
    this.unsubscribe();
    for (const fn of this.cleanup) fn();
    this.root.destroy({ children: true });
  }
}
