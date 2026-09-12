import "./style.css";
import { Application, CullerPlugin, extensions } from "pixi.js";
import { cityFor, LANDMARKS, stateForPin } from "./cities";
import { STATES } from "./data/states";
import { Clock } from "./engine/clock";
import { CityScene } from "./engine/scene";
import { loadSpriteSet } from "./engine/sprites";
import type { StateInfo } from "./engine/types";
import { PlayerLife, STARTER_PORTFOLIO } from "./sim/life";
import { MarketPath } from "./sim/market";
import { BankSync } from "./sim/mirror";
import { NpcTown } from "./sim/npcs";
import { RunRecorder } from "./sim/record";
import { Hud } from "./ui/hud";
import { NpcCard } from "./ui/npccard";
import { Phone } from "./ui/phone";
import { FastForward } from "./ui/skip-setup";
import { UsMap } from "./ui/usmap";

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
let skipping = 0;

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = Number(new URLSearchParams(location.search).get("seed")) || 20260912;

// The player's money life: paychecks, rent for the current state, and the
// debt engine run once per game day (research/07-debt-system-design.md);
// investments (a starter portfolio from day one) move with the seeded market.
const player = new PlayerLife({ place: state, day: clock.day, market: new MarketPath(seed, clock.start), holdings: STARTER_PORTFOLIO });

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

let shownTier = -1;
function syncHomeTier() {
  const tier = player.homeTier();
  if (tier !== shownTier) {
    shownTier = tier;
    scene?.hero?.setTier(tier);
  }
}
clock.onDay((day) => {
  const events = player.onDay(day, clock.date);
  if (player.stopsSkip(events)) {
    // Bankruptcy stops skips and pauses time (the game design meeting's rule).
    skipping = 0;
    clock.speed = 0;
  }
  syncHomeTier();
  town.onDay(day);
  void bank.tick(day);
  void recorder.tick();
});

async function open(next: StateInfo): Promise<void> {
  const tier = scene?.hero?.tier;
  scene?.destroy();
  if (next.abbr !== state.abbr) player.setPlace(next, clock.day);
  state = next;
  const city = cityFor(next);
  const sprites = await loadSpriteSet(city.id);
  scene = new CityScene(app, city, clock, LANDMARKS, sprites);
  if (tier !== undefined) scene.hero?.setTier(tier);
  scene.onPick = (npc, sx, sy) => npcCard.show(npc, sx, sy);
  app.stage.addChild(scene.root);
  scene.resize(app.screen.width, app.screen.height);
  npcCard.hide();
  hud.setCity(next, city);
  const home = STATES.find((s) => s.abbr === next.abbr);
  history.replaceState(null, "", `#${home && home.cityId !== next.cityId ? next.cityId : next.abbr}`);
}

const npcCard = new NpcCard(document.getElementById("npc")!);

const hud = new Hud(document.getElementById("hud")!, {
  speed: (m) => (clock.speed = m),
  skip: (days) => {
    // Play the skip as a quick time-lapse instead of a jump cut.
    if (skipping) return;
    skipping = days;
    clock.skipping = true;
    const step = Math.max(40, 1400 / days);
    const timer = setInterval(() => {
      clock.advanceDays(1);
      if (--skipping <= 0) {
        clearInterval(timer);
        clock.skipping = false;
      }
    }, step);
  },
  tier: (delta) => scene?.hero?.setTier(scene.hero.tier + delta),
  event: (id) => scene?.trigger(id),
  sky: (v) => (clock.pinnedTimeOfDay = v),
  zoom: (f) => (f === "reset" ? scene?.resetCamera() : scene?.zoomBy(f)),
  openMap: () => map.open(state),
  focusHome: () => scene?.focusHome(),
});

const map = new UsMap(document.getElementById("map")!, STATES, (s) => void open(s));

// Fast-forward to a goal: the setup screen runs the days headless, then the calendar jumps.
const fastForward = new FastForward({
  clock,
  player,
  seed,
  onFinished: (result) => {
    clock.jumpTo(result.toDay);
    syncHomeTier();
    // The fast-forward ran only the player; catch the NPCs up, then post the skipped months as one summary.
    town.catchUp(result.toDay);
    void bank.tick(result.toDay);
    void recorder.tick(true);
  },
});

// The player's phone: the hub for the game's apps (Stocks opens the Credit Desk; Goals opens the fast-forward).
const phone = new Phone({ clock, player, openFastForward: () => fastForward.open() });

app.renderer.on("resize", (w: number, h: number) => scene?.resize(w, h));
app.ticker.add((ticker) => {
  const dt = Math.min(0.1, ticker.deltaMS / 1000);
  clock.update(dt);
  scene?.update(dt);
});
setInterval(() => hud.render(clock, scene?.status() ?? null, scene?.hero?.tier ?? null), 200);

// The hash is a state (#CA) or a specialized city (#dallas).
const fromHash = () => {
  const h = location.hash.slice(1);
  return STATES.find((s) => s.abbr === h.toUpperCase()) ?? stateForPin(h.toLowerCase(), STATES);
};
// Shared links and back/forward change only the hash, so follow it.
window.addEventListener("hashchange", () => {
  const s = fromHash();
  if (s && s.cityId !== state.cityId) void open(s);
});
await open(fromHash() ?? state);

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
Object.assign(window, { larp: { app, clock, open, visit, step, scene: () => scene, states: STATES, player, town, bank, recorder, phone, fastForward } });
