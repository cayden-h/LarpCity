import "./style.css";
import { Application, CullerPlugin, extensions } from "pixi.js";
import { cityFor, LANDMARKS, stateForPin } from "./cities";
import { STATES } from "./data/states";
import { Clock } from "./engine/clock";
import { CityScene } from "./engine/scene";
import { loadSpriteSet } from "./engine/sprites";
import type { StateInfo } from "./engine/types";
import { cueForEvents } from "./narration/lines";
import { PlayerLife, STARTER_PORTFOLIO } from "./sim/life";
import { lifeFromIntake } from "./sim/life/intake";
import { MarketPath } from "./sim/market";
import { BankSync } from "./sim/mirror";
import { NpcTown } from "./sim/npcs";
import { RunRecorder } from "./sim/record";
import { LifeTimeline } from "./sim/rewind";
import { Hud } from "./ui/hud";
import { runIntake } from "./ui/intake";
import { Narrator } from "./ui/narrator";
import { NpcCard } from "./ui/npccard";
import { Phone } from "./ui/phone";
import { FastForward } from "./ui/skip-setup";
import { UsMap } from "./ui/usmap";
import "./ui/pixel-theme.css";

// The world is big: skip drawing whatever is off-screen.
extensions.add(CullerPlugin);

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  background: "#5d9e46",
  resolution: Math.min(2, window.devicePixelRatio || 1),
  autoDensity: true,
});
document.getElementById("app")!.appendChild(app.canvas);

const clock = new Clock();
let scene: CityScene | null = null;
let state: StateInfo = STATES.find((s) => s.abbr === "TX")!;
/** The time-lapse skip's interval, or 0 when no skip is playing. */
let skipTimer = 0;

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = Number(new URLSearchParams(location.search).get("seed")) || 20260912;

// The hash is a state (#CA) or a specialized city (#dallas).
const fromHash = () => {
  const h = location.hash.slice(1);
  return STATES.find((s) => s.abbr === h.toUpperCase()) ?? stateForPin(h.toLowerCase(), STATES);
};
// Start where the link points, so the rent the player states belongs to that state.
state = fromHash() ?? state;

// Onboarding: the owl's voice interview (or the typed form) sets the player's
// job, pay, rent, debt, and savings before the first day runs; skipping it
// keeps the sample household.
const intake = await runIntake({ backdrop: `${import.meta.env.BASE_URL}cities/${state.cityId}/plates/day.jpg` });

// The player's money life: paychecks, rent for the current state, and the
// debt engine run once per game day (research/07-debt-system-design.md);
// investments (a starter portfolio from day one, with or without the
// interview) move with the seeded market.
const market = new MarketPath(seed, clock.start);
const player = intake
  ? lifeFromIntake(intake, { place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO })
  : new PlayerLife({ place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO });

// The owl narrates the big moments from here on (narration/lines.ts).
const narrator = new Narrator();

// The named NPCs' money lives on the same market (src/data/npcs.ts), and the
// bank mirror posts the player's and theirs to Capital One Nessie through the
// server, one statement per game month (off when the server isn't running).
const town = new NpcTown({ place: state, day: clock.day, market: player.market, start: clock.start });
const api = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
const bank = new BankSync({ run: `${seed}-${Date.now().toString(36)}`, start: clock.start, base: `${api}/bank` });
bank.add("player", "Player", player);
for (const [id, life] of town.lives) bank.add(id, town.profiles.get(id)!.first, life);
void bank.begin();
// The player's daily snapshots and life events, recorded in Tiger Data for charts, history, and the leaderboard.
const recorder = new RunRecorder({ life: player, seed, base: api });
void recorder.begin();
// A checkpoint every game day, so the Calendar can go back to any past day (sim/rewind).
const timeline = new LifeTimeline(player, { start: clock.start });

let shownTier = -1;
function syncHomeTier() {
  const tier = player.homeTier();
  if (tier !== shownTier) {
    if (shownTier !== -1) narrator.cue(tier > shownTier ? "home_up" : "home_down");
    shownTier = tier;
    scene?.hero?.setTier(tier);
  }
}
clock.onDay((day) => {
  const events = player.onDay(day, clock.date);
  if (player.needsDecision(events)) {
    // A crash, a payment the player can't cover, or bankruptcy: stop the time-lapse and open the
    // Money desk on the decision (opening it pauses the clock), instead of pausing time behind it.
    stopSkip();
    phone.showDecision(events.filter((e) => player.needsDecision([e])));
  }
  if (player.stopsSkip(events)) {
    // Bankruptcy stops skips and pauses time (the game design meeting's rule).
    stopSkip();
    clock.speed = 0;
  }
  const cue = cueForEvents(events);
  if (cue) narrator.cue(cue);
  syncHomeTier();
  town.onDay(day);
  void bank.tick(day);
  void recorder.tick();
});

async function open(next: StateInfo): Promise<void> {
  const tier = scene?.hero?.tier;
  scene?.destroy();
  if (next.abbr !== state.abbr) {
    player.setPlace(next, clock.day);
    narrator.cue("moved");
  }
  state = next;
  const city = cityFor(next);
  const sprites = await loadSpriteSet(city.id);
  scene = new CityScene(app, city, clock, LANDMARKS, sprites);
  if (tier !== undefined) scene.hero?.setTier(tier);
  scene.onPick = (npc, sx, sy) => npcCard.show(npc, sx, sy);
  app.stage.addChild(scene.root);
  scene.resize(app.screen.width, app.screen.height);
  npcCard.hide();
  const home = STATES.find((s) => s.abbr === next.abbr);
  history.replaceState(null, "", `#${home && home.cityId !== next.cityId ? next.cityId : next.abbr}`);
}

