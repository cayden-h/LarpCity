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
// boundaries. Importing all of main would boot Pixi, intake, and the save server.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const orchestration = main.slice(main.indexOf('let shownTier ='), main.indexOf('const npcCard ='))
  .replace(/const \[homeSprites, propertySigns\] = await Promise\.all\([^\n]+\);/, '');
const parsed = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const rewind = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rewindTo')!.getText(parsed);
const TX = { abbr: 'TX', name: 'Texas', cityId: 'houston', rpp: { all: 100, goods: 100, housing: 100 } };
const CA = { abbr: 'CA', name: 'California', cityId: 'san-francisco', rpp: { all: 110, goods: 110, housing: 150 } };

function setup() {
  const clock = new Clock();
  clock.speed = 0;
  const player = new PlayerLife({ place: TX, day: 0, market: new MarketPath(3, clock.start) });
  const timeline = new LifeTimeline(player, { start: clock.start });
  const pending: { id: string; resolve: (value: null) => void }[] = [];
  const mounted: FakeScene[] = [];
  class FakeScene {
    city: typeof TX;
    tier = -1;
    destroyed = false;
    root = this;
    constructor(_app: unknown, city: typeof TX) { this.city = city; }
    setHomeTier(tier: number) { this.tier = tier; }
    destroy() { this.destroyed = true; }
    resize() {}
  }
  const context = {
    clock, player, timeline, STATES: [TX, CA], state: TX, scene: null, residents: [],
    homeSprites: null, propertySigns: null, LANDMARKS: {}, CityScene: FakeScene,
    cityFor: (state: typeof TX) => ({ ...state, id: state.cityId }), buildResidents: () => [],
    loadSpriteSet: (id: string) => new Promise<null>(resolve => pending.push({ id, resolve })),
    narrator: { cue() {} }, saver: { request() {} }, npcCard: { hide() {}, show() {} },
    app: { stage: { addChild: (scene: FakeScene) => mounted.push(scene) }, screen: { width: 800, height: 600 } },
    history: { replaceState: (_a: unknown, _b: unknown, hash: string) => { context.location.hash = hash; } },
    location: { hash: '#TX' }, stopSkip() {}, showHomePicker() {},
    town: { onDay() {}, rewind() {} }, bank: { tick() {}, rewind() {} }, mail: { rewind() {} },
    recorder: { tick() {}, rewind: async () => {} }, desk: null,
    phone: { rewound() {}, showDecision() {} }, cueForEvents: () => null, trimDesk: (desk: unknown) => desk,
  };
  const script = ts.transpileModule(`${orchestration}\n${rewind}\n({ open, rewindTo, syncHomeTier, getScene: () => scene, getState: () => state });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handlers = runInNewContext(script, context) as {
    open(state: typeof TX): Promise<void>; rewindTo(day: number): void; syncHomeTier(): void;
    getScene(): FakeScene | null; getState(): typeof TX;
  };
  return { ...handlers, player, clock, timeline, pending, mounted, context };
}
async function initial(h: ReturnType<typeof setup>) {
  const loading = h.open(TX);
  h.pending.shift()!.resolve(null);
  await loading;
  h.syncHomeTier();
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('paused bankruptcy immediately changes visible occupancy without advancing time', async () => {
  const h = setup();
  await initial(h);
  h.player.fileBankruptcy(7, 0);
  assert.equal(h.player.homeTier(), 0);
  assert.equal(h.getScene()!.tier, 0);
  assert.equal(h.clock.speed, 0);
  assert.equal(h.clock.day, 0);
});

test('rewind across a move restores city and hash without applying another housing move', async () => {
  const h = setup();
  await initial(h);
  const before = h.player.toSave();
  const moving = h.open(CA);
  h.pending.shift()!.resolve(null);
  await moving;
  h.clock.advanceDays(1);
  h.player.setPlace = () => { throw new Error("rewind must not invoke a financial move"); };
  h.rewindTo(0);
  assert.equal(h.player.place.abbr, 'TX');
  assert.equal(h.getState().abbr, 'TX');
  assert.equal(h.context.location.hash, '#TX');
  assert.equal(h.pending[0]?.id, 'houston');
  h.pending.shift()!.resolve(null);
  await settle();
  assert.equal(h.getScene()!.city.abbr, 'TX');
  assert.equal(h.getScene()!.tier, h.player.homeTier());
  assert.deepEqual(h.player.toSave(), before);
  assert.equal(h.clock.speed, 0);
});

test('out-of-order city loads mount only the latest requested city', async () => {
  const h = setup();
  await initial(h);
  const first = h.open(CA);
  const second = h.open(TX);
  const [ca, tx] = h.pending.splice(0);
  tx.resolve(null);
  await second;
  const current = h.getScene();
  ca.resolve(null);
  await first;
  assert.equal(h.getScene(), current);
  assert.equal(h.context.location.hash, '#TX');
  assert.equal(h.mounted.filter(scene => !scene.destroyed).length, 1);
});

test('rewind supersedes an unfinished state load', async () => {
  const h = setup();
  await initial(h);
  const moving = h.open(CA);
  h.clock.advanceDays(1);
  h.rewindTo(0);
  const [ca, tx] = h.pending.splice(0);
  assert.equal(tx?.id, 'houston');
  ca.resolve(null);
  await moving;
  assert.equal(h.getScene(), null);
  tx.resolve(null);
  await settle();
  assert.equal(h.getScene()!.city.abbr, 'TX');
  assert.equal(h.context.location.hash, '#TX');
});


test('a home change during a sprite fetch is reflected when the city mounts', async () => {
  const h = setup();
  await initial(h);
  const moving = h.open(CA);
  assert.equal(h.context.location.hash, '#CA');
  h.player.fileBankruptcy(7, 0);
  h.pending.shift()!.resolve(null);
  await moving;
  assert.equal(h.getScene()!.tier, 0);
  assert.equal(h.clock.speed, 0);
});

test('visiting another city in the same state does not reset the housing lease', async () => {
  const h = setup();
  await initial(h);
  const before = h.player.toSave();
  const moving = h.open({ ...TX, cityId: 'dallas' });
  assert.equal(h.context.location.hash, '#dallas');
  h.pending.shift()!.resolve(null);
  await moving;
  assert.deepEqual(h.player.toSave(), before);
  assert.equal(h.getScene()!.city.cityId, 'dallas');
});
