// Screen-space weather: rain, storm (rain + lightning), snow, fog, wildfire
// smoke with embers, and heat haze. Intensity eases in and out so weather
// changes read as spells, not switches.

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { WeatherKind } from "./types";
import { rngFor } from "./rng";

const OVERCAST: Record<WeatherKind, number> = {
  clear: 0,
  cloudy: 0.75,
  rain: 0.9,
  storm: 1,
  snow: 0.85,
  fog: 0.65,
  heat: 0,
  smoke: 0.55,
};

interface Drop {
  s: Sprite;
  vx: number;
  vy: number;
  phase: number;
}

export class WeatherFx {
  readonly view = new Container();
  kind: WeatherKind = "clear";
  /** 0..1, eases toward 1 for the current kind. */
  private level = 0;
  private prevKind: WeatherKind = "clear";
  private readonly rain: Drop[] = [];
  private readonly snow: Drop[] = [];
  private readonly embers: Drop[] = [];
  private readonly fog: Drop[] = [];
  private readonly overlay = new Graphics();
  private readonly flash = new Graphics();
  private flashTimer = 3;
  private w = 1;
  private h = 1;
  private readonly rng = rngFor("weather-fx");
  /** Set when lightning strikes, for the scene to react (e.g. a thunder cue). */
  onLightning: (() => void) | null = null;

  constructor() {
    const blob = Texture.from(softBlob());
    const dot = Texture.from(dotTexture());
    this.view.addChild(this.overlay);
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(blob);
      s.anchor.set(0.5);
      this.view.addChild(s);
      this.fog.push({ s, vx: 8 + this.rng() * 14, vy: 0, phase: this.rng() * 10 });
    }
    for (let i = 0; i < 420; i++) {
      const s = new Sprite(Texture.WHITE);
      s.width = 1.4;
      s.height = 13 + this.rng() * 8;
      s.rotation = 0.22;
      s.tint = 0xd6e6ff;
      this.view.addChild(s);
      this.rain.push({ s, vx: -170, vy: 780 + this.rng() * 260, phase: 0 });
    }
    for (let i = 0; i < 260; i++) {
      const s = new Sprite(dot);
      s.anchor.set(0.5);
      s.scale.set(0.5 + this.rng() * 0.7);
      this.view.addChild(s);
      this.snow.push({ s, vx: -12 + this.rng() * 24, vy: 30 + this.rng() * 40, phase: this.rng() * 6 });
    }
    for (let i = 0; i < 70; i++) {
      const s = new Sprite(dot);
      s.anchor.set(0.5);
      s.scale.set(0.35 + this.rng() * 0.3);
      s.tint = 0xff8a3d;
      this.view.addChild(s);
      this.embers.push({ s, vx: 10 + this.rng() * 20, vy: -(20 + this.rng() * 30), phase: this.rng() * 6 });
    }
    this.view.addChild(this.flash);
    for (const d of [...this.rain, ...this.snow, ...this.embers, ...this.fog]) d.s.visible = false;
  }

  set(kind: WeatherKind): void {
    if (kind === this.kind) return;
    this.prevKind = this.kind;
    this.kind = kind;
    this.level = 0;
  }

  /** How much the sky should use the overcast plate. */
  get overcast(): number {
    return OVERCAST[this.prevKind] * (1 - this.level) + OVERCAST[this.kind] * this.level;
  }

  get stormy(): number {
    return (this.kind === "storm" ? 1 : this.kind === "rain" ? 0.4 : 0) * this.level;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    for (const d of [...this.rain, ...this.snow, ...this.embers]) d.s.position.set(this.rng() * w, this.rng() * h);
    for (const d of this.fog) d.s.position.set(this.rng() * w, h * (0.35 + this.rng() * 0.6));
  }

  update(dt: number, night: number): void {
    this.level = Math.min(1, this.level + dt * 0.5);
    const amount = (k: WeatherKind) => (this.kind === k ? this.level : this.prevKind === k ? 1 - this.level : 0);
    const rain = Math.max(amount("rain") * 0.55, amount("storm"));
    const snow = amount("snow");
    const fog = amount("fog") + amount("smoke") * 0.7;
    const embers = amount("smoke");
    const heat = amount("heat");
    const storm = amount("storm");

    const { w, h } = this;
    const wrap = (d: Drop) => {
      const s = d.s;
      if (s.y > h + 20) s.y = -20;
      if (s.y < -30) s.y = h + 10;
      if (s.x < -30) s.x = w + 20;
      if (s.x > w + 30) s.x = -20;
    };
    this.rain.forEach((d, i) => {
      d.s.visible = i < rain * this.rain.length;
      if (!d.s.visible) return;
      d.s.x += d.vx * dt * (1 + storm * 0.6);
      d.s.y += d.vy * dt;
      d.s.alpha = 0.35 + storm * 0.2;
      wrap(d);
    });
    this.snow.forEach((d, i) => {
      d.s.visible = i < snow * this.snow.length;
      if (!d.s.visible) return;
      d.phase += dt;
      d.s.x += (d.vx + Math.sin(d.phase * 1.3) * 18) * dt;
      d.s.y += d.vy * dt;
      d.s.alpha = 0.9;
      wrap(d);
    });
    this.embers.forEach((d, i) => {
      d.s.visible = i < embers * this.embers.length;
      if (!d.s.visible) return;
      d.phase += dt * 3;
      d.s.x += d.vx * dt;
      d.s.y += d.vy * dt;
      d.s.alpha = 0.6 + 0.4 * Math.sin(d.phase);
      wrap(d);
    });
    const smoky = amount("smoke");
    this.fog.forEach((d) => {
      d.s.visible = fog > 0.01;
      if (!d.s.visible) return;
      d.s.x += d.vx * dt;
      if (d.s.x > w + 300) d.s.x = -300;
      d.s.scale.set(3.2, 1.3);
      d.s.alpha = fog * 0.42;
      d.s.tint = smoky > 0.5 ? 0xb58a6a : night > 0.5 ? 0x6d7690 : 0xf2f5f8;
    });

    // Color wash for the mood of the weather.
    this.overlay.clear();
    if (storm > 0) this.overlay.rect(0, 0, w, h).fill({ color: 0x1b2433, alpha: storm * 0.28 });
    if (smoky > 0) this.overlay.rect(0, 0, w, h).fill({ color: 0xd9772b, alpha: smoky * 0.18 });
    if (heat > 0) this.overlay.rect(0, 0, w, h).fill({ color: 0xffb347, alpha: heat * 0.12 });
    if (snow > 0) this.overlay.rect(0, 0, w, h).fill({ color: 0xe9f1ff, alpha: snow * 0.08 });

    // Lightning: a brief cool flicker (two quick pulses), never a white-out.
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 7);
    if (storm > 0.6) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        const second = this.flashTimer > -0.5 && this.flash.alpha > 0;
        this.flashTimer = second ? 3 + this.rng() * 5 : 0.12;
        this.flash.clear().rect(0, 0, w, h).fill(0xdfe8ff);
        this.flash.alpha = second ? 0.22 : 0.35;
        this.flash.blendMode = "add";
        if (!second) this.onLightning?.();
      }
    }
  }
}

function softBlob(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return c;
}

function dotTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(5, 5, 4, 0, Math.PI * 2);
  g.fill();
  return c;
}
