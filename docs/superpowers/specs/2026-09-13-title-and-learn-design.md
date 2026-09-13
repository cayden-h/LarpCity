# Title screen and Sammy's Learn walkthrough

A new life now opens on a simple home screen: Larp City's name, Sammy the owl, and a Learn button over a blurred San Francisco.
Learn plays a short walkthrough in Sammy's speech bubble, then hands off to the existing setup screens (ui/intake.ts).
The walkthrough's order comes from the team's Granola notes: the retirement goal, the phone, milestones and cost of living, time and skips, skips stopped by big events, Sammy's tips, then setting up and picking goals.

## When it shows

- Only where the game is about to run the intake (a new life, including `?intake=1`).
- A saved game resumes straight into the city, as today.
- `?intake=0` skips the title along with the intake.

## Home screen (`ui/title.ts`, `ui/title.css`)

- A full-screen overlay over the SF day plate (`cities/san-francisco/plates/day.jpg`), blurred about 10px and lightly tinted so the bay's colors still read, whatever the starting state.
- "LARP CITY" in large Pixelify Sans, in the pixel theme (hard edges, stepped shadow, no rounded or glassy styling).
- Sammy large and centered below it (`Owl`, `wave` then `idle`).
- One yellow `.btn` **Learn** button, focused on open, and a small "Skip to setup" link under it.
- The overlay sits at z-index 27: above the city, and under Sammy's tour-mode box (28) and the intake (30).

## Learn walkthrough

- Learn fades the title and big owl out, and Sammy's real narrator box (ui/narrator.ts) takes over in tour mode, centered on the screen.
  This reuses his bubble, voice, word captions, mute, Back, Next, "3 / 8" counter, Skip, and focus handling.
- `main.ts` creates the `Narrator` before the intake (it is only DOM until it speaks), so the title can borrow it.
- Enter or the Next button moves on, Back goes back, and Esc or Skip ends the walkthrough; the last step's button reads Finish.
- Ending it by Finish or Skip removes the title overlay and resolves, and the intake's welcome card (Talk, Type, or Skip) opens as it does now.
- The walkthrough is not recorded in the save; it shows on every new life, and Learn is always a choice.

## The script (`narration/learn.ts`)

A plain array of steps, each a line, an owl reaction (`anim`), and a mood.

1. wave: "Hello. I'm Sammy. This is Larp City, and the life in it is yours: your salary, your rent, your debt."
2. proud: "The goal is simple. Retire. [slow] Preferably before sixty-five, and preferably not broke. You'll learn a few money tricks on the way."
3. type: "Your phone runs everything. Money, stocks, goals, the map, and a calendar where every day actually happens."
4. think: "Along the way: a house, a wedding, paying off those loans. Where you live matters. San Francisco rent is [sighs] a lot."
5. step: "Time moves a day at a time. Speed it up, or skip straight to the next thing that needs you."
6. magic: "Skips stop for the big stuff. A market crash, a car breakdown, a trip to the hospital, a divorce. I'll explain what happened. Calmly."
7. tip-hat: "I'll pop in with tips when you reach a goal, go broke, or your stocks swing. [whispers] Mostly: diversify."
8. cheer: "First, let's set up your life and pick your goals. They're permanent, so choose like a grown-up."

Step 3 uses an existing owl reaction with the `point` mood, since no target exists to aim at.
Every line joins `allLines()`, so the narration pack builder voices it.

## Voice

- The lines go through the pack and fall back to the server's TTS, then to a silent read, as every narrator line does.
- ElevenLabs credits are out until 2026-10-12. If the pack can't be rebuilt now, the lines read silently and `tests/narration-pack.test.ts` names the unvoiced lines; that gap is reported, not hidden.

## Tests

- `tests/learn.test.ts`: 8 steps; every anim is a real `OwlAnim`; only known delivery tags; no em dashes; every line is in `allLines()`.
- Build (`npm run build`) and the whole game suite.
- In Chrome at 1440x900 and 390px wide: the first visit, Learn through all 8 steps into the welcome card, Back, Skip at step 3, "Skip to setup", keyboard only, mute, and reduced motion.
  Screenshots go in `docs/screenshots/title-learn/`.
