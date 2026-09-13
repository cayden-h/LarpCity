# Title Screen and Learn Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new life opens on a title screen (Larp City, Sammy, Learn over blurred SF); Learn plays Sammy's 8-bubble walkthrough and hands off to the intake.

**Architecture:** The script is data in `game/src/narration/learn.ts`. `game/src/ui/title.ts` draws the overlay and borrows the real `Narrator` in tour mode (`beginTour`, `tourLine`, `place`, `endTour`) for the bubbles, so voice, captions, mute, and Back/Next/Skip come for free. `main.ts` builds the narrator before the intake and awaits `runTitle` before `runIntake`.

**Tech Stack:** TypeScript, Vite, DOM + CSS in the pixel theme, `node --test`.

Spec: `docs/superpowers/specs/2026-09-13-title-and-learn-design.md`.

---

### Task 1: The script and its tests

**Files:** Create `game/src/narration/learn.ts`, `game/tests/learn.test.ts`. Modify `game/src/narration/lines.ts` (`allLines`), `game/tests/narration-pack.test.ts`.

- [ ] Write `tests/learn.test.ts`: 8 steps; the first introduces Sammy and the last mentions goals; every anim is a strip in `public/owl/owl.json`; only `DELIVERY_TAGS` in brackets; no em dash; every line is in `allLines()`.
- [ ] Run `node --test tests/learn.test.ts`; expect failure (module missing).
- [ ] Write `learn.ts`: `LearnStep { line, anim, mood }`, `LEARN` (the spec's 8 lines), `learnLines()`, and `AWAITING_VOICE` (the lines not voiced yet because ElevenLabs credits are out until 2026-10-12).
- [ ] Add `...learnLines()` to `allLines()`.
- [ ] In `narration-pack.test.ts`, skip `AWAITING_VOICE` lines in the clip and caption checks, and add a test that fails once a waiting line is in the pack (so the exemption gets deleted).
- [ ] Run `npm test`; expect all pass. Commit.

### Task 2: The title screen and walkthrough

**Files:** Create `game/src/ui/title.ts`, `game/src/ui/title.css`. Modify `game/src/main.ts`.

- [ ] `runTitle({ backdrop, narrator })`: resolves at once under `?intake=0`; otherwise draws `.tt-overlay` (z-index 27) with the logo, a subtitle, a 170px `Owl` (`wave` then `idle`), a focused Learn `.btn`, and a "Skip to setup" link.
- [ ] Learn: add `.learning` (the home fades), `narrator.beginTour({ next, back, skip })`, then `show(i)` calls `narrator.tourLine({ line, anim, mood, counter: "i / 8", back: i > 0, next: last ? "finish" : "next", pointing: false })` and centers Sammy with `narrator.place(x, y, "right", null)` from `narrator.box()`; re-center on resize.
- [ ] Keys while learning: Esc skips, ArrowLeft goes back, ArrowRight goes on (Enter works through the focused Next button).
- [ ] Finish or skip: `narrator.endTour()`, fade the overlay out and remove it, resolve.
- [ ] `title.css`: the SF plate on `::before`, blurred 10px with a negative inset so edges don't glow; a light gradient tint on `::after`; the pixel logo in yellow with a stepped dark outline; reduced motion turns transitions off.
- [ ] `main.ts`: move `const narrator = new Narrator();` above the life block; before `runIntake`, `await runTitle({ backdrop: <SF day plate>, narrator })`.
- [ ] `npm run build`; commit.

### Task 3: Verify in Chrome, docs, PR

- [ ] Run the game (`npm run dev`) with `?intake=1` and check at 1440x900 and 390px: the title, every Learn step, Back, Skip, "Skip to setup", keyboard only, mute, reduced motion, and the handoff to the welcome card. Fix anything off.
- [ ] Save screenshots to `docs/screenshots/title-learn/`.
- [ ] `game/README.md`: the title screen and Learn in the feature list and the file list.
- [ ] `npm run build && npm test`; commit; push `title-learn`; open a PR against `main`, noting the pack rebuild after 2026-10-12.
