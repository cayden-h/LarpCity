// Sammy, the owl, narrates the player's life: he stands at the bottom of the city with
// a speech bubble, reacts, then reads the line in his voice (the
// server's /api/voice/tts on the expressive model) while each word lights up
// as it's spoken. Lines and their timing rules live in narration/lines.ts.
// While he talks, Sammy holds poses that fit the mood of each word and
// changes them on the words' beats (narration/poses.ts). Muting (remembered
// per browser) keeps the captions and drops the voice; without the server,
// or before the page may play sound, Sammy reads the line on screen.
//
// Tours (ui/tour.ts) borrow the same Sammy: in tour mode he stands next to
// what the tour points at, the bubble stays up with Back, Next, and Skip, and
// the lines skip the cue timing rules. Cues that fire meanwhile wait in the
// queue and play once the tour ends.
//
// The voice plays through Web Audio rather than an <audio> element: Chrome
// holds back loading media elements in background tabs, which would leave
// Sammy mid-sentence until the player came back, and the audio clock and
// an analyser give exact word timing and a real loudness for his bob.

import { apiFetch } from "../net/api";
import { CueGate, CUES, NARRATOR_NAME, pickLine, stripTags, type Cue } from "../narration/lines";
import { POINT_POSE, wordMoods, type Mood } from "../narration/poses";
import type { Rect, Side } from "../narration/tour";
import { Owl, preloadOwl, type OwlAnim } from "./owl";
import "./narrator.css";

// The storage key keeps its old "narrator" id, so saved mute settings still apply (see NARRATOR_NAME).
const MUTE_KEY = "larp.narrator.muted";
/** How long the bubble stays up after the last word. */
const LINGER_MS = 2_600;
/** Reading pace for a line shown without the voice. */
const SILENT_WORD_MS = 330;
const VOICE_TIMEOUT_MS = 9_000;
/** Without a click on the page yet, the browser keeps audio suspended; don't wait long to find out. */
const RESUME_TIMEOUT_MS = 400;
/** Caption and pose updates; a timer rather than animation frames, which stop in background tabs. */
const TICK_MS = 50;
const QUEUE_MAX = 2;
/** Sammy's standing height between tours, and during one on a wide and a narrow screen. */
const OWL_SIZE = 118;
const TOUR_OWL = { wide: 104, narrow: 76 };

/** A voiced line: MP3 bytes and when each word starts, in seconds. */
interface Spoken {
  audio: ArrayBuffer;
  words: { word: string; start: number }[];
}

