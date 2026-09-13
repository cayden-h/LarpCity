// Sammy's guided tours, the part with no DOM: a tour is a list of steps, each a
// line for Sammy, an optional target on screen (in the city or inside the Money
// desk's iframe), an optional setup (open the phone, switch the desk's tab), and
// how it advances (a Next button, or waiting for the player to do the thing).
// TourRun walks the steps, skipping any whose `when` doesn't hold for the
// player's state; the DOM side (ui/tour.ts) draws the spotlight and moves Sammy.
// Which tours the player finished or skipped rides in the save (TourRecord).

import type { OwlAnim } from "../ui/owl.ts";
import type { Mood } from "./poses.ts";

export type TourId = "stocks" | "taxes" | "taxes-refresher";
export const TOUR_IDS: readonly TourId[] = ["stocks", "taxes", "taxes-refresher"];

/** A CSS selector in the city's document or in the Money desk's (the iframe). Every match is spotlit as one box. */
export interface TourTarget {
  doc: "city" | "desk";
  sel: string;
}

/** What to open before a step shows: a phone app, a desk tab, or a fund's page in the desk. */
export type TourSetup = { kind: "phone"; app: "home" | "stocks" } | { kind: "desk"; tab: string } | { kind: "fund"; id: string };

/** What the player has to do before a step moves on: a life event (a trade) or a click on something in the target. */
export type TourAction = { kind: "event"; event: "trade" } | { kind: "click"; sel: string };

export type TourAdvance =
  /** A Next button; `interactive` lets clicks reach the target meanwhile. */
  | { kind: "next"; interactive?: boolean }
  /** "Your turn": waits for the action, and offers Next anyway after `timeoutMs`. */
  | { kind: "action"; on: TourAction; timeoutMs: number };

/** What the player did on an action step: a click's data attributes, or the event. */
export type TourCapture = { kind: "click"; data: Record<string, string | undefined> } | { kind: "event"; event: unknown };

export interface TourStep<C> {
  id: string;
  /** What Sammy says: a fixed line (pre-voiced) or one with the player's numbers (voiced on the fly). */
  line: string | ((c: C) => string);
  anim: OwlAnim;
  mood: Mood;
  target?: TourTarget;
  setup?: TourSetup;
  advance?: TourAdvance;
  /** Shown only when this holds for the player's state; checked as the tour reaches the step. */
  when?: (c: C) => boolean;
  /** Keeps what the player did on this step, for the steps after it. */
  capture?: (c: C, got: TourCapture) => void;
}

export interface TourDef<C> {
  id: TourId;
  /** Sammy's offer before the tour starts ("Want the two-minute tour?"); tours without one just start. */
  offer?: string;
  steps: TourStep<C>[];
}

const NEXT: TourAdvance = { kind: "next" };

/** One run through a tour: where the player is, and moving on, back, and to the end. */
export class TourRun<C> {
  readonly def: TourDef<C>;
  readonly ctx: C;
  /** Index into def.steps; -1 before the first step, steps.length once finished. */
  private at = -1;
  /** Action steps the player already did (or timed out), so going back to one shows Next. */
  private readonly done = new Set<number>();

  constructor(def: TourDef<C>, ctx: C) {
    this.def = def;
    this.ctx = ctx;
    this.at = this.find(0, 1);
  }

  private shows(i: number): boolean {
    const s = this.def.steps[i];
    return !s.when || s.when(this.ctx);
  }

  /** The first step from `i` in direction `dir` that shows, or past the end (-1 or steps.length). */
  private find(i: number, dir: 1 | -1): number {
    while (i >= 0 && i < this.def.steps.length && !this.shows(i)) i += dir;
    return i;
  }

  get step(): TourStep<C> | null {
    return this.def.steps[this.at] ?? null;
  }

  get finished(): boolean {
    return this.at >= this.def.steps.length;
  }

  /** "3 / 11": this step's place among the steps that show for this player. */
  get counter(): string {
    const shown = this.def.steps.map((_, i) => i).filter((i) => this.shows(i));
    return `${Math.max(1, shown.indexOf(this.at) + 1)} / ${shown.length}`;
  }

