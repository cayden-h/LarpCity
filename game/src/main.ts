import "./style.css";
import { Application, CullerPlugin, extensions } from "pixi.js";
import { BankClient } from "./api/bank";
import { HomePicker } from "./ui/home-picker";
import { cityFor, LANDMARKS } from "./cities";
import { BACKGROUND_NPCS } from "./data/background-npcs";
import { NPCS } from "./data/npcs";
import { STATES } from "./data/states";
import { stateUniversity } from "./data/state-universities";
import { Clock } from "./engine/clock";
import type { ResidentSeed } from "./engine/people";
import { CityScene } from "./engine/scene";
import { loadSpriteSet } from "./engine/sprites";
import { rngFor } from "./engine/rng";
import type { StateInfo } from "./engine/types";
import { cueForEvents, welcomeBackLine } from "./narration/lines";
import { PlayerLife, STARTER_PORTFOLIO } from "./sim/life";
import { DEFAULT_GOALS, DEFAULT_INSURANCE_PLAN_ID, lifeFromIntake, starterFor } from "./sim/life/intake";
import { MATCH_UP_TO } from "./sim/life/player";
import { BEGINNER_CARDS } from "./data/cards-beginner";
import { Inbox, type DebtLookup } from "./sim/mail/inbox";
import { MarketPath } from "./sim/market";
import { BankSync } from "./sim/mirror";
import { NpcTown } from "./sim/npcs";
import { describeHabit } from "./sim/npcs/habits";
import { RunRecorder } from "./sim/record";
import { LifeTimeline } from "./sim/rewind";
import { ReviewGate } from "./sim/rewind/gate";
import { bootPath, fetchMe, offlineNotice } from "./sim/save/boot";
import { saveApi } from "./sim/save/client";
import { encodeGame, parseSave, restoreGame, SaveFormatError, type RestoredGame } from "./sim/save/codec";
import { trimDesk } from "./sim/save/desk";
import { SaveManager } from "./sim/save/manager";
import { activeSlot, DEMOS, rememberSlot } from "./sim/save/slot";
import { openSlots } from "./ui/slots";
import type { DeskState, GameSave } from "./sim/save/types";
import { Hud } from "./ui/hud";
import { mountHappinessMeter } from "./ui/happiness";
import { runSetup } from "./ui/intake";
import { Narrator } from "./ui/narrator";
import { runTitle } from "./ui/title";
import { TourGuide } from "./ui/tour";
import type { TourRecord } from "./narration/tour";
import { NpcCard } from "./ui/npccard";
import { showNotice } from "./ui/notice";
import { Phone } from "./ui/phone";
import { FastForward } from "./ui/skip-setup";
import "./ui/pixel-theme.css";
import "./ui/happiness.css";

// The world is big: skip drawing whatever is off-screen.
extensions.add(CullerPlugin);

