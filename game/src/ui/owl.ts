// The owl sprite for Sammy, Larp City's narrator and mascot: animation strips cut from the
// artist's sheets (game/art/owl/slice.py writes public/owl/*.webp and
// owl.json), shown in the DOM. One scale fits every strip, and each strip's
// anchor (the head's centre over the feet) sits at the bottom centre of the
// owl's box, so the owl stays put when it changes pose.
//
// Three ways to move (narration/poses.ts has the frame table):
// - play: a motion (wave, cheer, hat tip, fly) in order, at a normal pace.
// - rest: hold a calm pose, with a blink every few seconds and now and then a wink.
// - talk: hold a pose that fits the mood, and change it on the beat of the words.

import { EXPRESSIONS, HOLD, pickPose, type Mood, type Pose } from "../narration/poses";
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
  /** The owl's own height in this strip (hat to feet); sheets come at different resolutions. */
  owlHeight?: number;
}

interface Manifest {
  animations: Record<OwlAnim, Strip>;
}

/** The strips that are sets of poses rather than motions. */
type RestAnim = "idle" | "think" | "proud";
const REST: Record<RestAnim, { calm: readonly number[]; blink: readonly number[]; wink: readonly number[] }> = {
  idle: EXPRESSIONS.idle,
  think: { calm: EXPRESSIONS.think.calm, blink: EXPRESSIONS.think.squint, wink: EXPRESSIONS.think.wink },
  proud: { calm: EXPRESSIONS.proud.calm, blink: EXPRESSIONS.proud.smug, wink: EXPRESSIONS.proud.wink },
};
const isRest = (anim: OwlAnim): anim is RestAnim => anim in REST;

const BASE = `${import.meta.env.BASE_URL}owl/`;
/**
 * How long one pass of each motion takes, in milliseconds, whatever its frame
 * count: 8 and 16-frame sheets play at the same pace. One-shots (a wave, a
 * hat tip) take a second or so; loops (typing, sleeping) take a full cycle.
 */
const DURATION_MS: Partial<Record<OwlAnim, number>> = {
  wave: 1_400,
  cheer: 1_100,
  hop: 1_000,
  "tip-hat": 1_100,
  magic: 1_200,
  fly: 900,
  run: 700,
  step: 1_000,
  read: 1_800,
  type: 1_300,
  sleep: 2_800,
};
const DEFAULT_DURATION_MS = 1_000;
/** Without a word to react to, a talking pose still changes after a while. */
const BEAT_CHANCE = 0.45;

let manifest: Promise<Manifest> | null = null;

function loadOwl(): Promise<Manifest> {
  manifest ??= fetch(`${BASE}owl.json`).then((r) => {
    if (!r.ok) throw new Error(`owl manifest: ${r.status}`);
    return r.json() as Promise<Manifest>;
  });
  return manifest;
}

/** Each strip's image, decoded once and shared by every owl, so no owl shows a strip before it has loaded. */
const decoding = new Map<string, Promise<void>>();
const decoded = new Set<string>();
function decodeStrip(file: string): Promise<void> {
  let p = decoding.get(file);
  if (!p) {
    const img = new Image();
    img.src = BASE + file;
    // A strip that fails to load still counts as done, so the owl shows (as it would have) rather than hiding forever.
    p = img.decode().then(
      () => void decoded.add(file),
      () => void decoded.add(file),
    );
    decoding.set(file, p);
  }
  return p;
}

