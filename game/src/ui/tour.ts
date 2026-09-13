// Sammy's guided tours on screen (the steps and their logic are in
// narration/tour.ts, the two tours in narration/tours.ts). While a tour is open:
// - the city's clock is held (Clock.held), so it resumes at the same speed after,
//   and the speed buttons, skips, and fast-forward stay off;
// - everything but the step's target is dimmed and blocked, with a pixel frame
//   around the target; the frame re-finds its target every animation frame, so
//   it follows scrolling, resizing, and the Money desk's re-renders, and targets
//   inside the desk's iframe are offset by the iframe's place on the page;
// - Sammy stands beside the target on the side with the most room, points at it,
//   and reads the step (ui/narrator.ts), with Back, Next, and Skip.
// Finishing or skipping a tour records it in the save, so it never starts on its
// own again; the Stocks header's "?" and the desk's Taxes tab replay it, and so
// does larp.tour("stocks") from the console. A reload mid-tour starts that tour
// over from its first step (sessionStorage remembers it was open).

import type { Clock } from "../engine/clock";
import { placeBox, recordTour, shouldOffer, TourRun, type Rect, type TourCapture, type TourDef, type TourId, type TourRecord, type TourStep, type TourTarget } from "../narration/tour";
import { STOCKS_TOUR, stocksContext, TAXES_REFRESHER, TAXES_TOUR, taxesContext } from "../narration/tours";
import type { LifeEvent, PlayerLife } from "../sim/life";
import type { DeskState } from "../sim/save/types";
import type { Narrator } from "./narrator";
import type { Phone } from "./phone";
import "./tour.css";

const OPEN_KEY = "larp.tour.open";
/** How long a step waits for its target to appear (a desk page loading) before showing without it. */
const FIND_MS = 4_000;
/** Room around the target inside the frame. */
const PAD = 3;
/** Sammy only moves when the target moves more than this, so a smooth scroll doesn't make him jitter. */
const MOVE_PX = 24;

export interface TourDeps {
  narrator: Narrator;
  clock: Clock;
  phone: Phone;
  life: () => PlayerLife;
  /** What the Money desk last reported (its statement, for the paycheck step). */
  deskState: () => DeskState | null;
  record: () => TourRecord;
  save: (record: TourRecord) => void;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sameRect = (a: Rect | null, b: Rect | null, px = 1) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < px && Math.abs(a.y - b.y) < px && Math.abs(a.w - b.w) < px && Math.abs(a.h - b.h) < px);

/** A stepped pixel rectangle, as an SVG path: corners cut in two `s`-pixel steps. */
function stepped(x: number, y: number, w: number, h: number, s: number): string {
  const r = x + w;
  const b = y + h;
  return `M${x + 2 * s} ${y}H${r - 2 * s}V${y + s}H${r - s}V${y + 2 * s}H${r}V${b - 2 * s}H${r - s}V${b - s}H${r - 2 * s}V${b}H${x + 2 * s}V${b - s}H${x + s}V${b - 2 * s}H${x}V${y + 2 * s}H${x + s}V${y + s}Z`;
}