const npcCard = new NpcCard(document.getElementById("npc")!);

/** Most steps a time-lapse skip takes (at least 40 ms each), however far it goes. */
const SKIP_STEPS = 60;

function stopSkip(): void {
  clearInterval(skipTimer);
  skipTimer = 0;
  clock.skipping = false;
}

/** Plays the days up to `target` as a time-lapse (the Calendar's "Skip to"); a decision on the way stops it there. */
function skipTo(target: number): void {
  if (skipTimer || target <= clock.day) return;
  const days = target - clock.day;
  const perStep = Math.ceil(days / SKIP_STEPS);
  clock.skipping = true;
  skipTimer = window.setInterval(() => {
    for (let i = 0; i < perStep && skipTimer && clock.day < target; i++) clock.advanceDays(1);
    if (clock.day >= target) stopSkip();
  }, Math.max(40, 1400 / days));
}

/** Goes back to the morning of a past day (the Calendar's "Go back"): everything after it is undone, and time pauses. */
function rewindTo(day: number): void {
  if (day >= clock.day || day < timeline.firstDay) return;
  stopSkip();
  clock.speed = 0;
  timeline.rewindTo(day);
  clock.jumpTo(day);
  town.rewind(day);
  bank.rewind(day);
  void recorder.rewind(day);
  syncHomeTier();
  phone.rewound(day, player.log.filter((e) => e.day === day && player.needsDecision([e])));
}

const hud = new Hud(document.getElementById("hud")!, {
  tier: (delta) => scene?.hero?.setTier(scene.hero.tier + delta),
  focusHome: () => scene?.focusHome(),
});

const map = new UsMap(document.getElementById("map")!, STATES, (s) => void open(s));

function captureCityPreview(): string | null {
  try {
    // Capture the real rendered city rather than the separate photographic plates.
    app.render();
    const source = app.canvas;
    const preview = document.createElement("canvas");
    preview.width = 560;
    preview.height = 315;
    const context = preview.getContext("2d");
    if (!context || !source.width || !source.height) return null;

    const targetRatio = preview.width / preview.height;
    const sourceRatio = source.width / source.height;
    let sx = 0, sy = 0, sw = source.width, sh = source.height;
    if (sourceRatio > targetRatio) {
      sw = source.height * targetRatio;
      sx = (source.width - sw) / 2;
    } else {
      sh = source.width / targetRatio;
      sy = (source.height - sh) / 2;
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(source, sx, sy, sw, sh, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/webp", 0.84);
  } catch {
    return null;
  }
}

// Fast-forward to a goal: the setup screen runs the days headless, then the calendar jumps.
const fastForward = new FastForward({
  clock,
  player,
  seed,
  onFinished: (result) => {
    clock.jumpTo(result.toDay);
    narrator.cue("fast_forward");
    syncHomeTier();
    // The fast-forward ran only the player; catch the NPCs up, then post the skipped months as one summary.
    town.catchUp(result.toDay);
    void bank.tick(result.toDay);
    void recorder.tick(true);
  },
});

// The player's phone is the hub for market, goals, travel, and the calendar
// (Stocks opens the Money desk; Goals opens the fast-forward; Calendar goes back and skips ahead).
const phone = new Phone({
  clock,
  player,
  recorder,
  openFastForward: () => fastForward.open(),
  openMap: () => map.open(state, captureCityPreview()),
  skipTo,
  rewindTo,
  firstDay: () => timeline.firstDay,
  getWorld: () => ({ state, city: scene?.city ?? cityFor(state), status: scene?.status() ?? null }),
});

app.renderer.on("resize", (w: number, h: number) => scene?.resize(w, h));
app.ticker.add((ticker) => {
  const dt = Math.min(0.1, ticker.deltaMS / 1000);
  clock.update(dt);
  scene?.update(dt);
});
setInterval(() => hud.render(scene?.hero?.tier ?? null), 200);

// Shared links and back/forward change only the hash, so follow it.
window.addEventListener("hashchange", () => {
  const s = fromHash();
  if (s && s.cityId !== state.cityId) void open(s);
});
await open(state);
// Show the player's real home from the first frame, not the hero's default tier.
syncHomeTier();

// The owl opens the story once per browser tab.
try {
  if (!sessionStorage.getItem("larp.narrator.arrived")) {
    sessionStorage.setItem("larp.narrator.arrived", "1");
    narrator.cue("arrival");
  }
} catch {
  narrator.cue("arrival");
}

/** Advance the game by `seconds` of simulated frames and render once. Background tabs throttle rAF, so tests use this. */
function step(seconds: number) {
  for (let i = 0; i < seconds * 30; i++) {
    clock.update(1 / 30);
    scene?.update(1 / 30);
  }
  app.render();
  return scene?.status();
}

async function visit(abbrOrCity: string, seconds = 3) {
  const s = STATES.find((st) => st.abbr === abbrOrCity.toUpperCase()) ?? stateForPin(abbrOrCity.toLowerCase(), STATES);
  if (!s) throw new Error(`unknown state or city ${abbrOrCity}`);
  await open(s);
  return step(seconds);
}

// Handy for testing from the console.
Object.assign(window, { larp: { app, clock, open, visit, step, scene: () => scene, states: STATES, player, town, bank, recorder, phone, fastForward, narrator } });
