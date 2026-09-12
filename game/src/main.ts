import "./style.css";
import { Application, CullerPlugin, extensions } from "pixi.js";
import { cityFor, LANDMARKS, stateForPin } from "./cities";
import { STATES } from "./data/states";
import { Clock } from "./engine/clock";
import { CityScene } from "./engine/scene";
import { loadSpriteSet } from "./engine/sprites";
import type { StateInfo } from "./engine/types";
import { cueForEvents, welcomeBackLine } from "./narration/lines";
import { PlayerLife, STARTER_PORTFOLIO } from "./sim/life";
import { answersFromProfile, lifeFromIntake, profileFromIntake } from "./sim/life/intake";
import { Inbox } from "./sim/mail/inbox";
import { MarketPath } from "./sim/market";
import { BankSync } from "./sim/mirror";
import { NpcTown } from "./sim/npcs";
import { RunRecorder } from "./sim/record";
import { LifeTimeline } from "./sim/rewind";
import { saveApi } from "./sim/save/client";
import { encodeGame, parseSave, restoreGame, SaveFormatError, type RestoredGame } from "./sim/save/codec";
import { trimDesk } from "./sim/save/desk";
import { SaveManager } from "./sim/save/manager";
import type { DeskState, GameSave } from "./sim/save/types";
import { Hud } from "./ui/hud";
import { runIntake } from "./ui/intake";
import { Narrator } from "./ui/narrator";
import { NpcCard } from "./ui/npccard";
import { showNotice } from "./ui/notice";
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
/** The time-lapse skip's interval, or 0 when no skip is playing. */
let skipTimer = 0;
const params = new URLSearchParams(location.search);

// The hash is a state (#CA) or a specialized city (#dallas).
const stateFor = (h: string) => STATES.find((s) => s.abbr === h.toUpperCase()) ?? stateForPin(h.toLowerCase(), STATES);
const fromHash = () => stateFor(location.hash.slice(1));
const TX = STATES.find((s) => s.abbr === "TX")!;

// Who this is and where they left off (server/src/routes/save.ts); null when the server is down,
// in which case the player gets a fresh life that isn't saved (the HUD says so).
const saves = saveApi();
const me = await saves.me().catch(() => null);
// ?intake=1 starts a new life over the save (the save manager then overwrites it).
let saved: GameSave | null = null;
let restored: RestoredGame | null = null;
if (me?.save && params.get("intake") !== "1") {
  try {
    saved = parseSave(me.save.state);
    // Decoded whole before anything live is built, so a bad save can't half-load (sim/save/codec.ts).
    restored = restoreGame(saved, { market: new MarketPath(saved.seed, clock.start), place: stateFor(saved.hash) ?? TX, start: clock.start });
  } catch (err) {
    if (!(err instanceof SaveFormatError)) throw err;
    console.warn("[save] can't load the saved game:", err.message);
    await showNotice({
      title: "A save this version can't load",
      body: "This life was saved by a different version of Larp City, or the save is damaged, so it can't be loaded here.",
      action: "Start a new life",
    });
    await saves.deleteSave().catch(() => undefined);
    saved = restored = null;
    me.save = null;
    me.profile = null;
  }
}

// A saved game goes back where the player was. Otherwise start where the link points, so the
// rent the player states belongs to that state, or in their profile's state.
let state: StateInfo =
  (saved ? stateFor(saved.hash) : undefined) ?? fromHash() ?? STATES.find((s) => s.abbr === me?.profile?.state) ?? TX;
if (saved?.hash) history.replaceState(null, "", `#${saved.hash}`);

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = saved?.seed ?? (Number(params.get("seed")) || 20260912);
const market = restored?.life.market ?? new MarketPath(seed, clock.start);

// The player's money life: paychecks, rent for the current state, and the debt engine run once
// per game day (research/07-debt-system-design.md), with a starter portfolio on the seeded market.
// It is restored from the save, or built from the profile; with no profile, the owl's voice
// interview (or the typed form) asks first and the answers become the profile.
let player: PlayerLife;
if (saved && restored) {
  clock.jumpTo(saved.day);
  player = restored.life;
  player.place = state;
} else {
  let profile = me?.profile ?? null;
  if (!profile || params.get("intake") === "1") {
    const r = await runIntake({ backdrop: `${import.meta.env.BASE_URL}cities/${state.cityId}/plates/day.jpg` });
    const p = profileFromIntake(r.answers, r.source, state.abbr);
    profile = { ...p, displayName: null };
    // With the server down this is lost and the next visit asks again, like the save itself.
    void saves.putProfile(p).catch(() => undefined);
  }
  const answers = answersFromProfile(profile);
  player = answers
    ? lifeFromIntake(answers, { place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO })
    : new PlayerLife({ place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO });
}