/** Starts downloading strips so their first frame doesn't flash in. */
export function preloadOwl(anims: OwlAnim[]): void {
  void loadOwl()
    .then((m) => {
      for (const a of anims) void decodeStrip(m.animations[a].file);
    })
    .catch(() => undefined);
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const pickFrom = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class Owl {
  readonly el: HTMLDivElement;
  private readonly sprite: HTMLDivElement;
  /** Standing height in CSS pixels. */
  private size: number;
  private manifest: Manifest | null = null;
  /** The strip whose size and anchor are applied now. */
  private laidOut: OwlAnim | null = null;
  private shown: Pose | null = null;
  /** The latest frame asked for while its strip was still downloading; shown once it has. */
  private wanted: Pose | null = null;
  private mode: "off" | "motion" | "rest" | "talk" = "off";
  private mood: Mood = "plain";
  private pose: Pose | null = null;
  private poseAt = 0;
  private timer = 0;
  private hold = 0;
  private emoteTimer = 0;
  private token = 0;
  /** Resolves the pending play-once promise when something else takes over. */
  private settle: (() => void) | null = null;

  constructor(size: number) {
    this.size = size;
    this.el = document.createElement("div");
    // Hidden, shadow and all, until its first strip has loaded (owl.css), so it never stands as an empty shadow.
    this.el.className = "owl waiting";
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
    this.laidOut = null;
    if (this.shown) this.show(this.shown.anim, this.shown.frame);
  }

  /** How loud the owl is (0 to 1); it bobs a little while it talks. */
  setLevel(level: number): void {
    this.el.style.setProperty("--owl-level", level.toFixed(3));
  }

  /**
   * Plays a motion in order and loops it, or with `then`, plays it once and
   * moves on; the promise resolves when the play-once part ends (or something
   * else takes over). A pose strip (idle, think, proud) rests instead, and
   * with `then` holds that expression for a moment first.
   */
  play(anim: OwlAnim, opts: { then?: OwlAnim } = {}): Promise<void> {
    const { then } = opts;
    if (anim === "talk") {
      this.talk();
      return Promise.resolve();
    }
    if (isRest(anim)) {
      if (!then) {
        this.rest(anim);
        return Promise.resolve();
      }
      return this.emote(anim).then(() => void this.play(then));
    }
    this.cancel();
    const token = ++this.token;
    this.mode = "motion";
    return this.ready().then((m) => {
      if (!m || token !== this.token) return;
      const frames = m.animations[anim].frames;
      let frame = 0;
      this.show(anim, 0);
      if (reducedMotion()) {
        if (then) void this.play(then);
        return;
      }
      return new Promise<void>((resolve) => {
        if (then) this.settle = resolve;
        this.timer = window.setInterval(() => {
          frame++;
          if (frame < frames) return this.show(anim, frame);
          if (!then) {
            frame = 0;
            return this.show(anim, 0);
          }
          clearInterval(this.timer);
          this.settle = null;
          resolve();
          void this.play(then);
        }, (DURATION_MS[anim] ?? DEFAULT_DURATION_MS) / frames);
        if (!then) resolve();
      });
    });
  }

  /** Holds a calm pose of `anim`, blinking now and then. */
  rest(anim: RestAnim = "idle"): void {
    this.cancel();
    const token = ++this.token;
    this.mode = "rest";
    void this.ready().then((m) => {
      if (!m || token !== this.token) return;
      const set = REST[anim];
      const calm = pickFrom(set.calm);
      this.show(anim, calm);
      if (reducedMotion()) return;
      const blinkLater = () => {
        this.hold = window.setTimeout(() => {
          if (token !== this.token) return;
          const wink = Math.random() < HOLD.winkChance;
          this.show(anim, pickFrom(wink ? set.wink : set.blink));
          this.hold = window.setTimeout(() => {
            if (token !== this.token) return;
            this.show(anim, calm);
            blinkLater();
          }, wink ? HOLD.wink : HOLD.blink);
        }, between(HOLD.restMin, HOLD.restMax));
      };
      blinkLater();
    });
  }

  /** Starts talking in `mood`, or changes the mood of the talking in progress (the pose changes on the next beat). */
  talk(mood: Mood = "plain"): void {
    this.mood = mood;
    if (this.mode === "talk") return;
    this.cancel();
    const token = ++this.token;
    this.mode = "talk";
    this.pose = null;
    void this.ready().then((m) => {
      if (m && token === this.token) this.nextPose(token);
    });
  }

  /** A word or syllable starts: the owl may change pose, if it has held this one long enough. */
  beat(): void {
    if (this.mode !== "talk" || !this.pose || reducedMotion()) return;
    if (performance.now() - this.poseAt < HOLD.minTalk) return;
    if (Math.random() < BEAT_CHANCE) this.nextPose(this.token);
  }

  /** Holds one pose still (Sammy pointing at a tour's target between lines). */
  holdPose(pose: Pose): void {
    this.cancel();
    const token = ++this.token;
    this.mode = "rest";
    void this.ready().then((m) => {
      if (m && token === this.token) this.show(pose.anim, pose.frame);
    });
  }

  stop(): void {
    this.cancel();
    this.token++;
    this.mode = "off";
  }

  /** Holds an expression of a pose strip for a moment. */
  private emote(anim: RestAnim): Promise<void> {
    this.rest(anim);
    const token = this.token;
    return new Promise<void>((resolve) => {
      this.settle = resolve;
      this.emoteTimer = window.setTimeout(() => {
        if (token !== this.token) return;
        this.settle = null;
        resolve();
      }, reducedMotion() ? 0 : HOLD.emote);
    });
  }

  private nextPose(token: number): void {
    clearTimeout(this.hold);
    this.pose = pickPose(this.mood, this.pose);
    this.poseAt = performance.now();
    this.show(this.pose.anim, this.pose.frame);
    if (reducedMotion()) return;
    this.hold = window.setTimeout(() => {
      if (token === this.token) this.nextPose(token);
    }, between(HOLD.minTalk * 2, HOLD.maxTalk));
  }

  private ready(): Promise<Manifest | null> {
    return loadOwl().then(
      (m) => (this.manifest = m),
      () => null,
    );
  }

  private cancel(): void {
    clearInterval(this.timer);
    clearTimeout(this.hold);
    clearTimeout(this.emoteTimer);
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }

  private show(anim: OwlAnim, frame: number): void {
    const m = this.manifest;
    if (!m) return;
    const strip = m.animations[anim];
    // A strip still downloading would leave the box empty: keep the last frame (or stay hidden) until it has loaded.
    if (!decoded.has(strip.file)) {
      this.wanted = { anim, frame };
      void decodeStrip(strip.file).then(() => {
        const w = this.wanted;
        if (w?.anim !== anim) return;
        this.wanted = null;
        this.show(w.anim, w.frame);
      });
      return;
    }
    this.wanted = null;
    // Scale by the owl's own height in this strip, so it stands the same size whichever sheet a pose came from.
    const s = this.size / (strip.owlHeight ?? m.animations.idle.frameHeight);
    if (this.laidOut !== anim) {
      const st = this.sprite.style;
      st.width = `${strip.frameWidth * s}px`;
      st.height = `${strip.frameHeight * s}px`;
      st.left = `calc(50% - ${strip.anchorX * s}px)`;
      st.top = `calc(100% - ${strip.anchorY * s}px)`;
      st.backgroundImage = `url("${BASE}${strip.file}")`;
      st.backgroundSize = `${strip.frameWidth * strip.frames * s}px ${strip.frameHeight * s}px`;
      this.laidOut = anim;
    }
    this.sprite.style.backgroundPosition = `${-frame * strip.frameWidth * s}px 0`;
    this.shown = { anim, frame };
    this.el.classList.remove("waiting");
  }
}
