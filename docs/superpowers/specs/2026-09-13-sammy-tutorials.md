Goal: rename the narrator to "Sammy" everywhere, and build two guided tutorials that Sammy leads, one for stocks and one for taxes. In each one Sammy points at the real UI, highlights it, and explains it using the player's own numbers. Finish with the work verified end to end in the browser and opened as a PR.

## Context (read before coding)

- Repo: ~/Documents/GitHub/HackRice/Larp City. Read CLAUDE.md, README.md, game/README.md, docs/meetings/2026-09-13-revamp.md (it wins over older docs; it says "The narrator is named Sammy"), and docs/superpowers/specs/2026-09-12-tax-filing-design.md.
- Other sessions push to this repo at the same time. Run `git fetch` first. Work in your own worktree, never in the shared checkout.
- The base branch matters. The year-1 tax tutorial (a quiz on the bottom line, answers from sim/tax/tutorial.ts, and taxTutorialHtml plus the "tax-answer" click handler in src/debt-demo/main.ts) exists only on branch `revamp-p3` (PR #24, worktree ../larp-p3). Branch from `origin/revamp-p3` (for example `sammy-tutorials` in ../larp-sammy) and open the PR against `revamp-p3`. If PR #24 has merged by the time you start, branch from origin/main instead.
- P1 (a teammate: Sammy's onboarding screens) and P2 (a teammate: goals and happiness) are not on the remote yet. Keep the name in one exported constant so their merges pick it up, and don't restructure intake.ts beyond the strings.

Current narrator system (read all of it):
- game/src/ui/narrator.ts: the `Narrator` class. It has a bubble with `.nr-name` "The Narrator", mute and dismiss buttons, `cue()` (gated by CueGate) and `speak(line, as)`, QUEUE_MAX 2, and it auto-hides LINGER_MS after the last word. Voice comes from the pre-voiced pack (public/narration/index.json, keyed by the exact line text) or the server's /api/voice/tts.
- game/src/ui/owl.ts + narration/poses.ts: the sprite. The talk strip has `point` frames [4, 11, 14], and the motions are wave, cheer, think, proud, tip-hat, magic, hop, and so on.
- game/src/narration/lines.ts: the cues and their lines. Many lines say "the Narrator" in the third person. `allLines()` feeds game/scripts/build-narration.ts, and tests/narration-pack.test.ts fails until the pack matches the lines.
- game/src/ui/narrator.css: Sammy sits bottom center at z-index 25, above the Money window (20) and below the intake (30).
- game/src/main.ts: raises cues from `cueForEvents`. The phone is game/src/ui/phone.ts. The Stocks view is `renderStocks`. The Taxes app calls `openDesk(undefined, "taxes")`. The Money desk is an iframe (/debt.html#tab=... or #stock=ID) that reads `window.parent.larpMoney`.
- The Money desk is game/src/debt-demo/main.ts. It includes `investingPage`, `fundPage` (the buy/sell card, amounts, the auto-invest toggle, key stats, and About), `twinsChart` (you, "if you had held", and autopilot), `concentrationCard`, the "Pay debt or invest?" card (MARKET_RETURN 0.1), `askBearMarket`, `recoveryCard`, and `taxesPage`.
- Tax engine: game/src/sim/tax/ (federal.ts, state.ts, withholding.ts, filing.ts, penalties.ts). PlayerLife emits `tax_ready`, `tax_filed`, and `tax_penalty`, and has `pendingTaxReturn()`, `fileTaxes()`, and `taxTutorial` (on revamp-p3). Right now no narrator cue fires for tax events.

## Part 1: rename the narrator to Sammy, everywhere

- Add one exported `NARRATOR_NAME = "Sammy"` (for example in narration/lines.ts) and use it for every displayed name.
- Rename every human-readable mention: the bubble header, the aria-labels ("Mute Sammy", "Dismiss Sammy"), every intake.ts string ("Talk to Sammy", "Sammy is listening", the transcript label "Sammy", and so on), the two debt-demo/main.ts strings ("starts you over with Sammy", "Move in with Sammy first"), and the page titles or meta if any.
- Rewrite every line in lines.ts that says "the Narrator" so it reads naturally with a name. For example "Sammy checked.", "Sammy is telling everyone.", and "Sammy would like it on record". Keep the dry English voice and the delivery tags. Update welcomeBackLine if needed.
- Update code comments that call the character "the owl" or "the narrator" to say Sammy where they mean the character. "The owl" stays fine for the sprite and art pipeline (owl.ts, public/owl, art/owl).
- Update the docs: README.md, game/README.md, server/README.md, SETUP.md (including the ElevenLabs voice agent's prompt and first message, if documented there), CLAUDE.md, and research/SUMMARY.md. Leave historical meeting and notion snapshots alone.
- Keep the wire and storage identifiers as they are, and say why in one comment: `voice: "narrator"` in the API, `ELEVENLABS_VOICE_NARRATOR`, and the `larp.narrator.*` localStorage and sessionStorage keys. Renaming those would break saved mute preferences and the deployed server contract.
- The live ElevenLabs conversational agent (the voice intake) is configured in the ElevenLabs dashboard. If its prompt or greeting says "Narrator", you can't change it from code. List it in the PR description as a manual step for Cayden.
- Re-voice the pack. Run `node scripts/build-narration.ts` from game/, against the Vultr server by default. The server caches voiced lines, so only changed and new lines cost credits. Make tests/narration-pack.test.ts pass. If the server or credits are unavailable, stop and report it rather than committing a stale pack.

## Part 2: a reusable guided-tour system led by Sammy

Build it once and use it for both tutorials.

- Keep the logic pure and testable, for example game/src/narration/tour.ts. Put the DOM layer separately, in game/src/ui/tour.ts and ui/tour.css.
- A tour is a list of steps. Each step has:
  - Sammy's line (the text, a motion or anim, and a mood)
  - an optional target: a CSS selector in the city document, or in the Money desk iframe's document
  - an optional setup action: open the phone, open an app, switch the desk tab, open a fund page, or scroll the target into view
  - an advance rule: a "Next" button, or waiting for a real player action (a click on the target, a trade completing, a checkbox toggled, a tax answer chosen) with a timeout fallback to Next
  - optional branch text that depends on the player's state (for example, whether they have debt above 10% APR)
- Spotlight:
  - Dim everything except the target with a cutout overlay.
  - Draw a pixel-art highlight frame around the target, stepped corners in the pixel-theme.css palette, with a gentle pulse. Under prefers-reduced-motion, show no pulse.
  - The frame follows the target on resize, scroll, and re-render. The desk re-renders its HTML often, so re-query the selector every frame or on a MutationObserver, not once.
  - For iframe targets, add the iframe's bounding rect to the element's rect. The iframe is same-origin, so use its contentDocument.
  - Clicks pass through to the target when the step waits for a player action. Everything else stays blocked.
- Sammy pointing:
  - During a tour, Sammy moves near the target (animate with the existing "fly" or "step" motion, and clamp to the viewport).
  - Hold the talk strip's `point` poses aimed toward the target. Mirror the sprite horizontally when the target is on the other side.
  - Aim the bubble's pixel tail at the target, not only at Sammy.
  - Sammy must never cover the target or the button the player has to press. Choose the side with the most room.
- Changes to the Narrator for tour mode:
  - Tour lines bypass CueGate and QUEUE_MAX.
  - The bubble does not auto-hide.
  - It shows Back, Next or "Your turn", a step counter ("3 / 11"), and "Skip tutorial".
  - Event cues that fire mid-tour wait in the queue until the tour ends, and are not dropped.
  - Mute and dismiss still work. Dismiss during a tour asks nothing and simply skips to the end.
  - Add every tour line to `allLines()` so each one is pre-voiced. Lines that include the player's numbers are voiced on the fly through `speak()`, and the silent caption fallback keeps working.
- Time: the city clock pauses while a tour is open and resumes at its previous speed afterward. Fast-forward and the Calendar's skip are disabled during a tour.
- Persistence:
  - Record which tours are completed or skipped in the save (the GameSave or DeskState shape and its server-side validation), so a tour never replays on reload.
  - Reloading mid-tour resumes at the current step or cleanly restarts that tour. Choose one and document it.
  - Add a way to replay a tour: a small "?" or "Tour" button in the Stocks view header and on the desk's Taxes tab, plus `larp.tour("stocks")` from the console.
- Accessibility:
  - Next, Back, and Skip are real buttons and work from the keyboard (Enter and Esc).
  - Focus moves into the bubble.
  - The highlighted element gets `aria-describedby` pointing at the bubble text.
  - The overlay has an accessible name.
  - The text contrast passes.

## Part 3: the stocks tutorial

- Trigger: the first time the player opens the Stocks app, or the first bear-market decision if they never opened it. Offer it first ("Want the two-minute tour?" with Sure and Later) instead of forcing it.
- Use the player's real numbers everywhere: buying power, holdings, the starter portfolio, and each fund's real expenseRatio and beta from INSTRUMENTS. Never invent a figure. Check every claim against the engine.
- Suggested steps (keep the order; the wording is yours in Sammy's voice):
  1. The Stocks widget and view in the phone: funds versus single stocks versus HackRice sponsor stocks ("prices are simulated"), and the real interest rates shown as real.
  2. Open the Money desk's Investing tab. The three-line chart: you, "if you had held", and autopilot. What each line means.
  3. Buying power: money in checking that you can invest after bills.
  4. The starter portfolio holdings (value, shares, and the gain since you bought).
  5. Open a broad index fund's page. The price chart and the 1W/1M/1Y/ALL ranges. A fund versus a single stock. The yearly fee in dollars per $1,000. "Swings vs. market" (beta) on a stock.
  6. Hands-on: the player buys a small amount of the fund. Wait for the real trade event, then explain fractional shares.
  7. The auto-invest toggle: buying every payday is dollar-cost averaging.
  8. The concentration card, or diversification explained if the card isn't showing.
  9. "Pay debt or invest?": card APR against the market's long-run ~10%, and always take the 401(k) match. Use the player's highest-APR debt.
  10. Crashes: what the bear-market decision will look like, why selling in a panic usually loses (point at the recovery card or the twins chart), and that time stays paused until they decide.
  11. The wrap-up: a warm cheer, plus how to replay the tour.

## Part 4: the taxes tutorial

It wraps and upgrades P3's year-1 quiz. Don't duplicate it.

- Trigger: the first `tax_ready` event in live play. It does not fire during fast-forward, which auto-files.
  - Add a `tax_ready` narrator cue: the Taxes app shows a "File" badge, and Sammy flags the deadline once without pausing time, as the tax spec says.
  - The tour itself starts when the player opens the Taxes app, or when they accept Sammy's offer.
- Walk the real return in `taxesPage()`, highlighting each stat in order:
  1. Wages, from the year's paychecks, like a W-2.
  2. The standard deduction and taxable income.
  3. Federal tax and how brackets work: marginal versus effective rate.
     - Show a small pixel bracket bar computed from the player's taxable income with the real bracket table in federal.ts, so the player sees only the top slice taxed at the top rate.
  4. The Earned Income Tax Credit: whether they got it, and why.
  5. Federal withheld: every paycheck already paid some. Point at a paycheck line on the Cash tab statement if one exists.
  6. State tax. If they live in one of the 9 no-income-tax states, say so as a real strategic point.
  7. The bottom line question: P3's `tutorialOptions`.
     - Keep P3's rule: the refund or owed lines stay hidden until the player answers.
     - When they answer, Sammy reacts. A right answer gets a cheer, and every later return files itself.
     - A wrong answer gets a kind explanation of the exact mistake they picked. Reading the tax itself as what's owed forgets withholding; the other option forgets the tax. Show the correct math from their own numbers.
  8. What happens if you don't file by April 15: failure-to-file and failure-to-pay penalties and interest, from penalties.ts, with its real rates, and how an unpaid balance eventually becomes a debt that hurts the credit score.
- If the player is wrong, next year's return re-runs the quiz (P3's behavior), and a shorter "refresher" version of the tour runs with it.

## Engineering rules

- Match the surrounding code: its comment density, its plain-English comments, and its naming.
- TypeScript under the repo's tsc flags: no enums, no namespaces, no parameter properties.
- The UI follows Eric's pixel theme (pixel-theme.css, Pixelify Sans, pixel-icons.ts). No rounded or glassy styling.
- Never use em dashes in code, UI text, docs, commits, or the PR. Use a plain "-".
- In long Markdown docs, put each sentence on its own line.
- Don't hand-edit generated files. Regenerate them with their scripts.
- Tests (node --test):
  - pure tour logic: step order, advance rules, branching on state, and persistence of done or skipped tours
  - the new tax_ready cue in cueForEvents
  - that every tour line with no numbers is in allLines()
  - the renamed lines (no "Narrator" left in any displayed string; add a test that greps lines.ts and the UI strings)
- Update the existing narration tests.
- Run from game/: `npm run build` and `npm test`.
- Run from server/: `npm test`, and the DB tests with TEST_DATABASE_URL if you changed the save schema or validation.
- Fix any lint, type, or flaky-test problem you see, even outside this task.

## End-to-end verification (required, in Chrome)

- Run the game and a local server on a local database, not the team's shared Tiger Data. See CLAUDE.md for the local DATABASE_URL.
- Start a fresh life and play both tutorials start to finish as a real player would. Use a save or demo life that reaches its first tax_ready quickly, or skip to it. P3's `first-taxes` demo slot exists for this.
- Screenshot every step at 1440x900 and at a narrow width of about 390px. Check that:
  - the spotlight frame sits exactly on the target, including targets inside the Money iframe and after scrolling
  - Sammy points the right way and never covers what the player must click
  - the bubble tail aims at the target
  - text doesn't overflow
  - the pixel theme is consistent
- Be pixel-picky and fix anything that looks off.
- Also test:
  - skip mid-tour
  - replay
  - reload mid-tour
  - mute (captions still advance)
  - no server (a silent read)
  - reduced motion
  - an event cue firing during a tour (queued, not lost)
  - fast-forward disabled during a tour
  - the clock resuming at the previous speed
  - a wrong and then a right tax answer across two years
- Search the whole repo for any remaining visible "Narrator" or "the Narrator" in UI text. Also listen to at least three re-voiced lines to confirm the pack matches.

## Done means

- Sammy is the name in every displayed string, voiced line, and doc, and the pack is re-voiced.
- Both tours work end to end, are saved as done, and can be replayed.
- All suites and the build pass.
- There are screenshots of each tour in docs/screenshots/sammy-tutorials/.
- game/README.md documents the tour system (how to add a tour or step).
- Commits are small and clear, with no co-author trailer.
- A PR is open against the right base, with screenshots and manual steps listed (the ElevenLabs dashboard agent name, and redeploying Vultr after merge).