/** The narration pack (scripts/build-narration.ts): every line voiced ahead of time, so playing one costs no credits. */
interface Pack {
  lines: Record<string, { file: string; words: Spoken["words"] }>;
}
const PACK_BASE = `${import.meta.env.BASE_URL}narration/`;
let pack: Promise<Pack | null> | null = null;
function loadPack(): Promise<Pack | null> {
  pack ??= fetch(`${PACK_BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Pack>) : null))
    .catch(() => null);
  return pack;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** What the tour's buttons do. */
export interface TourHandlers {
  next: () => void;
  back: () => void;
  skip: () => void;
}

/** One tour step as the bubble shows it. */
export interface TourView {
  line: string;
  anim: OwlAnim;
  mood: Mood;
  /** "3 / 11", or "" for the offer. */
  counter: string;
  back: boolean;
  /** next: a Next button; wait: "Your turn" until the player acts; finish: the last step; offer: Sure and Later. */
  next: "next" | "wait" | "finish" | "offer";
  /** Whether Sammy points at a target (then he holds a pointing pose). */
  pointing: boolean;
}

export class Narrator {
  private readonly el: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly controls: HTMLDivElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  private readonly owl = new Owl(OWL_SIZE);
  private readonly gate = new CueGate();
  private readonly lastLine = new Map<Cue, string>();
  private queue: { cue: Cue; line?: string }[] = [];
  private busy = false;
  private muted = readMuted();
  private ctx: AudioContext | null = null;
  /** The line playing now, so mute and dismiss can stop it. */
  private source: AudioBufferSourceNode | null = null;
  /** Bumped when the player dismisses the bubble or a tour moves on, so the line in progress stops. */
  private epoch = 0;
  /** Set while a tour holds Sammy. */
  private tour: TourHandlers | null = null;
  private pointing = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "nr";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="nr-owl"></div>
      <div class="nr-bubble" role="status" aria-live="polite" tabindex="-1">
        <div class="nr-head">
          <span class="nr-name">${NARRATOR_NAME}</span>
          <button type="button" class="nr-btn" data-act="mute"></button>
          <button type="button" class="nr-btn" data-act="close" aria-label="Dismiss ${NARRATOR_NAME}">✕</button>
        </div>
        <p class="nr-text" id="nr-text"></p>
        <div class="nr-tour" hidden>
          <button type="button" class="nr-tb" data-act="tour-back">Back</button>
          <span class="nr-count"></span>
          <button type="button" class="nr-tb ghost" data-act="tour-skip">Skip tutorial</button>
          <button type="button" class="nr-tb go" data-act="tour-next">Next</button>
        </div>
      </div>`;
    this.el.querySelector(".nr-owl")!.appendChild(this.owl.el);
    this.bubble = this.el.querySelector<HTMLDivElement>(".nr-bubble")!;
    this.text = this.el.querySelector<HTMLParagraphElement>(".nr-text")!;
    this.muteBtn = this.el.querySelector<HTMLButtonElement>("[data-act=mute]")!;
    this.controls = this.el.querySelector<HTMLDivElement>(".nr-tour")!;
    this.nextBtn = this.el.querySelector<HTMLButtonElement>("[data-act=tour-next]")!;
    this.backBtn = this.el.querySelector<HTMLButtonElement>("[data-act=tour-back]")!;
    this.skipBtn = this.el.querySelector<HTMLButtonElement>("[data-act=tour-skip]")!;
    this.count = this.el.querySelector<HTMLSpanElement>(".nr-count")!;
    this.el.addEventListener("click", (ev) => {
      const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "mute") this.toggleMute();
      // Dismissing Sammy mid-tour asks nothing: it skips to the end.
      else if (act === "close") (this.tour ? this.tour.skip() : this.dismiss());
      else if (act === "tour-next") this.tour?.next();
      else if (act === "tour-back") this.tour?.back();
      else if (act === "tour-skip") this.tour?.skip();
    });
    document.body.appendChild(this.el);
    // While Sammy is up, the modal windows (map, Money, fast-forward) keep a band at the
    // bottom clear for him (narrator.css); the band follows his real height.
    new ResizeObserver(() => {
      if (this.el.offsetHeight && !this.tour) document.documentElement.style.setProperty("--nr-h", `${this.el.offsetHeight}px`);
    }).observe(this.el);
    this.syncMute();
    // Every reaction, so Sammy never pops in blank while a strip downloads.
    preloadOwl(["idle", "talk", "fly", "read", "step", ...new Set(Object.values(CUES).map((c) => c.anim))]);
    void loadPack();
  }

  /** Speaks a line for `cue` if the timing rules allow it now. */
  cue(cue: Cue): void {
    if (!this.gate.allow(cue, performance.now())) return;
    this.enqueue({ cue });
  }

  /** Speaks `line` (not from the pre-voiced pack) with `as`'s reaction and mood; the server voices it. */
  speak(line: string, as: Cue): void {
    this.enqueue({ cue: as, line });
  }

  private enqueue(item: { cue: Cue; line?: string }): void {
    // Mid-tour, cues wait for the tour to end rather than being dropped; one of each is enough.
    if (this.tour && !item.line && this.queue.some((q) => q.cue === item.cue && !q.line)) return;
    this.queue.push(item);
    this.queue.sort((a, b) => CUES[b.cue].priority - CUES[a.cue].priority);
    if (!this.tour) this.queue.length = Math.min(this.queue.length, QUEUE_MAX);
    if (!this.busy) void this.next();
  }

  private async next(): Promise<void> {
    if (this.tour) {
      this.busy = false;
      return;
    }
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const line = item.line ?? pickLine(item.cue, this.lastLine.get(item.cue));
    if (!item.line) this.lastLine.set(item.cue, line);
    await this.say(line, item.cue);
    void this.next();
  }

  private async say(line: string, cue: Cue): Promise<void> {
    const epoch = this.epoch;
    const { anim, mood } = CUES[cue];
    this.showUp();
    document.documentElement.classList.add("nr-on");
    await this.read(line, anim, mood, epoch);
    if (epoch !== this.epoch) return;
    this.owl.rest();
    await wait(LINGER_MS);
    if (epoch === this.epoch) this.hide();
  }

  /** Slides the bubble in (from the hidden state's styles; not on an animation frame, which background tabs skip). */
  private showUp(): void {
    this.el.hidden = false;
    void this.el.offsetWidth;
    this.el.classList.add("in");
  }

  /** Reacts with `anim`, then reads the line aloud (or silently) with its captions. */
  private async read(line: string, anim: OwlAnim, mood: Mood, epoch: number): Promise<void> {
    const moods = wordMoods(line, mood);
    this.renderWords(stripTags(line).split(" "));
    // Fetch the voice while Sammy reacts.
    const voice = this.muted ? Promise.resolve(null) : this.fetchVoice(line);
    await this.owl.play(anim, { then: "idle" });
    const spoken = await voice;
    if (epoch !== this.epoch) return;

    this.owl.talk(moods[0] ?? mood);
    const played = spoken && !this.muted ? await this.playVoice(spoken, moods, mood, epoch) : false;
    if (!played && epoch === this.epoch) await this.readSilently(moods, mood, epoch);
  }

  // ---- Tour mode ------------------------------------------------------------------------

  get touring(): boolean {
    return this.tour !== null;
  }

  /** Hands Sammy to a tour: the line in progress stops, and cues wait until endTour(). */
  beginTour(handlers: TourHandlers): void {
    this.tour = handlers;
    this.epoch++;
    this.stopVoice();
    document.documentElement.classList.remove("nr-on");
    this.owl.setSize(innerWidth < 600 ? TOUR_OWL.narrow : TOUR_OWL.wide);
    this.el.classList.add("tour");
    this.bubble.setAttribute("role", "dialog");
    this.bubble.setAttribute("aria-label", `${NARRATOR_NAME}'s tour`);
    this.controls.hidden = false;
    this.showUp();
  }

  /** Shows and reads one tour step; resolves when the line has been read (or the tour moved on). */
  async tourLine(v: TourView, o: { flew?: boolean } = {}): Promise<void> {
    const epoch = ++this.epoch;
    this.stopVoice();
    this.pointing = v.pointing;
    this.backBtn.hidden = !v.back;
    this.count.hidden = !v.counter;
    this.count.textContent = v.counter;
    this.skipBtn.textContent = v.next === "offer" ? "Later" : "Skip tutorial";
    this.setNext(v.next);
    this.showUp();
    this.focusControls();
    // A long way to go: Sammy flies over instead of doing the step's own reaction.
    await this.read(v.line, o.flew ? "fly" : v.anim, v.pointing ? "point" : v.mood, epoch);
    if (epoch !== this.epoch) return;
    if (this.pointing) this.owl.holdPose(POINT_POSE);
    else this.owl.rest();
  }

  /** The main button: Next, Finish, Sure (the offer), or a disabled "Your turn" while the player acts. */
  setNext(kind: TourView["next"]): void {
    const waiting = kind === "wait";
    const focused = document.activeElement === this.nextBtn || document.activeElement === this.bubble;
    this.nextBtn.disabled = waiting;
    this.nextBtn.textContent = waiting ? "Your turn" : kind === "finish" ? "Finish" : kind === "offer" ? "Sure" : "Next";
    if (!waiting && focused) this.nextBtn.focus({ preventScroll: true });
  }

  private focusControls(): void {
    (this.nextBtn.disabled ? this.bubble : this.nextBtn).focus({ preventScroll: true });
  }

  /** Sammy's box (owl and bubble), for placing him. */
  box(): { w: number; h: number } {
    return { w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  /**
   * Stands Sammy's box at (x, y) on `side` of the target, facing it: the owl sits
   * between the bubble and the target, points toward it, and the bubble's tail
   * aims at the target's middle.
   */
  place(x: number, y: number, side: Side, target: Rect | null): void {
    // Where the owl and bubble will be once the move's transition ends.
    const now = this.el.getBoundingClientRect();
    const dx = x - now.left;
    const dy = y - now.top;
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.el.dataset.side = side;
    if (!target) {
      this.el.classList.remove("face-right");
      return;
    }
    const owl = this.owl.el.getBoundingClientRect();
    const b = this.bubble.getBoundingClientRect();
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    // The pointing frame raises the wing on the viewer's left; mirror it to point right.
    this.el.classList.toggle("face-right", cx > owl.left + dx + owl.width / 2);
    this.el.style.setProperty("--tail-x", `${Math.round(clamp(cx - (b.left + dx) - 9, 10, b.width - 30))}px`);
    this.el.style.setProperty("--tail-b", `${Math.round(clamp(b.bottom + dy - cy - 9, 10, b.height - 30))}px`);
  }

  /** Gives Sammy back to the cues: the bubble goes, and anything that queued up plays. */
  endTour(): void {
    if (!this.tour) return;
    this.tour = null;
    this.epoch++;
    this.stopVoice();
    this.controls.hidden = true;
    this.bubble.setAttribute("role", "status");
    this.bubble.removeAttribute("aria-label");
    this.hide(() => {
      this.el.classList.remove("tour", "face-right");
      this.el.style.removeProperty("left");
      this.el.style.removeProperty("top");
      delete this.el.dataset.side;
      this.owl.setSize(OWL_SIZE);
      if (!this.busy) void this.next();
    });
  }

  // ---- The voice -------------------------------------------------------------------------

  /** The line's voice: from the pack when it's there, otherwise voiced by the server (which caches it). */
  private async fetchVoice(line: string): Promise<Spoken | null> {
    const packed = (await loadPack())?.lines[line];
    if (packed) {
      try {
        const r = await fetch(PACK_BASE + packed.file, { signal: AbortSignal.timeout(VOICE_TIMEOUT_MS) });
        if (r.ok) return { audio: await r.arrayBuffer(), words: packed.words };
      } catch {
        // Fall back to the server below.
      }
    }
    try {
      // The wire id stays "narrator" (the deployed server's contract; see NARRATOR_NAME).
      const r = await apiFetch<{ audioBase64: string; words: Spoken["words"] }>("/voice/tts", {
        method: "POST",
        body: JSON.stringify({ text: line, voice: "narrator" }),
        signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
      });
      return { audio: decodeBase64(r.audioBase64), words: r.words };
    } catch {
      return null;
    }
  }

  /** Plays the line with its captions; false when the browser won't play sound (no click on the page yet) or the audio is bad. */
  private async playVoice(spoken: Spoken, moods: Mood[], base: Mood, epoch: number): Promise<boolean> {
    let buffer: AudioBuffer;
    let ctx: AudioContext;
    try {
      ctx = this.ctx ??= new AudioContext();
      if (ctx.state !== "running") await Promise.race([ctx.resume(), wait(RESUME_TIMEOUT_MS)]);
      if (ctx.state !== "running") return false;
      buffer = await ctx.decodeAudioData(spoken.audio);
    } catch {
      return false;
    }
    if (epoch !== this.epoch || this.muted) return false;

    this.renderWords(spoken.words.map((w) => w.word));
    const spans = [...this.text.querySelectorAll("span")];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const samples = new Float32Array(analyser.fftSize);
    const startAt = ctx.currentTime + 0.05;
    source.start(startAt);
    this.source = source;

    return new Promise<boolean>((resolve) => {
      let nextWord = 0;
      const timer = window.setInterval(() => {
        const t = ctx.currentTime - startAt;
        // Each word that starts lights up, sets the mood, and is a beat Sammy can move on.
        while (nextWord < spoken.words.length && t >= spoken.words[nextWord].start) {
          spans[nextWord]?.classList.add("said");
          this.owl.talk(moods[nextWord] ?? base);
          this.owl.beat();
          nextWord++;
        }
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        this.owl.setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
      }, TICK_MS);
      source.onended = () => {
        clearInterval(timer);
        this.owl.setLevel(0);
        if (this.source === source) this.source = null;
        source.disconnect();
        // A line stopped by muting still finishes its captions; one stopped by moving on doesn't.
        if (epoch === this.epoch) spans.forEach((s) => s.classList.add("said"));
        resolve(true);
      };
    });
  }

  private async readSilently(moods: Mood[], base: Mood, epoch: number): Promise<void> {
    const spans = [...this.text.querySelectorAll("span")];
    for (const [i, span] of spans.entries()) {
      if (epoch !== this.epoch) return;
      span.classList.add("said");
      this.owl.talk(moods[i] ?? base);
      this.owl.beat();
      await wait(SILENT_WORD_MS);
    }
  }

  private renderWords(words: string[]): void {
    this.text.innerHTML = words.map((w) => `<span>${escapeHtml(w)}</span>`).join(" ");
  }

  private stopVoice(): void {
    try {
      this.source?.stop();
    } catch {
      // Already stopped.
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // Storage can be off; the setting then lasts for this visit.
    }
    if (this.muted) this.stopVoice();
    this.syncMute();
  }

  private syncMute(): void {
    this.muteBtn.textContent = this.muted ? "🔇" : "🔊";
    this.muteBtn.setAttribute("aria-label", this.muted ? `Unmute ${NARRATOR_NAME}` : `Mute ${NARRATOR_NAME}`);
    this.muteBtn.setAttribute("aria-pressed", String(this.muted));
  }

  /** Stops the line in progress and anything queued. */
  private dismiss(): void {
    this.epoch++;
    this.queue = [];
    this.stopVoice();
    this.hide();
    this.busy = false;
  }

  private hide(after?: () => void): void {
    this.el.classList.remove("in");
    this.owl.stop();
    window.setTimeout(() => {
      if (this.el.classList.contains("in")) return after?.();
      this.el.hidden = true;
      document.documentElement.classList.remove("nr-on");
      after?.();
    }, 260);
  }
}