const app = new Application();
await app.init({
  resizeTo: window,
  // Culled sprites do not refresh cached transforms; camera moves must update them before culling.
  culler: { updateTransform: true },
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

// There is one place: San Francisco, California. Any other hash (#TX, #dallas) falls back to #CA.
const HOME = STATES.find((s) => s.abbr === "CA")!;
if (location.hash !== `#${HOME.abbr}`) history.replaceState(null, "", `${location.pathname}${location.search}#${HOME.abbr}`);
const SF_PLATE = `${import.meta.env.BASE_URL}cities/san-francisco/plates/day.jpg`;

// Sammy narrates the big moments; the title screen borrows him first.
const narrator = new Narrator();

// A plain visit opens on the title screen (Learn, or skip), then the save slots. Picking a slot
// reloads with ?slot=, which boots straight into it, as does a reload mid-game or a demo link.
if (!params.has("slot") && !params.has("demo") && params.get("intake") !== "0") {
  await runTitle({ backdrop: SF_PLATE, narrator });
  await openSlots({ current: null, start: clock.start, boot: { backdrop: SF_PLATE } });
}

// Who this is and where they left off (server/src/routes/save.ts), retried through a blip. A /me
// that still fails is never taken as "no save" (sim/save/boot.ts): the player picks between trying
// again and a fresh life that is never saved, so their real profile and save are left alone.
// The player has three save slots (sim/save/slot.ts); ?slot= picks one, and this browser remembers it.
const slot = activeSlot(params);
rememberSlot(slot);
const saves = saveApi(undefined, slot);
const meResult = await fetchMe(() => saves.me(), { tries: 3, delayMs: 800 });
// ?intake=1 starts a new life over the save (the save manager then overwrites it).
let path = bootPath(meResult, { intake: params.get("intake") === "1" });
const me = meResult.ok ? meResult.me : null;
// ?demo=<id> (the slot picker's demo lives): a pre-built life from public/demo/ plays in this slot as a
// new run, so whatever the slot held goes first, or the new life's first save would conflict with it.
const demo = params.get("demo");
let demoState: unknown = null;
if (demo && path !== "offline") {
  const res = await fetch(`${import.meta.env.BASE_URL}demo/${encodeURIComponent(demo)}.json`).catch(() => null);
  demoState = res?.ok ? await res.json().catch(() => null) : null;
  if (demoState && me?.save && !(await saves.deleteSave().then(() => true, () => false))) demoState = null;
  if (demoState && me) {
    me.save = null;
    path = "resume";
  }
}
/** Whether this life may be written to the server (its profile and its save). */
let saving = path !== "offline";
if (path === "offline") {
  // A 4xx is the server refusing this save, not the server being down; the notice says which.
  const choice = await showNotice({ ...offlineNotice(meResult), actions: ["Try again", "Play without saving"] });
  if (choice === 0) {
    location.reload();
    await new Promise(() => undefined);
  }
}

let saved: GameSave | null = null;
let restored: RestoredGame | null = null;
if (path === "resume" && (demoState || me?.save)) {
  try {
    saved = parseSave(demoState ?? me?.save?.state);
    // Decoded whole before anything live is built, so a bad save can't half-load (sim/save/codec.ts).
    // A life saved in another state (before there was only one) comes back in California.
    restored = restoreGame(saved, { market: new MarketPath(saved.seed, clock.start), place: HOME, start: clock.start });
  } catch (err) {
    if (!(err instanceof SaveFormatError)) throw err;
    console.warn("[save] can't load the saved game:", err.message);
    await showNotice({
      title: "A save this version can't load",
      body: "This life was saved by a different version of Larp City, or the save is damaged, so it can't be loaded here.",
      actions: ["Start a new life"],
    });
    // If the old save can't be deleted, every write of the new life would 409 against it: play unsaved instead.
    if (!(await saves.deleteSave().then(() => true, () => false))) saving = false;
    saved = restored = null;
    demoState = null;
    if (me) {
      me.save = null;
      me.profile = null;
    }
    path = "intake";
  }
}

let state: StateInfo = HOME;

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = saved?.seed ?? (Number(params.get("seed")) || 20260912);
const market = restored?.life.market ?? new MarketPath(seed, clock.start);
// Read once: a reload (another tab's conflict, the back/forward cache) must not start the intake over
// the save again, and a resumed game's seed is its own.
if (params.has("intake") || params.has("demo") || (saved && params.has("seed"))) {
  const url = new URL(location.href);
  url.searchParams.delete("intake");
  // A demo loads once; a reload resumes it from the slot's save.
  url.searchParams.delete("demo");
  if (saved) url.searchParams.delete("seed");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

// The player's money life: paychecks, rent, and the debt engine run once per game day
// (research/07-debt-system-design.md), with a starter portfolio on the seeded market. It is
// restored from the save; a new life's money is generated from the seed (never asked), and
// Sammy's setup takes the player's name, avatar, health plan, starter card, and goals.
let player: PlayerLife;
if (saved && restored) {
  clock.jumpTo(saved.day);
  player = restored.life;
  player.place = HOME;
} else {
  const starter = starterFor(state, rngFor("starter", seed));
  // ?intake=0 skips the setup (for tests) with the default picks.
  const picks =
    params.get("intake") === "0"
      ? { name: "You", avatar: "male" as const, insurancePlanId: DEFAULT_INSURANCE_PLAN_ID, selectedCardId: BEGINNER_CARDS[0].slug, goals: DEFAULT_GOALS }
      : await runSetup({ backdrop: SF_PLATE, starter, placeName: "San Francisco" });
  // A 6-month emergency fund and the full employer match, as the revamp meeting set; both change later.
  player = lifeFromIntake({ ...starter, ...picks, emergencyMonths: 6, k401Pct: MATCH_UP_TO }, { place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO });
}

// The named NPCs' money lives on the same market (src/data/npcs.ts), and the
// bank mirror posts the player's and theirs to Capital One Nessie through the
// server, one statement per game month (off when the server isn't running).
const town = restored?.town ?? new NpcTown({ place: state, day: clock.day, market: player.market, start: clock.start });
const api = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
const primaryBase = `${api}/bank`;
const backgroundBase = `${api}/bank-bg`;
// Marcus's story (data/npcs.ts) carries a {{stateUniversity}} placeholder, resolved here
// against the current state rather than baked into the profile, so it tracks a move the
// same way rent already does (see buildResidents's call site in open()).
function resolveStory(story: string): string {
  return story.replaceAll("{{stateUniversity}}", stateUniversity(state.abbr));
}
function buildResidents(): ResidentSeed[] {
  return [
    ...NPCS.map((n) => ({ id: n.id, first: n.first, last: n.last, job: n.job, age: n.age, story: `${resolveStory(n.story)} ${describeHabit(n.id)}`, marked: true, bankBase: primaryBase })),
    ...BACKGROUND_NPCS.map((n) => ({ id: n.id, first: n.first, last: n.last, job: n.job, age: n.age, story: `${resolveStory(n.story)} ${describeHabit(n.id)}`, marked: false, bankBase: backgroundBase })),
  ];
}
let residents: ResidentSeed[] = buildResidents();
const bankClient = new BankClient(primaryBase);
// A resumed game keeps its Nessie accounts: the server reopens the same run and reads back its balances.
const bankRun = saved?.bankRun || `${seed}-${Date.now().toString(36)}`;
const bank = new BankSync({ run: bankRun, start: clock.start, base: primaryBase });
bank.add("player", "Player", player);
const backgroundIds = new Set(BACKGROUND_NPCS.map((n) => n.id));
for (const [id, life] of town.lives) bank.add(id, town.profiles.get(id)!.first, life, backgroundIds.has(id) ? { base: backgroundBase } : {});
void bank.begin();
// The player's daily snapshots and life events, recorded in Tiger Data for charts, history, and
// the leaderboard; a resumed game records into its saved run.
const recorder = new RunRecorder({ life: player, seed, base: api, runId: saved ? me?.save?.runId : undefined });
// A checkpoint every game day, so the Calendar can go back to any past day (sim/rewind). A resumed
// game's first checkpoint is the day it was loaded on, so the Calendar goes back no further than that.
const timeline = new LifeTimeline(player, { start: clock.start });
// Going back opens only in the end-of-game review (sim/rewind/gate.ts).
// P2's endgame (ui/endgame.ts) has no Retire button mounted yet; whatever mounts it should call review.unlock()
// when the player retires. Until then, larp.review() in the console opens it.
const review = new ReviewGate();

// The phone's Mail inbox (sim/mail) and what the Money desk last reported; both ride in the save.
const mail = restored?.mail ?? new Inbox();
let desk: DeskState | null = saved?.desk ?? null;
// Sammy's tours the player finished or skipped (ui/tour.ts); they ride in the save too.
let tours: TourRecord = saved?.tours ?? {};

let shownTier = -1;
function syncHomeTier() {
  const tier = player.homeTier();
  if (tier !== shownTier) {
    if (shownTier !== -1) narrator.cue(tier > shownTier ? "home_up" : "home_down");
    shownTier = tier;
  }
  scene?.setHomeTier(tier);
}
// Desk decisions can change housing while the calendar is paused.
player.onEvents(events => {
  if (events.some(event => event.type === "home")) syncHomeTier();
});
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
  // The first crash offers the stocks tour, if the player never took it (it waits for the decision).
  if (events.some((e) => e.type === "bear_market")) guide.trigger("crash");
  syncHomeTier();
  hud.setPlayer(player.name, player.age, player.avatar);
  happiness.update(day);
  town.onDay(day);
  void bank.tick(day);
  void recorder.tick();
  // Save each new game month, so time-lapses and long idle play are kept too.
  if (clock.date.getDate() === 1) saver.request();
});

const [homeSprites, propertySigns] = await Promise.all([loadSpriteSet("common/home"), loadSpriteSet("common/property")]);

// Each request invalidates earlier loads before they can mount a scene or attach input listeners.
let cityLoadRevision = 0;

/** Display a city without moving the player's finances (also used after restoring a checkpoint). */
async function displayCity(next: StateInfo): Promise<void> {
  const revision = ++cityLoadRevision;
  scene?.destroy();
  // The ticker keeps firing while sprites load; never leave it pointing at a destroyed scene.
  scene = null;
  state = next;
  residents = buildResidents();
  const cityResidents = residents;
  const city = cityFor(next);
  // Keep saves consistent even if they flush before this city's network request finishes.
  history.replaceState(null, "", `#${next.abbr}`);
  npcCard.hide();
  const sprites = await loadSpriteSet(city.id);
  if (revision !== cityLoadRevision) return;
  scene = new CityScene(app, city, clock, LANDMARKS, sprites, undefined, cityResidents, homeSprites, propertySigns);
  scene.setHomeTier(player.homeTier());
  scene.onPick = (npc, sx, sy) => npcCard.show(npc, sx, sy);
  scene.onHomePick = tier => showHomePicker(tier);
  app.stage.addChild(scene.root);
  scene.resize(app.screen.width, app.screen.height);
}

const npcCard = new NpcCard(document.getElementById("npc")!, bankClient);

/** Most steps a time-lapse skip takes (at least 40 ms each), however far it goes. */
const SKIP_STEPS = 60;

function stopSkip(): void {
  // A time-lapse that was running is a lot of days to lose: save where it ended.
  if (skipTimer) saver.request();
  clearInterval(skipTimer);
  skipTimer = 0;
  clock.skipping = false;
}

/** Plays the days up to `target` as a time-lapse (the Calendar's "Skip to"); a decision on the way stops it there. */
function skipTo(target: number): void {
  // Not while Sammy's tour holds the clock.
  if (skipTimer || clock.held || target <= clock.day) return;
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
  if (!review.unlocked || day >= clock.day || day < timeline.firstDay) return;
  stopSkip();
  clock.speed = 0;
  timeline.rewindTo(day);
  clock.jumpTo(day);
  town.rewind(day);
  mail.rewind(day);
  bank.rewind(day);
  // The rewound game saves onto the forked run, so wait for the fork to answer (sim/record).
  void recorder
    .rewind(day)
    .catch(() => undefined)
    .then(() => saver.request());
  // The desk trims its own lists when it hears about the rewind; trim the city's copy of them too,
  // so a save before the desk reports again doesn't bring the discarded days back.
  if (desk) desk = trimDesk(desk, day);
  syncHomeTier();
  happiness.update(day);
  phone.rewound(day, player.log.filter((e) => e.day === day && player.needsDecision([e])));
}

function showHomePicker(tier?: number): void {
  // Calendar skips use their own interval and must stop before the modal pauses time.
  stopSkip();
  homePicker.show(tier);
}

const homePicker = new HomePicker({
  life: () => player,
  clock: () => clock,
  lots: () => scene?.homeLots ?? [],
  onChosen: tier => {
    syncHomeTier();
    scene?.setHomeTier(tier, true);
    saver.request();
  },
});
const hud = new Hud(document.getElementById("hud")!, {
  chooseHome: () => showHomePicker(),
  focusHome: () => scene?.focusHome(),
});
hud.setPlayer(player.name, player.age, player.avatar);

const happiness = mountHappinessMeter(document.getElementById("happiness")!, { life: player });

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

// The player's phone is the hub for market, goals, and the calendar
// (Stocks opens the Money desk; Goals opens the fast-forward; Calendar goes back and skips ahead).
const phone = new Phone({
  clock,
  player,
  recorder,
  openFastForward: () => fastForward.open(),
  skipTo,
  rewindTo,
  canGoBack: () => review.unlocked,
  openSlots: () => void openSlots({ current: slot, start: clock.start }),
  firstDay: () => timeline.firstDay,
  getWorld: () => ({ state, city: scene?.city ?? cityFor(state), status: scene?.status() ?? null }),
  changed: (d, o) => {
    desk = d;
    if (!o?.quiet) saver.request();
  },
  deskState: () => desk,
  mail,
  // A letter read is kept read.
  mailChanged: () => saver.request(),
  onAppOpen: (id) => guide.trigger(id),
  replayTour: (id) => guide.replay(id),
  newLife: async () => {
    // Stop saving first, and let a write already on its way answer, so nothing lands after the erase
    // and brings this life back.
    await saver.stop();
    // Played without saving there is no save to erase: the reload asks the server again, so the
    // player's real save comes back if the server does, or they get a fresh unsaved life.
    if (saving) {
      try {
        await saves.deleteSave();
      } catch (err) {
        // Nothing was erased: this life carries on, and saves again (the Calendar says so).
        saver.resume();
        throw err;
      }
    }
    // With the save gone, the same slot starts Sammy's setup for a new life.
    location.href = `${location.pathname}?slot=${slot}`;
  },
});

// Sammy's tours: stocks the first time the Stocks app opens, taxes the first time a return is ready.
const guide = new TourGuide({
  narrator,
  clock,
  phone,
  life: () => player,
  deskState: () => desk,
  record: () => tours,
  save: (r) => {
    tours = r;
    saver.request();
  },
});

// Letters for the Mail app (sim/mail). A rewind replays its days inside player.quietly(), which
// mutes this listener, so replayed days file no second letters; Inbox.rewind(day) already kept the
// letters through that day (rewindTo above).
const debtLookup: DebtLookup = (id) => {
  const d = player.book.debts.find((x) => x.id === id);
  return d ? { name: d.name, kind: d.kind } : { name: "Loan" };
};
player.onEvents((events) => {
  if (mail.add(events, debtLookup).length) phone.renderMail();
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
  build: () => encodeGame({ seed, day: clock.day, hash: location.hash.slice(1), bankRun, life: player, town, mail, desk, tours }),
  runId: () => recorder.runId,
  // ?intake=1 over an existing save overwrites it rather than conflicting with it.
  baseRev: me?.save?.rev ?? null,
  off: !saving,
  onStatus: (s) => {
    hud.setSave(s);
    if (s !== "conflict") return;
    stopSkip();
    clock.speed = 0;
    void showNotice({
      title: "Playing somewhere else",
      body: "This life is open in another tab, so this one stopped saving. Reload to carry on from there.",
      actions: ["Reload"],
    }).then(() => location.reload());
  },
});
// Played without saving: the HUD says so from the start.
hud.setSave(saver.status);
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

// Only California exists: a link or back/forward to another state's hash goes back to #CA.
window.addEventListener("hashchange", () => {
  if (location.hash !== `#${HOME.abbr}`) history.replaceState(null, "", `#${HOME.abbr}`);
});
await displayCity(state);
// Show the player's real home from the first frame, not the hero's default tier.
syncHomeTier();
// A choice a life event left unanswered (saved mid-decision, or a demo slot) opens the Money desk on it.
if (player.pendingChoices().length) phone.showDecision([]);
// ?slots=1 opens the save slot picker, for a judge's first visit.
if (params.get("slots") === "1") void openSlots({ current: slot, start: clock.start });

// The owl opens the story once per browser tab, or welcomes a returning player back.
const demoLife = demoState ? DEMOS.find((d) => d.id === demo) : undefined;
if (demoLife) narrator.speak(`A demo life: ${demoLife.title}. ${demoLife.pitch}`, "arrival");
else if (saved) narrator.speak(welcomeBackLine(player.job || null, clock.date), "arrival");
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

// A tour that was open when the page reloaded starts over.
guide.resume();

/** Advance the game by `seconds` of simulated frames and render once. Background tabs throttle rAF, so tests use this. */
function step(seconds: number) {
  for (let i = 0; i < seconds * 30; i++) {
    clock.update(1 / 30);
    scene?.update(1 / 30);
  }
  app.render();
  return scene?.status();
}

// Handy for testing from the console.
Object.assign(window, { larp: { app, clock, step, scene: () => scene, states: STATES, player, town, bank, recorder, phone, fastForward, narrator, saver, mail, tour: (id: "stocks" | "taxes") => guide.replay(id), review: () => review.unlock(), slots: () => openSlots({ current: slot, start: clock.start }) } });
