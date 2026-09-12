// The owl, Larp City's narrator and mascot: animation strips cut from the
// artist's sheets (game/art/owl/slice.py writes public/owl/*.webp and
// owl.json), played frame by frame in the DOM. One scale fits every
// animation, and each strip's anchor (the head's centre over the feet) sits
// at the bottom centre of the owl's box, so the owl stays put when it
// switches from talking to thinking.

import "./owl.css";

export type OwlAnim =
  | "idle"
  | "talk"
  | "wave"
  | "think"
  | "cheer"
  | "magic"
  | "step"
  | "run"
  | "fly"
  | "hop"
  | "tip-hat"
  | "proud"
  | "read"
  | "type"
  | "sleep";

interface Strip {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  anchorX: number;
  anchorY: number;
}

interface Manifest {
  animations: Record<OwlAnim, Strip>;
}

const BASE = `${import.meta.env.BASE_URL}owl/`;
/** Resting loops run slower so the blinks and winks don't flutter. */
const FPS: Partial<Record<OwlAnim, number>> = { idle: 4, think: 5, proud: 5, read: 4, type: 6, sleep: 3 };
const DEFAULT_FPS = 8;

let manifest: Promise<Manifest> | null = null;

function loadOwl(): Promise<Manifest> {
  manifest ??= fetch(`${BASE}owl.json`).then((r) => {
    if (!r.ok) throw new Error(`owl manifest: ${r.status}`);
    return r.json() as Promise<Manifest>;
  });
  return manifest;
}

/** Starts downloading strips so their first frame doesn't flash in. */
export function preloadOwl(anims: OwlAnim[]): void {
  void loadOwl()
    .then((m) => {
      for (const a of anims) new Image().src = BASE + m.animations[a].file;
    })
    .catch(() => undefined);
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Owl {
  readonly el: HTMLDivElement;
  private readonly sprite: HTMLDivElement;
  /** Standing height in CSS pixels. */
  private size: number;
  private current: OwlAnim | null = null;
  private strip: Strip | null = null;
  private scale = 1;
  private frame = 0;
  private timer = 0;
  private token = 0;
  /** Resolves the pending play-once promise when another animation takes over. */
  private settle: (() => void) | null = null;

  constructor(size: number) {
    this.size = size;
    this.el = document.createElement("div");
    this.el.className = "owl";
    this.el.setAttribute("aria-hidden", "true");
    this.el.style.setProperty("--owl-size", `${size}px`);
    this.sprite = document.createElement("div");
    this.sprite.className = "owl-sprite";
    this.el.appendChild(this.sprite);
  }

  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.el.style.setProperty("--owl-size", `${size}px`);
    if (this.current) void this.play(this.current);
  }

  /** How loud the owl is (0 to 1); it bobs a little while it talks. */
  setLevel(level: number): void {
    this.el.style.setProperty("--owl-level", level.toFixed(3));
  }

  /**
   * Loops `anim`. With `then`, plays `anim` once, then loops `then`; the
   * promise resolves when the play-once part ends (or another animation takes over).
   */
  play(anim: OwlAnim, opts: { then?: OwlAnim } = {}): Promise<void> {
    this.cancel();
    const token = ++this.token;
    return loadOwl().then(
      (m) => {
        if (token !== this.token) return;
        const strip = m.animations[anim];
        this.scale = this.size / m.animations.idle.frameHeight;
        this.current = anim;
        this.strip = strip;
        this.frame = 0;
        this.layout(strip);
        this.draw();
        if (reducedMotion()) return opts.then ? this.play(opts.then) : undefined;
        return new Promise<void>((resolve) => {
          const { then } = opts;
          if (then) this.settle = resolve;
          this.timer = window.setInterval(() => {
            this.frame++;
            if (this.frame < strip.frames) return this.draw();
            if (!then) {
              this.frame = 0;
              return this.draw();
            }
            this.settle = null;
            resolve();
            void this.play(then);
          }, 1000 / (FPS[anim] ?? DEFAULT_FPS));
          if (!then) resolve();
        });
      },
      () => undefined,
    );
  }

  stop(): void {
    this.cancel();
    this.token++;
  }

  private cancel(): void {
    clearInterval(this.timer);
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }

  private layout(strip: Strip): void {
    const s = this.scale;
    const st = this.sprite.style;
    st.width = `${strip.frameWidth * s}px`;
    st.height = `${strip.frameHeight * s}px`;
    st.left = `calc(50% - ${strip.anchorX * s}px)`;
    st.top = `calc(100% - ${strip.anchorY * s}px)`;
    st.backgroundImage = `url("${BASE}${strip.file}")`;
    st.backgroundSize = `${strip.frameWidth * strip.frames * s}px ${strip.frameHeight * s}px`;
  }

  private draw(): void {
    if (!this.strip) return;
    this.sprite.style.backgroundPosition = `${-this.frame * this.strip.frameWidth * this.scale}px 0`;
  }
}
