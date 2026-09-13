// The owl narrates the player's life: it stands at the bottom of the city with
// a speech bubble, reacts, then reads the line in the narrator's voice (the
// server's /api/voice/tts on the expressive model) while each word lights up
// as it's spoken. Lines and their timing rules live in narration/lines.ts.
// While it talks, the owl holds poses that fit the mood of each word and
// changes them on the words' beats (narration/poses.ts). Muting (remembered
// per browser) keeps the captions and drops the voice; without the server,
// or before the page may play sound, the owl reads the line on screen.
//
// The voice plays through Web Audio rather than an <audio> element: Chrome
// holds back loading media elements in background tabs, which would leave
// the owl mid-sentence until the player came back, and the audio clock and
// an analyser give exact word timing and a real loudness for the owl's bob.

import { apiFetch } from "../net/api";
import { CueGate, CUES, pickLine, stripTags, type Cue } from "../narration/lines";
import { wordMoods, type Mood } from "../narration/poses";
import { Owl, preloadOwl } from "./owl";
import "./narrator.css";

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
  private queue: { cue: Cue; line?: string }[] = [];
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
    // While the owl is up, the modal windows (map, Money, fast-forward) keep a band at the
    // bottom clear for it (narrator.css); the band follows the owl's real height.
    new ResizeObserver(() => {
      if (this.el.offsetHeight) document.documentElement.style.setProperty("--nr-h", `${this.el.offsetHeight}px`);
    }).observe(this.el);
    this.syncMute();
    // Every reaction, so the owl never pops in blank while a strip downloads.
    preloadOwl(["idle", "talk", ...new Set(Object.values(CUES).map((c) => c.anim))]);
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
    this.queue.push(item);
    this.queue.sort((a, b) => CUES[b.cue].priority - CUES[a.cue].priority);
    this.queue.length = Math.min(this.queue.length, QUEUE_MAX);
    if (!this.busy) void this.next();
  }

  private async next(): Promise<void> {
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
    const moods = wordMoods(line, mood);
    this.renderWords(stripTags(line).split(" "));
    this.el.hidden = false;
    document.documentElement.classList.add("nr-on");
    // Apply the hidden-state styles before sliding in (not on an animation frame, which background tabs skip).
    void this.el.offsetWidth;
    this.el.classList.add("in");

    // Fetch the voice while the owl reacts.
    const voice = this.muted ? Promise.resolve(null) : this.fetchVoice(line);
    await this.owl.play(anim, { then: "idle" });
    const spoken = await voice;
    if (epoch !== this.epoch) return;

    this.owl.talk(moods[0] ?? mood);
    const played = spoken && !this.muted ? await this.playVoice(spoken, moods, mood, epoch) : false;
    if (!played && epoch === this.epoch) await this.readSilently(moods, mood, epoch);
    if (epoch !== this.epoch) return;

    this.owl.rest();
    await wait(LINGER_MS);
    if (epoch === this.epoch) this.hide();
  }

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
        // Each word that starts lights up, sets the mood, and is a beat the owl can move on.
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
        spans.forEach((s) => s.classList.add("said"));
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
      if (this.el.classList.contains("in")) return;
      this.el.hidden = true;
      document.documentElement.classList.remove("nr-on");
    }, 260);
  }
}