/** The scrolling box an element sits in (the phone's list, the desk's page), or null for the page itself. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export class TourGuide {
  private readonly deps: TourDeps;
  private readonly overlay: HTMLDivElement;
  private readonly hole: HTMLDivElement;
  private readonly frame: SVGSVGElement;
  private readonly blockers: HTMLDivElement[];
  private readonly holeBlock: HTMLDivElement;
  // Each tour's context type differs; the run only hands it back to its own steps.
  private run: TourRun<any> | null = null;
  private raf = 0;
  private shown: Rect | null = null;
  private placedFor: Rect | null = null;
  private waitTimer = 0;
  private scrolledAt = 0;
  private stepToken = 0;
  private clickOff: (() => void) | null = null;
  /** The element carrying aria-describedby (or aria-description in the desk) for this step. */
  private described: HTMLElement | null = null;
  /** Tours offered this visit, so "Later" doesn't ask again on every open. */
  private readonly offered = new Set<TourId>();
  /** The Money desk's window, once its Esc is watched. */
  private readonly watched = new WeakSet<Window>();

  constructor(deps: TourDeps) {
    this.deps = deps;
    this.overlay = document.createElement("div");
    this.overlay.className = "tour-layer";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "region");
    this.overlay.setAttribute("aria-label", "Sammy's tutorial. Only the highlighted part can be used.");
    this.overlay.innerHTML = `<div class="tour-hole"></div>
      <svg class="tour-frame" aria-hidden="true"><path class="tf-edge" fill-rule="evenodd"/><path class="tf-glow" fill-rule="evenodd"/></svg>
      <div class="tour-block"></div><div class="tour-block"></div><div class="tour-block"></div><div class="tour-block"></div>
      <div class="tour-block hole-block"></div>`;
    this.hole = this.overlay.querySelector<HTMLDivElement>(".tour-hole")!;
    this.frame = this.overlay.querySelector<SVGSVGElement>(".tour-frame")!;
    const blocks = [...this.overlay.querySelectorAll<HTMLDivElement>(".tour-block")];
    this.holeBlock = blocks.pop()!;
    this.blockers = blocks;
    document.body.appendChild(this.overlay);

    // Esc skips; captured first, so the phone doesn't also close the Money window.
    window.addEventListener("keydown", (ev) => this.onKey(ev), true);
    deps.life().onEvents((events) => this.onLifeEvents(events));
  }

  get active(): boolean {
    return this.run !== null || this.overlay.dataset.offer === "1";
  }

  /** A tour's trigger fired (the Stocks app opened, a crash, the Taxes app opened). Starts or offers it if it hasn't run yet. */
  trigger(what: "stocks" | "crash" | "taxes"): void {
    if (this.active) return;
    const rec = this.deps.record();
    if (what !== "taxes") {
      if (shouldOffer(rec, "stocks") && !this.offered.has("stocks")) void this.offer(STOCKS_TOUR);
      return;
    }
    const life = this.deps.life();
    if (!life.pendingTaxReturn() || life.taxTutorial.passed) return;
    // Missed last year's bottom line: the short refresher runs with this year's quiz.
    if (life.taxTutorial.done) {
      if (!this.offered.has("taxes-refresher")) {
        this.offered.add("taxes-refresher");
        void this.start("taxes-refresher");
      }
    } else if (shouldOffer(rec, "taxes")) void this.start("taxes");
  }

  /** Plays a tour again from the start (the "?" buttons and larp.tour). */
  replay(id: "stocks" | "taxes"): void {
    if (this.active) return;
    const life = this.deps.life();
    const refresher = id === "taxes" && life.pendingTaxReturn() && life.taxTutorial.done && !life.taxTutorial.passed;
    void this.start(refresher ? "taxes-refresher" : id);
  }

  /** After a reload mid-tour: that tour starts over. */
  resume(): void {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(OPEN_KEY);
    } catch {
      return;
    }
    if (id === "stocks") void this.start(id);
    // A taxes tour only makes sense while the return it walks through is still waiting.
    else if (id === "taxes" || id === "taxes-refresher") {
      const life = this.deps.life();
      if (life.pendingTaxReturn() && !life.taxTutorial.passed) void this.start(id);
      else this.forget();
    }
  }

  private forget(): void {
    try {
      sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  private def(id: TourId): TourDef<any> {
    return id === "stocks" ? STOCKS_TOUR : id === "taxes" ? TAXES_TOUR : TAXES_REFRESHER;
  }

  private context(id: TourId): unknown {
    const life = this.deps.life();
    if (id === "stocks") return stocksContext(life, this.deps.clock.day);
    // The Cash tab shows the newest 40 lines; the paycheck step points at one of them.
    const paycheck = (this.deps.deskState()?.bank ?? []).slice(0, 40).some((t) => t.name === "Payroll direct deposit");
    return taxesContext(life, { paycheck });
  }

  /** Waits until the Money desk isn't asking a decision (a crash, a bill), so the tour never covers one. */
  private async calm(): Promise<void> {
    while (this.deps.phone.deskDocument()?.querySelector(".sheet-back")) await new Promise((r) => setTimeout(r, 400));
  }

  /** Sammy asks first ("Want the two-minute tour?"), with Sure and Later. */
  private async offer(def: TourDef<any>): Promise<void> {
    this.offered.add(def.id);
    await this.calm();
    if (this.active) return;
    this.overlay.dataset.offer = "1";
    const { narrator } = this.deps;
    const close = () => {
      delete this.overlay.dataset.offer;
      narrator.endTour();
    };
    narrator.beginTour({
      next: () => {
        delete this.overlay.dataset.offer;
        void this.start(def.id, true);
      },
      back: () => undefined,
      skip: close,
    });
    void narrator.tourLine({ line: def.offer!, anim: "wave", mood: "warm", counter: "", back: false, next: "offer", pointing: false });
    narrator.place(...this.spot(null));
  }

  private spot(target: Rect | null): [number, number, ReturnType<typeof placeBox>["side"], Rect | null] {
    const p = placeBox(target, this.deps.narrator.box(), { w: innerWidth, h: innerHeight });
    return [p.x, p.y, p.side, target];
  }

  async start(id: TourId, fromOffer = false): Promise<void> {
    if (this.run) return;
    await this.calm();
    const { narrator, clock } = this.deps;
    const run = new TourRun(this.def(id), this.context(id));
    // Nothing in this tour applies to the player right now.
    if (run.finished) return this.forget();
    this.run = run;
    clock.held = true;
    this.deps.phone.tourChanged(true);
    try {
      sessionStorage.setItem(OPEN_KEY, id);
    } catch {
      // A reload then just doesn't bring the tour back.
    }
    this.overlay.hidden = false;
    this.overlay.classList.toggle("reduced", reducedMotion());
    // From the offer, Sammy is already up; this hands his buttons to the tour.
    narrator.beginTour({ next: () => this.onNext(), back: () => this.onBack(), skip: () => this.finish("skipped") });
    void fromOffer;
    this.loop();
    void this.showStep();
  }

  private onNext(): void {
    if (!this.run) return;
    if (!this.run.next()) return this.finish("done");
    void this.showStep();
  }

  private onBack(): void {
    if (this.run?.back()) void this.showStep();
  }

  private finish(how: "done" | "skipped"): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.stepToken++;
    this.clearStep();
    cancelAnimationFrame(this.raf);
    this.overlay.hidden = true;
    this.shown = this.placedFor = null;
    this.deps.clock.held = false;
    this.deps.phone.tourChanged(false);
    try {
      sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // Nothing to clear.
    }
    this.deps.save(recordTour(this.deps.record(), run.def.id, how));
    this.deps.narrator.endTour();
  }

  private clearStep(): void {
    clearTimeout(this.waitTimer);
    this.clickOff?.();
    this.clickOff = null;
    if (this.described) {
      this.described.removeAttribute("aria-describedby");
      this.described.removeAttribute("aria-description");
      this.described = null;
    }
  }

  /** Opens what the step needs, finds its target, scrolls to it, and has Sammy read the line. */
  private async showStep(): Promise<void> {
    const run = this.run;
    const step = run?.step;
    if (!run || !step) return;
    const token = ++this.stepToken;
    this.clearStep();
    this.setup(step);
    const target = step.target ? await this.find(step.target, token) : null;
    if (token !== this.stepToken) return;
    if (target) this.scrollTo(target[0]);
    // Let a smooth scroll settle before placing Sammy: the target in view and still for two checks.
    let rect: Rect | null = null;
    if (step.target) {
      const until = performance.now() + 1_500;
      let last: Rect | null = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 60));
        if (token !== this.stepToken) return;
        rect = this.rectOf(step.target);
        if ((rect && sameRect(rect, last)) || performance.now() > until) break;
        last = rect;
      }
    }
    this.shown = null;
    this.draw(rect, step);
    const from = this.placedFor;
    const flew = !!from && !!rect && Math.hypot(from.x - rect.x, from.y - rect.y) > 240;
    if (target) this.describe(target[0], step.target!);
    const advance = run.advance;
    const last = !run.canNext;
    const view = {
      line: run.line(),
      anim: step.anim,
      mood: step.mood,
      counter: run.counter,
      back: run.canBack,
      next: advance.kind === "action" ? ("wait" as const) : last ? ("finish" as const) : ("next" as const),
      pointing: rect !== null,
    };
    if (advance.kind === "action") this.awaitAction(step, advance.on, advance.timeoutMs, token);
    // tourLine lays the line out before its first await, so Sammy is placed at his real size.
    const reading = this.deps.narrator.tourLine(view, { flew });
    this.placeSammy(rect);
    await reading;
  }

  private setup(step: TourStep<unknown>): void {
    const { phone } = this.deps;
    const s = step.setup;
    if (!s) return;
    if (s.kind === "phone") {
      phone.closeMoney();
      phone.openApp(s.app);
    } else if (s.kind === "desk") phone.openMoney({ tab: s.tab });
    else phone.openMoney({ stock: s.id });
  }

  private doc(t: TourTarget): Document | null {
    return t.doc === "city" ? document : this.deps.phone.deskDocument();
  }

  private elements(t: TourTarget): HTMLElement[] {
    const doc = this.doc(t);
    if (!doc) return [];
    return [...doc.querySelectorAll<HTMLElement>(t.sel)].filter((e) => e.getClientRects().length > 0);
  }

  /** Waits for the target to be on the page (a desk tab or fund page rendering), up to FIND_MS. */
  private async find(t: TourTarget, token: number): Promise<HTMLElement[] | null> {
    const until = performance.now() + FIND_MS;
    for (;;) {
      const els = this.elements(t);
      if (els.length) return els;
      if (performance.now() > until || token !== this.stepToken) return null;
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  /** Scrolls the target's scrolling box (or page) so the target sits in the middle, or its top shows when it's taller. */
  private scrollTo(el: HTMLElement): void {
    this.scrolledAt = performance.now();
    const doc = el.ownerDocument;
    const box = scroller(el);
    const view = box ? box.getBoundingClientRect() : { top: 0, height: doc.defaultView!.innerHeight };
    const r = el.getBoundingClientRect();
    const scrolling = box ?? (doc.scrollingElement as HTMLElement | null);
    if (!scrolling) return;
    const offset = r.height > view.height - 24 ? r.top - view.top - 12 : r.top - view.top - (view.height - r.height) / 2;
    if (Math.abs(offset) < 4) return;
    // Smooth in the city (the phone's list); instant in the desk, whose re-renders cut a smooth scroll short.
    const smooth = !reducedMotion() && doc === document;
    scrolling.scrollTo({ top: scrolling.scrollTop + offset, behavior: smooth ? "smooth" : "auto" });
  }

  /** Whether an element shows whole in its scrolling box (or page), or fills it when it's taller. */
  private inView(el: HTMLElement): boolean {
    const box = scroller(el);
    const view = box ? box.getBoundingClientRect() : { top: 0, bottom: el.ownerDocument.defaultView!.innerHeight };
    const r = el.getBoundingClientRect();
    if (r.height > view.bottom - view.top - 24) return r.top <= view.top + 12 && r.bottom >= view.top + 24;
    return r.top >= view.top - 1 && r.bottom <= view.bottom + 1;
  }

  /** Every match's box as one rect in the city's coordinates, clipped to what's visible (the iframe, the phone's list). */
  private rectOf(t: TourTarget): Rect | null {
    const els = this.elements(t);
    if (!els.length) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const e of els) {
      const r = e.getBoundingClientRect();
      x1 = Math.min(x1, r.left);
      y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right);
      y2 = Math.max(y2, r.bottom);
    }
    // Clipped to the scrolling box the first match sits in, so a long group doesn't spill out of the phone.
    const box = scroller(els[0]);
    if (box) {
      const c = box.getBoundingClientRect();
      x1 = Math.max(x1, c.left);
      y1 = Math.max(y1, c.top);
      x2 = Math.min(x2, c.right);
      y2 = Math.min(y2, c.bottom);
    }
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (t.doc === "desk") {
      const frame = this.deps.phone.deskFrame();
      const f = frame.getBoundingClientRect();
      const ox = f.left + frame.clientLeft;
      const oy = f.top + frame.clientTop;
      x1 += ox;
      x2 += ox;
      y1 += oy;
      y2 += oy;
      clip = { left: ox, top: oy, right: ox + frame.clientWidth, bottom: oy + frame.clientHeight };
    }
    x1 = Math.max(x1, clip.left);
    y1 = Math.max(y1, clip.top);
    x2 = Math.min(x2, clip.right);
    y2 = Math.min(y2, clip.bottom);
    if (x2 - x1 < 2 || y2 - y1 < 2) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** The target and everything around it: the dim with its cutout, the frame, and the click blockers. */
  private draw(rect: Rect | null, step: TourStep<unknown> | null): void {
    if (sameRect(rect, this.shown) && step === null) return;
    this.shown = rect;
    const W = innerWidth;
    const H = innerHeight;
    // Whole pixels, from edges rounded once, so the dim pieces meet without a hairline gap.
    const x1 = Math.round(rect ? rect.x - PAD : W / 2);
    const y1 = Math.round(rect ? rect.y - PAD : H / 2);
    const x2 = Math.round(rect ? rect.x + rect.w + PAD : W / 2);
    const y2 = Math.round(rect ? rect.y + rect.h + PAD : H / 2);
    const r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    const set = (el: HTMLElement | SVGElement, x: number, y: number, w: number, h: number) => {
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.width = `${Math.max(0, Math.round(w))}px`;
      el.style.height = `${Math.max(0, Math.round(h))}px`;
    };
    set(this.hole, r.x, r.y, r.w, r.h);
    const [top, bottom, left, right] = this.blockers;
    if (!rect) {
      // No target: one piece dims everything (pieces meeting at a zero-size hole leave a seam).
      set(top, 0, 0, W, H);
      for (const el of [bottom, left, right, this.holeBlock, this.hole]) set(el, 0, 0, 0, 0);
      this.frame.style.display = "none";
      return;
    }
    set(top, 0, 0, W, r.y);
    set(bottom, 0, r.y + r.h, W, H - r.y - r.h);
    set(left, 0, r.y, r.x, r.h);
    set(right, r.x + r.w, r.y, W - r.x - r.w, r.h);
    set(this.holeBlock, r.x, r.y, r.w, r.h);
    const advance = this.run?.advance;
    const through = advance?.kind === "action" || (advance?.kind === "next" && advance.interactive);
    this.holeBlock.hidden = !!through;
    this.frame.style.display = rect ? "" : "none";
    if (!rect) return;
    // The frame: a dark edge ring and a yellow ring inside it, 4px pixels with stepped corners,
    // drawn just outside the padded cutout so it never touches the target's own edge.
    const E = 4;
    const RING = 2 * E + 2;
    const w = Math.round(r.w) + 2 * RING;
    const h = Math.round(r.h) + 2 * RING;
    set(this.frame, r.x - RING, r.y - RING, w, h);
    this.frame.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.frame.querySelector(".tf-edge")!.setAttribute("d", stepped(0, 0, w, h, 4) + stepped(E * 2 + 2, E * 2 + 2, w - E * 4 - 4, h - E * 4 - 4, 2));
    this.frame.querySelector(".tf-glow")!.setAttribute("d", stepped(2, 2, w - 4, h - 4, 3) + stepped(E * 2, E * 2, w - E * 4, h - E * 4, 2));
  }

  private placeSammy(rect: Rect | null): void {
    this.placedFor = rect;
    this.deps.narrator.place(...this.spot(rect));
  }

  /** Follows the target every frame: the desk re-renders, the player scrolls, the window resizes. */
  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      // Esc inside the Money desk's iframe skips too (its key events never reach this window).
      const win = this.deps.phone.deskFrame().contentWindow;
      if (win && !this.watched.has(win)) {
        this.watched.add(win);
        win.addEventListener("keydown", (ev) => this.onKey(ev), true);
      }
      const step = this.run?.step;
      if (!step?.target) return;
      const rect = this.rectOf(step.target);
      // Scrolled partly or wholly out of view (the desk resetting its scroll as it opens a page, a
      // quick Next cutting a scroll short): bring it back, a little while after the last scroll.
      if (performance.now() - this.scrolledAt > 700) {
        const first = this.elements(step.target)[0];
        if (first && !this.inView(first)) this.scrollTo(first);
      }
      if (!sameRect(rect, this.shown)) this.draw(rect, null);
      if (!sameRect(rect, this.placedFor, MOVE_PX)) this.placeSammy(rect);
      // The desk replaces its HTML often: put the description back on the new element.
      const first = this.elements(step.target)[0];
      if (first && first !== this.described) this.describe(first, step.target);
    };
    tick();
  }

  /** Points the target's description at Sammy's bubble (a text copy inside the desk's iframe, where ids don't reach). */
  private describe(el: HTMLElement, t: TourTarget): void {
    if (this.described && this.described !== el) {
      this.described.removeAttribute("aria-describedby");
      this.described.removeAttribute("aria-description");
    }
    this.described = el;
    if (t.doc === "city") el.setAttribute("aria-describedby", "nr-text");
    else el.setAttribute("aria-description", this.run?.line().replace(/\[[^\]]*\]\s*/g, "") ?? "");
  }

  /** "Your turn": the step moves on when the player does it, or offers Next after the timeout. */
  private awaitAction(step: TourStep<unknown>, on: { kind: "event"; event: "trade" } | { kind: "click"; sel: string }, timeoutMs: number, token: number): void {
    this.waitTimer = window.setTimeout(() => {
      if (token === this.stepToken) this.deps.narrator.setNext("next");
    }, timeoutMs);
    if (on.kind !== "click") return;
    const doc = step.target ? this.doc(step.target) : null;
    if (!doc) return;
    // Captured before the desk's own handler, which re-renders the page.
    const onClick = (ev: Event) => {
      const hit = (ev.target as HTMLElement | null)?.closest<HTMLElement>(on.sel);
      if (!hit || token !== this.stepToken) return;
      const data = { ...hit.dataset };
      setTimeout(() => this.acted({ kind: "click", data }, token), 0);
    };
    doc.addEventListener("click", onClick, true);
    this.clickOff = () => doc.removeEventListener("click", onClick, true);
  }

  private onLifeEvents(events: LifeEvent[]): void {
    const advance = this.run?.advance;
    if (advance?.kind !== "action" || advance.on.kind !== "event") return;
    const want = advance.on.event;
    const hit = events.find((e) => e.type === want);
    if (hit) this.acted({ kind: "event", event: hit }, this.stepToken);
  }

  private acted(got: TourCapture, token: number): void {
    if (!this.run || token !== this.stepToken) return;
    if (!this.run.act(got)) return this.finish("done");
    void this.showStep();
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.active || ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (this.run) this.finish("skipped");
    else {
      delete this.overlay.dataset.offer;
      this.deps.narrator.endTour();
    }
  }
}
