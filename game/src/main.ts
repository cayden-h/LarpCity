import "./style.css";
import { Application, CullerPlugin, extensions } from "pixi.js";
import { cityFor, LANDMARKS, stateForPin } from "./cities";
import { STATES } from "./data/states";
import { Clock } from "./engine/clock";
import { CityScene } from "./engine/scene";
import { loadSpriteSet } from "./engine/sprites";
import { prerenderCityThumbnails } from "./engine/thumbnails";
import type { StateInfo } from "./engine/types";
import { PlayerLife } from "./sim/life";
import { MarketPath } from "./sim/market";
import { Hud } from "./ui/hud";
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
let skipping = 0;

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = Number(new URLSearchParams(location.search).get("seed")) || 20260912;

// The player's money life: paychecks, rent for the current state, and the
// debt engine run once per game day (research/07-debt-system-design.md);
// investments move with the seeded market.
const player = new PlayerLife({ place: state, day: clock.day, market: new MarketPath(seed, clock.start) });
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
});

async function open(next: StateInfo): Promise<void> {
  const tier = scene?.hero?.tier;
  scene?.destroy();
  // `loadSpriteSet` below awaits a network fetch, and the ticker keeps firing
  // during that gap; without this, `scene` still pointed at the destroyed
  // scene, so `scene?.update(dt)` kept calling into it every frame and threw
  // inside a destroyed Graphics context — which broke the render loop for
  // the rest of the session until a full page reload.
  scene = null;
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
  const home = STATES.find((s) => s.abbr === next.abbr);
  history.replaceState(null, "", `#${home && home.cityId !== next.cityId ? next.cityId : next.abbr}`);
}

const npcCard = new NpcCard(document.getElementById("npc")!);

function skipDays(days: number): void {
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
}

const hud = new Hud(document.getElementById("hud")!, {
  tier: (delta) => scene?.hero?.setTier(scene.hero.tier + delta),
  focusHome: () => scene?.focusHome(),
});

const map = new UsMap(document.getElementById("map")!, STATES, (s) => void open(s));

// Every distinct city (6 hand-made, 8 regional templates) gets a real in-game
// render in the background so the map never requires a visit to show one.
prerenderCityThumbnails(
  STATES,
  (cityId, url) => map.setPreview(cityId, url),
  (cityId) => map.hasPreview(cityId),
);

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
    syncHomeTier();
  },
});

// The player's phone is the hub for market, goals, travel, and timeline controls.
const phone = new Phone({
  clock,
  player,
  openFastForward: () => fastForward.open(),
  openMap: () => map.open(state, captureCityPreview()),
  skip: skipDays,
  getWorld: () => ({ state, city: scene?.city ?? cityFor(state), status: scene?.status() ?? null }),
});

app.renderer.on("resize", (w: number, h: number) => scene?.resize(w, h));
app.ticker.add((ticker) => {
  const dt = Math.min(0.1, ticker.deltaMS / 1000);
  clock.update(dt);
  scene?.update(dt);
});
setInterval(() => hud.render(scene?.hero?.tier ?? null), 200);

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
Object.assign(window, { larp: { app, clock, open, visit, step, scene: () => scene, states: STATES, player, phone, fastForward } });
