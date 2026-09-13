// The onboarding interview. The owl, Larp City's narrator (an ElevenLabs
// voice agent), asks for the player's job, salary, rent, debt, and savings
// before the city opens, and the answers become the player's starting money
// life (sim/life/intake.ts). The agent hands the answers over with its
// submit_finances client tool; if a call ends without it, the server's
// post-call webhook has the same fields, fetched by conversation id. The
// player can also type the numbers, or skip to the sample household.
// The answers become the player's server profile (main.ts), so the interview
// runs once per player; ?intake=1 forces it again and ?intake=0 skips it (for tests).

import type { VoiceConversation } from "@elevenlabs/client";
import { apiFetch } from "../net/api";
import { coerceAnswers, completeAnswers, takeHomeFor, type IntakeAnswers } from "../sim/life/intake";
import type { ProfileSource } from "../sim/save/client";
import { Owl, preloadOwl } from "./owl";
import "./intake.css";

/** How long to wait for the post-call webhook's notes after a call ends without the tool. */
const NOTES_WAIT_MS = 20_000;
const NOTES_POLL_MS = 2_000;
/** Hang up this long after the answers arrive, in case the narrator keeps talking. */
const WRAP_UP_MS = 12_000;
/** The owl's standing height on the welcome and call screens, and above the form. */
const OWL_BIG = 150;
const OWL_SMALL = 96;

type Role = "agent" | "user";

export interface IntakeOptions {
  /** The starting city's daytime plate, blurred behind the card. */
  backdrop: string;
  /** The player's starting state abbreviation, for the live take-home preview. */
  state: string;
}

export interface IntakeResult {
  /** The player's answers, or null to start with the sample household. */
  answers: IntakeAnswers | null;
  source: ProfileSource;
}

