import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { Clock } from '../src/engine/clock.ts';
import { PlayerLife } from '../src/sim/life/player.ts';
import { MarketPath } from '../src/sim/market/index.ts';
import { LifeTimeline } from '../src/sim/rewind/index.ts';

// Run production orchestration with real simulation state, replacing browser/render/network
// boundaries. Importing all of main would boot Pixi, the title screen, and the save server.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const orchestration = main.slice(main.indexOf('let shownTier ='), main.indexOf('const npcCard ='))
  .replace(/const \[homeSprites, propertySigns\] = await Promise\.all\([^\n]+\);/, '');
const parsed = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const rewind = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rewindTo')!.getText(parsed);
// San Francisco, California is the only place (a state hash like #TX falls back to #CA).
const CA = { abbr: 'CA', name: 'California', cityId: 'san-francisco', rpp: { all: 110, goods: 110, housing: 150 } };

function setup() {
  const clock = new Clock();
  clock.speed = 0;
  const player = new PlayerLife({ place: CA, day: 0, market: new MarketPath(3, clock.start) });
  const timeline = new LifeTimeline(player, { start: clock.start });
  const pending: { id: string; resolve: (value: null) => void }[] = [];
  const mounted: FakeScene[] = [];
  class FakeScene {
    city: typeof CA;
    tier = -1;
    destroyed = false;
    root = this;
    constructor(_app: unknown, city: typeof CA) { this.city = city; }
    setHomeTier(tier: number) { this.tier = tier; }
    destroy() { this.destroyed = true; }
    resize() {}
  }
  const context = {
    clock, player, timeline, state: CA, scene: null, residents: [],
    homeSprites: null, propertySigns: null, LANDMARKS: {}, CityScene: FakeScene,
    cityFor: (state: typeof CA) => ({ ...state, id: state.cityId }), buildResidents: () => [],
    loadSpriteSet: (id: string) => new Promise<null>(resolve => pending.push({ id, resolve })),
    narrator: { cue() {} }, saver: { request() {} }, npcCard: { hide() {}, show() {} },
    hud: { setPlayer() {} }, happiness: { update() {} },
    app: { stage: { addChild: (scene: FakeScene) => mounted.push(scene) }, screen: { width: 800, height: 600 } },
    history: { replaceState: (_a: unknown, _b: unknown, hash: string) => { context.location.hash = hash; } },
    location: { hash: '#TX' }, stopSkip() {}, showHomePicker() {},
    town: { onDay() {}, rewind() {} }, bank: { tick() {}, rewind() {} }, mail: { rewind() {} },
    recorder: { tick() {}, rewind: async () => {} }, desk: null,
    // Going back only opens in the retirement review (sim/rewind/gate.ts); these tests are about going back itself.
    review: { unlocked: true },
    phone: { rewound() {}, showDecision() {} }, cueForEvents: () => null, trimDesk: (desk: unknown) => desk,
  };
  const script = ts.transpileModule(`${orchestration}\n${rewind}\n({ displayCity, rewindTo, syncHomeTier, getScene: () => scene, getState: () => state });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handlers = runInNewContext(script, context) as {
    displayCity(state: typeof CA): Promise<void>; rewindTo(day: number): void; syncHomeTier(): void;
    getScene(): FakeScene | null; getState(): typeof CA;
  };
  return { ...handlers, player, clock, timeline, pending, mounted, context };
}
async function initial(h: ReturnType<typeof setup>) {
  const loading = h.displayCity(CA);
  h.pending.shift()!.resolve(null);
  await loading;
  h.syncHomeTier();
}

test('showing the city writes #CA over any other hash', async () => {
  const h = setup();
  await initial(h);
  assert.equal(h.context.location.hash, '#CA');
  assert.equal(h.getScene()!.city.abbr, 'CA');
});

test('paused bankruptcy immediately changes visible occupancy without advancing time', async () => {
  const h = setup();
  await initial(h);
  h.player.fileBankruptcy(7, 0);
  assert.equal(h.player.homeTier(), 0);
  assert.equal(h.getScene()!.tier, 0);
  assert.equal(h.clock.speed, 0);
  assert.equal(h.clock.day, 0);
});

test('going back stays in California, never moves the player, and pauses time', async () => {
  const h = setup();
  await initial(h);
  const before = h.player.toSave();
  h.clock.advanceDays(1);
  h.player.setPlace = () => { throw new Error("rewind must not invoke a financial move"); };
  h.rewindTo(0);
  assert.equal(h.player.place.abbr, 'CA');
  assert.equal(h.getState().abbr, 'CA');
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.player.toSave(), before);
  assert.equal(h.clock.speed, 0);
});

test('out-of-order city loads mount only the latest requested one', async () => {
  const h = setup();
  await initial(h);
  const first = h.displayCity(CA);
  const second = h.displayCity(CA);
  const [older, newer] = h.pending.splice(0);
  newer.resolve(null);
  await second;
  const current = h.getScene();
  older.resolve(null);
  await first;
  assert.equal(h.getScene(), current);
  assert.equal(h.mounted.filter(scene => !scene.destroyed).length, 1);
});

test('a home change during a sprite fetch is reflected when the city mounts', async () => {
  const h = setup();
  await initial(h);
  const loading = h.displayCity(CA);
  h.player.fileBankruptcy(7, 0);
  h.pending.shift()!.resolve(null);
  await loading;
  assert.equal(h.getScene()!.tier, 0);
  assert.equal(h.clock.speed, 0);
});
