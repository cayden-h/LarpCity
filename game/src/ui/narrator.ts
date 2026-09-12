// The owl narrates the player's life: it stands at the bottom of the city with
// a speech bubble, plays a reaction, then reads the line in the narrator's
// voice (the server's /api/voice/tts on the expressive model) while each word
// lights up as it's spoken. Lines and their timing rules live in
// narration/lines.ts. Muting (remembered per browser) keeps the captions and
// drops the voice; without the server, or before the page may play sound,
// the owl reads the line on screen.
//
// The voice plays through Web Audio rather than an <audio> element: Chrome
// holds back loading media elements in background tabs, which would leave
// the owl mid-sentence until the player came back, and the audio clock and
// an analyser give exact word timing and a real loudness for the owl's bob.

import { apiFetch } from "../net/api";
import { CueGate, CUES, pickLine, stripTags, type Cue } from "../narration/lines";
import { Owl, preloadOwl, type OwlAnim } from "./owl";
import "./narrator.css";

const MUTE_KEY = "larp.narrator.muted";
/** How long the bubble stays up after the last word. */
const LINGER_MS = 2_600;
/** Reading pace for a line shown without the voice. */
const SILENT_WORD_MS = 330;
const VOICE_TIMEOUT_MS = 9_000;
/** Without a click on the page yet, the browser keeps audio suspended; don't wait long to find out. */
const RESUME_TIMEOUT_MS = 400;
/** Caption and bob updates; a timer rather than animation frames, which stop in background tabs. */
const TICK_MS = 50;
const QUEUE_MAX = 2;

interface Spoken {
  audioBase64: string;
  words: { word: string; start: number }[];
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

export class Narrator {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly owl = new Owl(118);
  private readonly gate = new CueGate();
  private readonly lastLine = new Map<Cue, string>();
  private queue: Cue[] = [];
  private busy = false;
  private muted = readMuted();
  private ctx: AudioContext | null = null;
  /** The line playing now, so mute and dismiss can stop it. */
  private source: AudioBufferSourceNode | null = null;
  /** Bumped when the player dismisses the bubble, so the line in progress stops. */
  private epoch = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "nr";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="nr-owl"></div>
      <div class="nr-bubble" role="status" aria-live="polite">
        <div class="nr-head">
          <span class="nr-name">The Narrator</span>
          <button type="button" class="nr-btn" data-act="mute"></button>
          <button type="button" class="nr-btn" data-act="close" aria-label="Dismiss the narrator">✕</button>
        </div>
        <p class="nr-text"></p>
      </div>`;
    this.el.querySelector(".nr-owl")!.appendChild(this.owl.el);
    this.text = this.el.querySelector<HTMLParagraphElement>(".nr-text")!;
    this.muteBtn = this.el.querySelector<HTMLButtonElement>("[data-act=mute]")!;
    this.el.addEventListener("click", (ev) => {
      const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "mute") this.toggleMute();
      else if (act === "close") this.dismiss();
    });
    document.body.appendChild(this.el);
    this.syncMute();
    // Every reaction, so the owl never pops in blank while a strip downloads.
    preloadOwl(["idle", "talk", ...new Set(Object.values(CUES).map((c) => c.anim))]);
  }

  /** Speaks a line for `cue` if the timing rules allow it now. */
  cue(cue: Cue): void {
    if (!this.gate.allow(cue, performance.now())) return;
    this.queue.push(cue);
    this.queue.sort((a, b) => CUES[b].priority - CUES[a].priority);
    this.queue.length = Math.min(this.queue.length, QUEUE_MAX);
    if (!this.busy) void this.next();
  }

  private async next(): Promise<void> {
    const cue = this.queue.shift();
    if (!cue) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const line = pickLine(cue, this.lastLine.get(cue));
    this.lastLine.set(cue, line);
    await this.say(line, CUES[cue].anim);
    void this.next();
  }

  private async say(line: string, reaction: OwlAnim): Promise<void> {
    const epoch = this.epoch;
    this.renderWords(stripTags(line).split(" "));
    this.el.hidden = false;
    // Apply the hidden-state styles before sliding in (not on an animation frame, which background tabs skip).
    void this.el.offsetWidth;
    this.el.classList.add("in");

    // Fetch the voice while the owl reacts.
    const voice = this.muted ? Promise.resolve(null) : this.fetchVoice(line);
    await this.owl.play(reaction, { then: "idle" });
    const spoken = await voice;
    if (epoch !== this.epoch) return;

    void this.owl.play("talk");
    const played = spoken && !this.muted ? await this.playVoice(spoken, epoch) : false;
    if (!played && epoch === this.epoch) await this.readSilently(epoch);
    if (epoch !== this.epoch) return;

    void this.owl.play("idle");
    await wait(LINGER_MS);
    if (epoch === this.epoch) this.hide();
  }

  private async fetchVoice(line: string): Promise<Spoken | null> {
    try {
      return await apiFetch<Spoken>("/voice/tts", {
        method: "POST",
        body: JSON.stringify({ text: line, voice: "narrator" }),
        signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  }

  /** Plays the line with its captions; false when the browser won't play sound (no click on the page yet) or the audio is bad. */
  private async playVoice(spoken: Spoken, epoch: number): Promise<boolean> {
    let buffer: AudioBuffer;
    let ctx: AudioContext;
    try {
      ctx = this.ctx ??= new AudioContext();
      if (ctx.state !== "running") await Promise.race([ctx.resume(), wait(RESUME_TIMEOUT_MS)]);
      if (ctx.state !== "running") return false;
      buffer = await ctx.decodeAudioData(decodeBase64(spoken.audioBase64));
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
      const timer = window.setInterval(() => {
        const t = ctx.currentTime - startAt;
        spoken.words.forEach((w, i) => spans[i]?.classList.toggle("said", t >= w.start));
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
        spans.forEach((s) => s.classList.add("said"));
        resolve(true);
      };
    });
  }

  private async readSilently(epoch: number): Promise<void> {
    for (const span of this.text.querySelectorAll("span")) {
      if (epoch !== this.epoch) return;
      span.classList.add("said");
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
    this.muteBtn.setAttribute("aria-label", this.muted ? "Unmute the narrator" : "Mute the narrator");
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

  private hide(): void {
    this.el.classList.remove("in");
    this.owl.stop();
    window.setTimeout(() => {
      if (!this.el.classList.contains("in")) this.el.hidden = true;
    }, 260);
  }
}