/** Runs the interview (or the typed form) and resolves with what the player gave. */
export function runIntake(o: IntakeOptions): Promise<IntakeResult> {
  if (new URLSearchParams(location.search).get("intake") === "0") return Promise.resolve({ answers: null, source: "skipped" });
  preloadOwl(["wave", "idle", "talk", "think", "cheer", "type", "read", "tip-hat"]);
  return new Promise((resolve) => new Intake(o, resolve).welcome());
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NUMBER_FIELDS = ["salary", "rent", "debt", "savings"] as const;

class Intake {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly resolve: (r: IntakeResult) => void;
  private readonly state: string;
  private readonly owl = new Owl(OWL_BIG);
  private conversation: VoiceConversation | null = null;
  private conversationId: string | null = null;
  /** Answers from the submit_finances tool during the current call. */
  private answers: IntakeAnswers | null = null;
  /** "voice" once the Narrator's call handed over answers; the form alone is "typed". */
  private source: "voice" | "typed" = "typed";
  private lines: { role: Role; text: string }[] = [];
  /** Set once the narrator starts the goodbye after the answers arrive. */
  private goodbye = false;
  private leaving = false;
  private frame = 0;
  private wrapTimer = 0;
  /** Bumped for every call and screen change, so an old call's callbacks can't touch a newer screen. */
  private callSeq = 0;
  private endedSeq = -1;

  constructor(o: IntakeOptions, resolve: (r: IntakeResult) => void) {
    this.resolve = resolve;
    this.state = o.state;
    this.el = document.createElement("div");
    this.el.className = "in-overlay";
    this.el.style.setProperty("--backdrop", `url("${o.backdrop}")`);
    this.el.innerHTML = `
      <section class="in-card" role="dialog" aria-modal="true" aria-labelledby="in-title">
        <h1 class="in-ribbon" id="in-title">Welcome to Larp City!</h1>
        <div class="in-body"></div>
      </section>`;
    this.body = this.el.querySelector<HTMLDivElement>(".in-body")!;
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.el.addEventListener("input", () => this.onInput());
    this.el.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.onSubmit();
    });
    document.body.appendChild(this.el);
  }

  welcome(): void {
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">The Narrator</div>
      <p class="in-lead">This is the story of a new arrival in Larp City. Before they get the keys, the Narrator needs a few details:
        job, salary, rent, debt, and savings. Real numbers or a made-up life both work.</p>
      <div class="in-actions">
        <button type="button" class="btn in-big" data-act="talk">🎙️ Talk to the Narrator</button>
        <button type="button" class="btn ghost in-big" data-act="type">Type it instead</button>
      </div>
      <button type="button" class="in-link" data-act="skip">Skip and use a sample life</button>
      <p class="in-fine">The interview uses your microphone. Voice by ElevenLabs.</p>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("wave", { then: "idle" });
    this.focus("[data-act=talk]");
  }

  private show(html: string): void {
    this.body.innerHTML = html;
  }

  /** Puts the owl into the current screen's slot, at `size`. */
  private mountOwl(size: number): void {
    this.owl.setSize(size);
    this.body.querySelector(".in-owl-slot")?.appendChild(this.owl.el);
  }

  private focus(selector: string): void {
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>(selector)?.focus());
  }

  private onClick(ev: MouseEvent): void {
    if (this.leaving) return;
    const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "talk") void this.talk();
    else if (act === "type") this.typeInstead();
    else if (act === "hangup") void this.hangUp(this.callSeq);
    else if (act === "skip") void this.finish(null);
  }

  // ---- The call ----

  private async talk(): Promise<void> {
    const seq = ++this.callSeq;
    this.answers = null;
    this.conversationId = null;
    this.lines = [];
    this.goodbye = false;
    this.show(`
      <div class="in-owl-slot"></div>
      <p class="in-status" aria-live="polite">Calling the Narrator…</p>
      <ol class="in-transcript" aria-label="Conversation"></ol>
      <div class="in-actions">
        <button type="button" class="btn ghost in-big" data-act="hangup">Hang up</button>
      </div>
      <button type="button" class="in-link" data-act="type">Type it instead</button>`);
    this.mountOwl(OWL_BIG);
    this.owl.rest();

    let signedUrl: string;
    try {
      ({ signedUrl } = await apiFetch<{ signedUrl: string }>("/voice/signed-url"));
    } catch {
      if (seq === this.callSeq) this.confirm({}, "The Narrator can't take calls right now. Fill in your numbers by hand.");
      return;
    }
    if (seq !== this.callSeq) return;

    try {
      // The SDK loads only when a call starts, so a returning player never downloads it.
      const { VoiceConversation: Voice } = await import("@elevenlabs/client");
      const conversation = await Voice.startSession({
        signedUrl,
        clientTools: { submit_finances: (params: unknown) => this.onSubmitFinances(seq, params) },
        onConnect: ({ conversationId }) => {
          if (seq === this.callSeq) this.conversationId = conversationId;
        },
        onModeChange: ({ mode }) => this.onMode(seq, mode),
        onMessage: ({ message, role }) => this.onLine(seq, role, message),
        onDisconnect: () => void this.onCallEnded(seq),
        onError: (message) => console.warn("[intake] voice error:", message),
      });
      if (seq !== this.callSeq) {
        void conversation.endSession();
        return;
      }
      this.conversation = conversation;
      this.status("The Narrator is picking up…");
      this.meter(conversation);
    } catch (err) {
      if (seq !== this.callSeq) return;
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      this.confirm(
        {},
        denied
          ? "No microphone? No problem. Fill in your numbers by hand."
          : "The call couldn't connect. Fill in your numbers by hand, or try the Narrator again.",
      );
    }
  }

  private onSubmitFinances(seq: number, params: unknown): string {
    if (seq !== this.callSeq) return "The player already moved on; say goodbye.";
    const answers = completeAnswers(coerceAnswers(params));
    if (!answers) return "Some of the five answers were missing or unclear. Ask for the missing ones, then call submit_finances again.";
    this.answers = answers;
    this.source = "voice";
    this.status("Got it! The Narrator is writing it all down…");
    void this.owl.play("cheer", { then: "idle" });
    this.wrapTimer = window.setTimeout(() => void this.hangUp(seq), WRAP_UP_MS);
    return "Saved. Tell the player their city is ready in one short sentence, then stop.";
  }

  private onMode(seq: number, mode: "speaking" | "listening"): void {
    if (seq !== this.callSeq) return;
    if (this.answers) {
      // Hang up once the narrator has said goodbye (a speaking turn that ends).
      if (mode === "speaking") {
        this.goodbye = true;
        this.owl.talk("warm");
      } else if (this.goodbye) {
        this.owl.rest();
        window.setTimeout(() => void this.hangUp(seq), 400);
      }
      return;
    }
    // Listening rests on the same sheet as talking, so the owl's vest doesn't change between turns.
    if (mode === "speaking") this.owl.talk("plain");
    else this.owl.rest();
    this.status(mode === "speaking" ? "The Narrator is talking…" : "Your turn. The Narrator is listening.");
  }

  private onLine(seq: number, role: Role, text: string): void {
    if (seq !== this.callSeq || !text.trim()) return;
    this.lines.push({ role, text: text.trim() });
    const list = this.body.querySelector<HTMLOListElement>(".in-transcript");
    if (!list) return;
    list.innerHTML = this.lines
      .slice(-8)
      .map((l) => `<li class="${l.role}"><b>${l.role === "agent" ? "Narrator" : "You"}</b>${escapeHtml(l.text)}</li>`)
      .join("");
    list.scrollTop = list.scrollHeight;
  }

  private status(text: string): void {
    const el = this.body.querySelector(".in-status");
    if (el) el.textContent = text;
  }

  /** Bobs the owl with the narrator's voice, and gives it a beat to change pose on as each syllable starts. */
  private meter(conversation: VoiceConversation): void {
    let last = 0;
    const tick = () => {
      if (this.conversation !== conversation) return;
      const level = Math.min(1, conversation.getOutputVolume() * 1.6);
      this.owl.setLevel(level);
      if (level > 0.22 && last < 0.12) this.owl.beat();
      last = level;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async endCall(): Promise<void> {
    clearTimeout(this.wrapTimer);
    cancelAnimationFrame(this.frame);
    this.owl.setLevel(0);
    const conversation = this.conversation;
    this.conversation = null;
    if (conversation) await conversation.endSession().catch(() => undefined);
  }

  private async hangUp(seq: number): Promise<void> {
    if (seq !== this.callSeq) return;
    await this.endCall();
    await this.onCallEnded(seq);
  }

  private async onCallEnded(seq: number): Promise<void> {
    if (seq !== this.callSeq || this.endedSeq === seq) return;
    this.endedSeq = seq;
    await this.endCall();
    if (this.answers) return this.confirm(this.answers, "Here's what the Narrator wrote down. Fix anything that's off, then move in.");

    const id = this.conversationId;
    if (!id) return this.confirm({}, "The call ended before it started. Fill in your numbers by hand, or try the Narrator again.");
    this.status("Checking the Narrator's notes…");
    void this.owl.play("type");
    this.body.querySelector("[data-act=hangup]")?.remove();
    const notes = await this.fetchNotes(seq, id);
    if (seq !== this.callSeq) return;
    const complete = completeAnswers(notes) !== null;
    this.confirm(
      notes,
      complete
        ? "The call ended early, but the Narrator's notes came through. Check them over."
        : Object.keys(notes).length
          ? "The Narrator caught some of it. Fill in the rest."
          : "The call ended before the Narrator wrote anything down. Fill in your numbers by hand, or talk again.",
    );
  }

  /** The post-call webhook's answers for this call, polled until they land or we give up. */
  private async fetchNotes(seq: number, conversationId: string): Promise<Partial<IntakeAnswers>> {
    const deadline = Date.now() + NOTES_WAIT_MS;
    while (Date.now() < deadline && seq === this.callSeq) {
      try {
        const r = await apiFetch<{ ready: boolean; answers?: unknown }>("/voice/interview/claim", {
          method: "POST",
          body: JSON.stringify({ conversationId }),
        });
        if (r.ready) {
          const notes = coerceAnswers(r.answers);
          if (Object.keys(notes).length) this.source = "voice";
          return notes;
        }
      } catch {
        return {};
      }
      await new Promise((done) => setTimeout(done, NOTES_POLL_MS));
    }
    return {};
  }

  private typeInstead(): void {
    const answers = this.answers;
    this.callSeq++;
    void this.endCall();
    this.confirm(
      answers ?? {},
      answers ? "Here's what the Narrator wrote down. Fix anything that's off, then move in." : "Fill in your numbers. Use 0 for none.",
    );
  }

  // ---- Confirm and finish ----

  private confirm(prefill: Partial<IntakeAnswers>, note: string): void {
    this.callSeq++;
    const value = (k: keyof IntakeAnswers) => (prefill[k] === undefined ? "" : escapeHtml(String(prefill[k])));
    const field = (key: (typeof NUMBER_FIELDS)[number], label: string, unit: string) => `
      <label class="in-field">
        <span>${label}</span>
        <span class="in-input"><i>$</i><input name="${key}" type="number" inputmode="numeric" min="0" step="1" value="${value(key)}">${unit ? `<em>${unit}</em>` : ""}</span>
      </label>`;
    this.show(`
      <div class="in-owl-slot in-owl-small"></div>
      <p class="in-note">${escapeHtml(note)}</p>
      <form class="in-form" novalidate>
        <label class="in-field in-wide">
          <span>Job</span>
          <span class="in-input"><input name="job" type="text" maxlength="60" autocomplete="organization-title" placeholder="Nurse, barista, astronaut…" value="${value("job")}"></span>
        </label>
        ${field("salary", "Salary before tax", "a year")}
        ${field("rent", "Rent or housing", "a month")}
        ${field("debt", "Total debt", "")}
        ${field("savings", "Savings", "")}
        <p class="in-derived in-wide" aria-live="polite"></p>
        <p class="in-error in-wide" role="alert"></p>
        <div class="in-actions in-wide">
          <button type="submit" class="btn in-big">Move in 🏠</button>
          <button type="button" class="btn ghost in-big" data-act="talk">🎙️ Talk to the Narrator</button>
        </div>
      </form>
      <button type="button" class="in-link" data-act="skip">Skip and use a sample life</button>`);
    this.mountOwl(OWL_SMALL);
    void this.owl.play("read");
    this.onInput();
    const missing = NUMBER_FIELDS.find((k) => prefill[k] === undefined);
    this.focus(missing ? `input[name=${missing}]` : ".in-form [type=submit]");
  }

  private readForm(): Partial<IntakeAnswers> {
    const form = this.body.querySelector<HTMLFormElement>(".in-form");
    if (!form) return {};
    const data = new FormData(form);
    return coerceAnswers(Object.fromEntries([...data.entries()].map(([k, v]) => [k, String(v)])));
  }

  private onInput(): void {
    const derived = this.body.querySelector(".in-derived");
    if (!derived) return;
    const a = this.readForm();
    this.body.querySelector(".in-error")!.textContent = "";
    if (a.salary === undefined) {
      derived.textContent = "";
      return;
    }
    const takeHome = takeHomeFor(a.salary, this.state);
    derived.textContent =
      a.rent === undefined
        ? `That's about ${money(takeHome)} a month after taxes.`
        : `That's about ${money(takeHome)} a month after taxes, and ${money(takeHome - a.rent)} after rent.`;
  }

  private onSubmit(): void {
    if (this.leaving) return;
    const answers = completeAnswers(this.readForm());
    if (!answers) {
      this.body.querySelector(".in-error")!.textContent = "Fill in salary, rent, debt, and savings. Use 0 for none.";
      return;
    }
    void this.finish(answers);
  }

  private async finish(answers: IntakeAnswers | null): Promise<void> {
    this.leaving = true;
    this.callSeq++;
    void this.endCall();
    if (answers) {
      // A tip of the hat on the way in.
      this.el.classList.add("in-leaving");
      await this.owl.play("tip-hat", { then: "idle" });
    }
    this.owl.stop();
    this.el.remove();
    this.resolve(answers ? { answers, source: this.source } : { answers: null, source: "skipped" });
  }
}