// The owl narrates the big moments from here on (narration/lines.ts).
const narrator = new Narrator();

// The named NPCs' money lives on the same market (src/data/npcs.ts), and the
// bank mirror posts the player's and theirs to Capital One Nessie through the
// server, one statement per game month (off when the server isn't running).
const town = restored?.town ?? new NpcTown({ place: state, day: clock.day, market: player.market, start: clock.start });
const api = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
// A resumed game keeps its Nessie accounts: the server reopens the same run and reads back its balances.
const bankRun = saved?.bankRun || `${seed}-${Date.now().toString(36)}`;
const bank = new BankSync({ run: bankRun, start: clock.start, base: `${api}/bank` });
bank.add("player", "Player", player);
for (const [id, life] of town.lives) bank.add(id, town.profiles.get(id)!.first, life);
void bank.begin();
// The player's daily snapshots and life events, recorded in Tiger Data for charts, history, and
// the leaderboard; a resumed game records into its saved run.
const recorder = new RunRecorder({ life: player, seed, base: api, runId: saved ? me?.save?.runId : undefined });
// A checkpoint every game day, so the Calendar can go back to any past day (sim/rewind). A resumed
// game's first checkpoint is the day it was loaded on, so the Calendar goes back no further than that.
const timeline = new LifeTimeline(player, { start: clock.start });

// The phone's Mail inbox (sim/mail) and what the Money desk last reported; both ride in the save.
const mail = restored?.mail ?? new Inbox();
let desk: DeskState | null = saved?.desk ?? null;

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
  // Save each new game month, so time-lapses and long idle play are kept too.
  if (clock.date.getDate() === 1) saver.request();
});

async function open(next: StateInfo): Promise<void> {
  const tier = scene?.hero?.tier;
  scene?.destroy();
  if (next.abbr !== state.abbr) {
    player.setPlace(next, clock.day);
    narrator.cue("moved");
    saver.request();
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
  mail.rewind(day);
  bank.rewind(day);
  void recorder.rewind(day);
  // The desk trims its own lists when it hears about the rewind; trim the city's copy of them too,
  // so a save before the desk reports again doesn't bring the discarded days back.
  if (desk) desk = trimDesk(desk, day);
  syncHomeTier();
  phone.rewound(day, player.log.filter((e) => e.day === day && player.needsDecision([e])));
  saver.request();
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
    saver.request();
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
  changed: (d) => {
    desk = d;
    saver.request();
  },
  deskState: () => desk,
});

app.renderer.on("resize", (w: number, h: number) => scene?.resize(w, h));
app.ticker.add((ticker) => {
  const dt = Math.min(0.1, ticker.deltaMS / 1000);
  clock.update(dt);
  scene?.update(dt);
});
setInterval(() => hud.render(scene?.hero?.tier ?? null), 200);

// Autosave (sim/save/manager.ts): after a rewind, a move, a skip, the desk's decisions, and each
// game month. A second tab playing the same life wins; this one stops and says so.
const saver = new SaveManager({
  api: saves,
  build: () => encodeGame({ seed, day: clock.day, hash: location.hash.slice(1), bankRun, life: player, town, mail, desk }),
  runId: () => recorder.runId,
  // ?intake=1 over an existing save overwrites it rather than conflicting with it.
  baseRev: me?.save?.rev ?? null,
  onStatus: (s) => {
    hud.setSave(s);
    if (s !== "conflict") return;
    clock.speed = 0;
    void showNotice({
      title: "Playing somewhere else",
      body: "This life is open in another tab, so this one stopped saving. Reload to carry on from there.",
      action: "Reload",
    }).then(() => location.reload());
  },
});
hud.setWho(player.job);
void recorder.begin().then(() => saver.request());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void saver.flush();
});
window.addEventListener("pagehide", () => saver.flushOnUnload());
// Back from the back/forward cache, this page's rev may be stale: load the life fresh instead.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

// Shared links and back/forward change only the hash, so follow it.
window.addEventListener("hashchange", () => {
  const s = fromHash();
  if (s && s.cityId !== state.cityId) void open(s);
});
await open(state);
// Show the player's real home from the first frame, not the hero's default tier.
syncHomeTier();

// The owl opens the story once per browser tab, or welcomes a returning player back.
if (saved) narrator.speak(welcomeBackLine(player.job || null, clock.date), "arrival");
else {
  try {
    if (!sessionStorage.getItem("larp.narrator.arrived")) {
      sessionStorage.setItem("larp.narrator.arrived", "1");
      narrator.cue("arrival");
    }
  } catch {
    narrator.cue("arrival");
  }
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
Object.assign(window, { larp: { app, clock, open, visit, step, scene: () => scene, states: STATES, player, town, bank, recorder, phone, fastForward, narrator, saver, mail } });