  /** Whether a step after this one shows (so this one's button reads Next rather than Finish). */
  get canNext(): boolean {
    return this.find(this.at + 1, 1) < this.def.steps.length;
  }

  get canBack(): boolean {
    return this.find(this.at - 1, -1) >= 0;
  }

  /** How this step advances now: an action step already done becomes a Next. */
  get advance(): TourAdvance {
    const a = this.step?.advance ?? NEXT;
    return a.kind === "action" && this.done.has(this.at) ? NEXT : a;
  }

  /** Moves to the next step that shows; false once the tour is over. */
  next(): boolean {
    if (this.finished) return false;
    this.done.add(this.at);
    this.at = this.find(this.at + 1, 1);
    return !this.finished;
  }

  back(): boolean {
    const i = this.find(this.at - 1, -1);
    if (i < 0) return false;
    this.at = i;
    return true;
  }

  /** The player did this step's action: keep what they did and move on. */
  act(got: TourCapture): boolean {
    this.step?.capture?.(this.ctx, got);
    return this.next();
  }

  /** The line for this step, with the player's numbers filled in. */
  line(): string {
    const l = this.step?.line ?? "";
    return typeof l === "string" ? l : l(this.ctx);
  }
}

/** Every fixed line in a tour, for the voice pack; lines with the player's numbers are voiced on the fly. */
export function tourLines(def: TourDef<never> | TourDef<unknown>): string[] {
  const fixed = def.steps.map((s) => s.line).filter((l): l is string => typeof l === "string");
  return def.offer ? [def.offer, ...fixed] : fixed;
}

// ---- The record in the save -------------------------------------------------------------

/** Which tours the player finished or skipped; a tour in here never starts on its own again. */
export type TourRecord = Partial<Record<TourId, "done" | "skipped">>;

export function recordTour(rec: TourRecord, id: TourId, how: "done" | "skipped"): TourRecord {
  return { ...rec, [id]: how };
}

/** Whether a tour may start on its own (the first time its trigger fires). Replays ignore this. */
export function shouldOffer(rec: TourRecord, id: TourId): boolean {
  return rec[id] === undefined;
}

/** A saved record, kept to the known tours and outcomes; anything else (an older save, a typo) is dropped. */
export function parseTourRecord(raw: unknown): TourRecord {
  const out: TourRecord = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const id of TOUR_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (v === "done" || v === "skipped") out[id] = v;
  }
  return out;
}

// ---- Where Sammy stands ------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Side = "right" | "left" | "below" | "above" | "center";

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Where to put Sammy's box (the owl and the bubble) next to `target` inside the
 * viewport: the side that covers the least of the target, and among those the
 * one with the most room. With no target, bottom centre, as between tours.
 */
export function placeBox(target: Rect | null, box: { w: number; h: number }, view: { w: number; h: number }, gap = 14, margin = 8): { x: number; y: number; side: Side } {
  const fitX = (x: number) => clamp(x, margin, view.w - box.w - margin);
  const fitY = (y: number) => clamp(y, margin, view.h - box.h - margin);
  if (!target) return { x: fitX((view.w - box.w) / 2), y: fitY(view.h - box.h - margin), side: "center" };
  const t = target;
  const cx = t.x + t.w / 2 - box.w / 2;
  const cy = t.y + t.h / 2 - box.h / 2;
  const options: { side: Side; x: number; y: number; room: number }[] = [
    { side: "right", x: fitX(t.x + t.w + gap), y: fitY(cy), room: view.w - (t.x + t.w) - box.w },
    { side: "left", x: fitX(t.x - gap - box.w), y: fitY(cy), room: t.x - box.w },
    { side: "below", x: fitX(cx), y: fitY(t.y + t.h + gap), room: view.h - (t.y + t.h) - box.h },
    { side: "above", x: fitX(cx), y: fitY(t.y - gap - box.h), room: t.y - box.h },
  ];
  const scored = options.map((o) => ({ ...o, covered: overlap({ x: o.x, y: o.y, w: box.w, h: box.h }, t) }));
  scored.sort((a, b) => a.covered - b.covered || b.room - a.room);
  const best = scored[0];
  return { x: best.x, y: best.y, side: best.side };
}
