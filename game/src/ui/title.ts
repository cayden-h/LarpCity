// The title screen: the first thing a new life sees. Larp City's name, Sammy,
// and a Learn button over a blurred San Francisco. Learn hands the screen to
// Sammy's real narrator box (ui/narrator.ts) in tour mode, centered, to read
// the walkthrough in narration/learn.ts with Back, Next, and Skip; finishing
// or skipping it (or "Skip to setup") resolves, and the intake opens.

import { LEARN } from "../narration/learn";
import type { Narrator } from "./narrator";
import { Owl, preloadOwl } from "./owl";
import "./title.css";

export interface TitleOptions {
  /** The plate blurred behind the title (San Francisco's, whatever the starting state). */
  backdrop: string;
  /** Sammy, borrowed in tour mode for the walkthrough. */
  narrator: Narrator;
}

const OWL_SIZE = 170;
/** How long the overlay takes to fade (title.css). */
const FADE_MS = 300;

/** Shows the title screen and resolves once the player moves on to setup. */
export function runTitle(o: TitleOptions): Promise<void> {
  if (new URLSearchParams(location.search).get("intake") === "0") return Promise.resolve();
  preloadOwl(["wave", "idle", ...new Set(LEARN.map((s) => s.anim))]);
  return new Promise((resolve) => new Title(o, resolve));
}

class Title {
  private readonly el: HTMLDivElement;
  private readonly narrator: Narrator;
  private readonly resolve: () => void;
  private readonly owl = new Owl(OWL_SIZE);
  /** The walkthrough step on screen, or -1 before Learn. */
  private at = -1;
  private readonly onKey = (ev: KeyboardEvent) => this.key(ev);
  private readonly onResize = () => this.center();

  constructor(o: TitleOptions, resolve: () => void) {
    this.narrator = o.narrator;
    this.resolve = resolve;
    this.el = document.createElement("div");
    this.el.className = "tt-overlay";
    this.el.style.setProperty("--backdrop", `url("${o.backdrop}")`);
    this.el.innerHTML = `
      <section class="tt-home" aria-labelledby="tt-title">
        <h1 class="tt-logo" id="tt-title">Larp City</h1>
        <p class="tt-sub">Your money, your life, all the way to retirement.</p>
        <div class="tt-owl"></div>
        <button type="button" class="btn tt-learn" data-act="learn">Learn</button>
        <button type="button" class="tt-link" data-act="skip">Skip to setup</button>
      </section>`;
    this.el.querySelector(".tt-owl")!.appendChild(this.owl.el);
    this.el.addEventListener("click", (ev) => {
      const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "learn") this.learn();
      else if (act === "skip") this.finish();
    });
    document.body.appendChild(this.el);
    void this.owl.play("wave", { then: "idle" });
    this.el.querySelector<HTMLButtonElement>("[data-act=learn]")!.focus();
  }

  private learn(): void {
    this.el.classList.add("learning");
    this.owl.stop();
    this.narrator.beginTour({ next: () => this.go(1), back: () => this.go(-1), skip: () => this.finish() });
    addEventListener("keydown", this.onKey, true);
    addEventListener("resize", this.onResize);
    this.show(0);
  }

  private go(dir: 1 | -1): void {
    const i = this.at + dir;
    if (i >= LEARN.length) this.finish();
    else if (i >= 0) this.show(i);
  }

  private show(i: number): void {
    this.at = i;
    const s = LEARN[i];
    // tourLine lays the line out before its first await, so Sammy is centered at his real size.
    void this.narrator.tourLine({
      line: s.line,
      anim: s.anim,
      mood: s.mood,
      counter: `${i + 1} / ${LEARN.length}`,
      back: i > 0,
      next: i === LEARN.length - 1 ? "finish" : "next",
      pointing: false,
    });
    this.center();
  }

  /** Sammy and his bubble in the middle of the screen, a little above center. */
  private center(): void {
    const { w, h } = this.narrator.box();
    this.narrator.place(Math.max(8, (innerWidth - w) / 2), Math.max(8, (innerHeight - h) * 0.45), "right", null);
  }

  private key(ev: KeyboardEvent): void {
    if (ev.key === "Escape") this.finish();
    else if (ev.key === "ArrowLeft") this.go(-1);
    else if (ev.key === "ArrowRight") this.go(1);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  private finish(): void {
    if (this.el.classList.contains("leaving")) return;
    removeEventListener("keydown", this.onKey, true);
    removeEventListener("resize", this.onResize);
    if (this.at >= 0) this.narrator.endTour();
    this.el.classList.add("leaving");
    this.owl.stop();
    window.setTimeout(() => this.el.remove(), FADE_MS);
    // The intake (above, at z-index 30) fades in over the title as it goes.
    this.resolve();
  }
}
