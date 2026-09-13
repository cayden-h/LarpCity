import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerLife, defaultAccounts, type LifeEvent, type Place } from '../src/sim/life/index.ts';
import { lifeFromIntake } from '../src/sim/life/intake.ts';
import { newBook, installment } from '../src/sim/debt/factory.ts';
import { isOpen, owed, payNow } from '../src/sim/debt/engine.ts';
import { MarketPath } from '../src/sim/market/index.ts';
import { LifeTimeline } from '../src/sim/rewind/index.ts';

const TX: Place = { abbr: 'TX', name: 'Texas', rpp: { all: 100, goods: 100, housing: 100 } };
const CA: Place = { abbr: 'CA', name: 'California', rpp: { all: 110, goods: 110, housing: 150 } };
const START = new Date(2026, 8, 11);
const cents = (n: number) => Math.round(n * 100) / 100;
function lifeFor(cash = 1_000_000, salary = 500_000) {
  const book = newBook({ debts: [], agi: salary, monthlyTakeHome: salary / 15, day: 0 });
  book.profile.score = 800;
  return new PlayerLife({ place: TX, day: 0, book, grossAnnual: salary, market: new MarketPath(3, START), cashRate: () => 0.04,
    accounts: defaultAccounts(0).map(a => ({ ...a, apy: 0, balance: a.id === 'savings' ? cash : 0 })) });
}
function advance(life: PlayerLife, to: number) {
  const events: LifeEvent[] = [];
  for (let d = life.today + 1; d <= to; d++) events.push(...life.onDay(d, life.market.dateOf(d)));
  return events;
}
function buy(life: PlayerLife, tier = 2, downPct: 0.035 | 0.1 | 0.2 = 0.2) {
  const result = life.chooseHome(tier, life.today, { downPct });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result;
}

test('intake anchors rent and starting tier; wealth alone never upgrades the home', () => {
  for (const [rent, tier] of [[0, 1], [1487, 1], [1488, 3]]) {
    const life = lifeFromIntake({ salary: 200_000, savings: 1_000_000, debt: 0, job: '', rent }, { place: TX, day: 0, market: new MarketPath() });
    assert.equal(life.homeTier(), tier);
    assert.equal(life.rent, rent);
    life.ledger.get('savings').balance = 10_000_000;
    assert.equal(life.homeTier(), tier);
    const rentBill = advance(life, 20).find(e => e.type === 'bill' && e.name === 'Rent');
    if (rent > 0) assert.ok(rentBill?.type === 'bill' && rentBill.amount === rent);
  }
});

test('purchase quotes are pure; buying opens the real secured loan and counts home equity', () => {
  const life = lifeFor();
  const before = life.toSave();
  const q = life.quoteHome(2);
  assert.deepEqual(life.toSave(), before);
  assert.equal(q.price, 252_700);
  assert.equal(q.cashNeeded, 58_904.8);
  assert.equal(q.pmi, 0);
  assert.equal(q.taxAndInsurance, 315.88);
  assert.ok(q.application && q.application.odds > 0);
  const r = buy(life);
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  assert.equal(loan.kind, 'mortgage');
  assert.equal(loan.secured, 'home');
  assert.equal(loan.balance, 202_160);
  assert.equal(loan.aprAnnual, q.application!.apr);
  assert.equal(life.cash(), 941_095.2);
  assert.equal(life.rent, 0);
  assert.equal(life.homeTier(), 2);
  assert.equal(life.netWorth(), 991_635.2);
  assert.equal(life.snapshot(0).netWorth, life.netWorth());
  assert.equal(life.log.at(-1), r.event);
  assert.equal(life.applications.length, 1);
  assert.equal(life.book.profile.inquiries.length, 1);
  const events = advance(life, 20);
  assert.ok(events.some(e => e.type === 'payment' && e.debtId === loan.id));
  assert.ok(!events.some(e => e.type === 'bill' && e.name === 'Rent'));
  assert.ok(events.some(e => e.type === 'bill' && e.name === 'Property tax and insurance' && e.amount === 315.88));
  assert.equal(life.monthlyExpenses(), cents(life.living + life.minimums() + 315.88));
});

for (const denial of ['cash', 'score', 'DTI', 'invalid'] as const) test(`${denial} denial leaves all life state and notifications unchanged`, () => {
  const life = lifeFor();
  buy(life);
  if (denial === 'cash') life.ledger.get('savings').balance = 0;
  if (denial === 'score') life.book.profile.score = 400;
  if (denial === 'DTI') life.grossAnnual = 10_000;
  let heard = 0;
  life.onEvents(() => heard++);
  const before = life.toSave();
  const result = life.chooseHome(denial === 'invalid' ? NaN : 5, life.today);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.length > 0);
  assert.deepEqual(life.toSave(), before);
  assert.equal(heard, 0);
});

test('upgrading counts sale proceeds and removes only the replaced mortgage from DTI', () => {
  const life = lifeFor(70_000, 120_000);
  buy(life);
  life.ledger.get('savings').balance = 60_000;
  const q = life.quoteHome(3, 0, { downPct: 0.1 });
  assert.equal(q.saleProceeds, 35_378);
  assert.equal(q.cashAvailable, 95_378);
  assert.ok(q.ok, q.reasons.join('; '));
  buy(life, 3, 0.1);
  assert.equal(life.book.debts.filter(isOpen).length, 1);
  assert.equal(new Set(life.book.debts.map(d => d.id)).size, 2);
  const newLoan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  assert.equal(newLoan.balance, 422_370);
  life.book.debts.push(installment({ id: 'car', kind: 'auto', name: 'Car', balance: 100_000, apr: 0.1, months: 12, day: 0 }));
  assert.ok(life.quoteHome(2).reasons.some(r => /debt-to-income/.test(r)));
});

test('selling to rent pays accrued interest, keeps other debts, and charges selling costs once', () => {
  const life = lifeFor();
  buy(life);
  advance(life, 12);
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  const expected = cents(life.cash() + 252_700 * 0.94 - owed(loan));
  assert.ok(life.chooseHome(1, life.today).ok);
  assert.equal(life.cash(), expected);
  assert.equal(loan.status, 'paid');
  assert.equal(owed(loan), 0);
  assert.equal(life.rent, 892);
  assert.equal(life.home.value, 0);
  const before = life.toSave();
  assert.equal(life.chooseHome(1, life.today).ok, false);
  assert.deepEqual(life.toSave(), before);
});

test('PMI is charged below 20 percent down and stops when the principal reaches 80 percent LTV', () => {
  const life = lifeFor();
  buy(life, 2, 0.1);
  assert.equal(life.housingBills().pmi, 94.76);
  const events = advance(life, 20);
  assert.ok(events.some(e => e.type === 'bill' && e.name === 'Mortgage insurance (PMI)' && e.amount > 0));
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  life.ledger.get('checking').balance = 50_000;
  payNow(life.book, loan.id, owed(loan) - 202_159, { day: life.today, date: life.market.dateOf(life.today), env: { cashRateAnnual: 0.04 }, wallet: life.ledger.wallet() });
  assert.equal(life.housingBills().pmi, 0);
});

test('two consecutive short rent months evict, a full month resets the streak, and renting recovers', () => {
  const life = lifeFor(0, 0);
  advance(life, 20);
  assert.equal(life.homeTier(), 1);
  life.ledger.get('checking').balance = 5_000;
  advance(life, 51);
  life.ledger.get('checking').balance = 0;
  advance(life, 81);
  assert.equal(life.homeTier(), 1);
  const saved = life.toSave();
  const restored = PlayerLife.fromSave(saved, { market: life.market, cashRate: () => 0.04 });
  const events = advance(life, 112);
  assert.deepEqual(advance(restored, 112), events);
  assert.equal(life.homeTier(), 0);
  assert.equal(life.rent, 0);
  assert.equal(events.filter(e => e.type === 'home' && e.reason === 'eviction').length, 1);
  assert.ok(life.chooseHome(1, life.today).ok);
  assert.equal(life.homeTier(), 1);
});

test('a mortgage unpaid for 120 days forecloses exactly once through actual daily ticks', () => {
  const life = lifeFor();
  buy(life);
  life.grossAnnual = 0;
  for (const a of life.ledger.accounts.values()) a.balance = 0;
  advance(life, 139);
  assert.equal(life.homeTier(), 2);
  const events = advance(life, 141);
  assert.equal(life.homeTier(), 0);
  assert.equal(events.filter(e => e.type === 'home' && e.reason === 'foreclosure').length, 1);
  assert.ok(!life.book.debts.some(d => isOpen(d) && d.secured === 'home'));
  assert.ok(!advance(life, 200).some(e => e.type === 'home'));
});

for (const chapter of [7, 13] as const) test(`chapter ${chapter} forces the tent without leaving a phantom mortgage, then allows recovery`, () => {
  const life = lifeFor();
  buy(life);
  life.fileBankruptcy(chapter, life.today);
  assert.equal(life.homeTier(), 0);
  assert.equal(life.rent, 0);
  assert.ok(!life.book.debts.some(d => isOpen(d) && d.secured === 'home'));
  assert.equal(life.log.filter(e => e.type === 'home' && e.reason === 'bankruptcy').length, 1);
  assert.ok(life.chooseHome(1, life.today).ok);
  advance(life, 2);
  assert.equal(life.homeTier(), 1);
});

test('moving state sells ownership and starts the destination studio at its own rent', () => {
  const life = lifeFor();
  buy(life);
  life.setPlace(CA, 0);
  assert.equal(life.cash(), 976_473.2);
  assert.equal(life.homeTier(), 1);
  assert.equal(life.rent, 1338);
  assert.equal(life.totalDebt(), 0);
  assert.equal(life.log.at(-2)!.type, 'moved');
  assert.equal(life.log.at(-1)!.type, 'home');
});

test('owned housing survives JSON save, detached simulation, and a thinned timeline rewind', () => {
  const life = lifeFor();
  const timeline = new LifeTimeline(life, { start: START, window: 5, maxGap: 10 });
  advance(life, 1);
  buy(life, 3, 0.1);
  advance(life, 30);
  const saved = life.toSave();
  const restored = PlayerLife.fromSave(JSON.parse(JSON.stringify(saved)), { market: life.market, cashRate: () => 0.04 });
  assert.deepEqual(restored.toSave(), saved);
  const copy = life.detached();
  advance(copy, 80);
  assert.deepEqual(life.toSave(), saved);
  assert.deepEqual(advance(restored, 80), advance(life, 80));
  const at80 = life.toSave();
  timeline.rewindTo(30);
  assert.deepEqual(life.toSave(), saved);
  advance(life, 80);
  assert.deepEqual(life.toSave(), at80);
  timeline.rewindTo(1);
  assert.equal(life.homeTier(), 1);
  assert.equal(life.book.debts.length, 0);
});

import { encodeGame, parseSave, restoreGame, SaveFormatError } from '../src/sim/save/codec.ts';
import { NpcTown } from '../src/sim/npcs/index.ts';
import { Inbox } from '../src/sim/mail/inbox.ts';
import { RunRecorder, type EventEntry, type SnapshotEntry } from '../src/sim/record/index.ts';

function gameSave(life: PlayerLife) {
  return encodeGame({ seed: life.market.seed, day: life.today, hash: '#TX', bankRun: 'housing', life,
    town: new NpcTown({ place: life.place, day: life.today, market: life.market, start: START }), mail: new Inbox(), desk: null });
}

test('the whole-game codec restores ownership and refuses malformed housing or a missing mortgage', () => {
  const life = lifeFor();
  buy(life, 2, 0.035);
  const save = gameSave(life);
  const options = { market: life.market, place: life.place, start: START, cashRate: () => 0.04 };
  const back = restoreGame(parseSave(JSON.parse(JSON.stringify(save))), options).life;
  assert.deepEqual(back.home, life.home);
  assert.equal(back.netWorth(), life.netWorth());
  assert.deepEqual(advance(back, 60), advance(life, 60));
  for (const corrupt of [
    (s: typeof save) => { s.life.home!.value = -1; },
    (s: typeof save) => { s.life.home!.tier = 1; },
    (s: typeof save) => { s.life.home!.mortgageId = 'missing'; },
    (s: typeof save) => { s.life.home!.missedRentMonths = NaN; },
    (s: typeof save) => { (s.life as unknown as { home: unknown }).home = null; },
  ]) {
    const invalid = structuredClone(save);
    corrupt(invalid);
    assert.throws(() => restoreGame(parseSave(invalid), options), SaveFormatError);
  }
});

test('older saves keep the rent anchor and derive a sensible starting rental tier', () => {
  const life = lifeFromIntake({ salary: 80_000, savings: 8000, debt: 0, job: '', rent: 1900 }, { place: TX, day: 0, market: new MarketPath() });
  const legacy = life.toSave();
  delete legacy.home;
  // An old move changed the place while retaining the original rent anchor.
  legacy.place = CA;
  const back = PlayerLife.fromSave(legacy, { market: life.market });
  assert.equal(back.rent, 2850);
  assert.equal(back.homeTier(), 3);
  const broke = structuredClone(legacy);
  broke.book.profile.bankruptcy = { day: 0, chapter: 7 };
  const tent = PlayerLife.fromSave(broke, { market: life.market });
  assert.equal(tent.homeTier(), 0);
  assert.equal(tent.rent, 0);
});

test('underwater voluntary sales are atomic and a forced state move retains the deficiency as real debt', () => {
  const life = lifeFor();
  buy(life, 2, 0.035);
  for (const a of life.ledger.accounts.values()) a.balance = 0;
  const before = life.toSave();
  const result = life.chooseHome(1);
  assert.equal(result.ok, false);
  assert.deepEqual(life.toSave(), before);
  life.setPlace(CA, 0);
  assert.equal(life.homeTier(), 1);
  assert.equal(life.home.value, 0);
  assert.equal(life.totalDebt(), 6317.5);
  const deficiency = life.book.debts.find(d => isOpen(d))!;
  assert.equal(deficiency.kind, 'personal');
  assert.equal(deficiency.secured, undefined);
  assert.ok(deficiency.scheduledPayment! > 0);
});

test('checking and savings fund a home, but brokerage and emergency money do not silently fund it', () => {
  const life = lifeFor(58_904.79);
  life.ledger.get('emergency').balance = 500_000;
  life.ledger.get('brokerage').balance = 500_000;
  assert.equal(life.chooseHome(2).ok, false);
  life.ledger.get('checking').balance = 0.01;
  buy(life);
  assert.equal(life.ledger.get('checking').balance, 0);
  assert.equal(life.ledger.get('savings').balance, 0);
  assert.equal(life.ledger.get('emergency').balance, 500_000);
  assert.equal(life.ledger.get('brokerage').balance, 500_000);
});

test('invalid days and down payments are denied without changing the life', () => {
  const life = lifeFor();
  const before = life.toSave();
  for (const day of [-1, 1, Infinity, NaN, 0.5]) assert.equal(life.chooseHome(2, day).ok, false);
  for (const downPct of [0, 1, -0.1, NaN, Infinity]) assert.equal(life.chooseHome(2, 0, { downPct: downPct as 0.2 }).ok, false);
  assert.deepEqual(life.toSave(), before);
});

test('a fully paid home retains value and taxes, without PMI or a phantom mortgage payment', () => {
  const life = lifeFor();
  buy(life, 2, 0.035);
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  payNow(life.book, loan.id, owed(loan), { day: 0, date: START, env: { cashRateAnnual: 0.04 }, wallet: life.ledger.wallet() });
  advance(life, 1);
  assert.equal(loan.status, 'paid');
  assert.equal(life.housingBills().pmi, 0);
  assert.equal(life.housingBills().taxAndInsurance, 315.88);
  assert.equal(life.monthlyExpenses(), 1265.88);
  const saved = life.toSave();
  assert.deepEqual(PlayerLife.fromSave(saved, { market: life.market }).home, life.home);
  assert.ok(life.chooseHome(1).ok);
});

test('home events and equity snapshots reach the existing recorder, with stable retry keys', async () => {
  const life = lifeFor();
  const events: EventEntry[] = [];
  const snapshots: SnapshotEntry[] = [];
  const recorder = new RunRecorder({ life, seed: 3, runId: 'housing', log: () => {}, fetchFn: (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/events')) events.push(...body.events);
    if (String(url).endsWith('/snapshot')) snapshots.push(...body.entries);
    return new Response('{}', { status: 200 });
  }) as typeof fetch });
  const choice = buy(life);
  await recorder.tick(true);
  assert.deepEqual(events.map(e => e.payload), [choice.event]);
  assert.equal(events[0].key, '0:0');
  assert.equal(snapshots.at(-1)!.netWorth, 991_635.2);
});

test('non-finite underwriting inputs cannot approve a mortgage or mutate the life', () => {
  for (const corrupt of [
    (l: PlayerLife) => { l.grossAnnual = NaN; },
    (l: PlayerLife) => { l.book.profile.score = NaN; },
    (l: PlayerLife) => { l.ledger.get('savings').balance = NaN; },
  ]) {
    const life = lifeFor();
    corrupt(life);
    const before = life.toSave();
    const q = life.quoteHome(2);
    assert.equal(q.ok, false);
    assert.ok(q.reasons.length > 0);
    assert.equal(life.chooseHome(2).ok, false);
    assert.deepEqual(life.toSave(), before);
  }
});

test('a same-state map visit keeps the lease or owned home intact', () => {
  const life = lifeFor();
  buy(life);
  const home = life.home;
  const cash = life.cash();
  const debt = life.totalDebt();
  life.setPlace({ ...TX }, 0);
  assert.deepEqual(life.home, home);
  assert.equal(life.cash(), cash);
  assert.equal(life.totalDebt(), debt);
  assert.equal(life.log.filter(e => e.type === 'home').length, 1);
});

test('foreclosure is a decision event and resuming a delinquent save preserves its exact loss day', () => {
  const life = lifeFor();
  buy(life);
  life.grossAnnual = 0;
  for (const a of life.ledger.accounts.values()) a.balance = 0;
  advance(life, 139);
  const back = PlayerLife.fromSave(life.toSave(), { market: life.market, cashRate: () => 0.04 });
  const loss = advance(life, 140);
  assert.deepEqual(advance(back, 140), loss);
  assert.ok(loss.some(e => e.type === 'home' && e.reason === 'foreclosure'));
  assert.ok(life.needsDecision(loss.filter(e => e.type === 'home')));
});

test('immediate same-day rewind undoes housing transactions without needing a later daily tick', () => {
  const life = lifeFor();
  const timeline = new LifeTimeline(life, { start: START });
  advance(life, 1);
  const morning = life.toSave();
  const firstPurchase = buy(life);
  assert.equal(life.today, 1);
  assert.equal(life.book.debts.length, 1);
  assert.ok(life.chooseHome(1).ok);
  assert.equal(life.book.debts[0].status, 'paid');
  assert.equal(life.log.filter(e => e.type === 'home').length, 2);
  timeline.rewindTo(1);
  assert.deepEqual(life.toSave(), morning);
  const replayPurchase = buy(life);
  assert.deepEqual(replayPurchase, firstPurchase);
  assert.equal(life.book.debts.length, 1);
  assert.equal(life.book.profile.inquiries.length, 1);
  timeline.rewindTo(1);
  assert.deepEqual(life.toSave(), morning);
});

import { isMet, netWorthOf, priceTag, viewOf } from '../src/sim/skip/goals.ts';
import { currentOrders, budget } from '../src/sim/skip/orders.ts';
import { runPreview } from '../src/sim/skip/preview.ts';
import { runSkip } from '../src/sim/skip/run.ts';
import { scheduleFor } from '../src/sim/calendar/schedule.ts';

test('buying preserves home value in Goals, preview percentiles, and immediate fast-forward completion', () => {
  const life = lifeFor();
  buy(life);
  const before = life.toSave();
  const goal = { kind: 'net_worth' as const, amount: 900_000 };
  assert.equal(life.netWorth(), 991_635.2);
  assert.equal(cents(netWorthOf(viewOf(life))), 991_635.2);
  assert.equal(isMet(goal, viewOf(life)), true);
  assert.equal(priceTag(goal, viewOf(life), 'Texas').progress, 1);
  const futures = [{ stock: new Float64Array([100, 100, 100]), bond: new Float64Array([100, 100, 100]) }];
  const preview = runPreview(life, currentOrders(life), goal, { futures, month: 0, capAge: life.age + 1 });
  for (const band of [preview.p10, preview.p50, preview.p90]) assert.equal(cents(band[0]), 991_635.2);
  assert.equal(preview.reached, 1);
  assert.equal(preview.reachTypical, 0);
  const nextGoal = { kind: 'net_worth' as const, amount: 1_000_000 };
  const later = runPreview(life, currentOrders(life), nextGoal, { futures, month: 0, capAge: life.age + 1 });
  assert.equal(later.reachTypical, 1);
  const laterSkip = runSkip(life.detached(), { goal: nextGoal, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(laterSkip.daysRun, 4);
  assert.ok(laterSkip.end.netWorth >= 1_000_000);
  const skipped = runSkip(life, { goal, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(skipped.stoppedBy, 'goal');
  assert.equal(skipped.daysRun, 0);
  assert.deepEqual(life.toSave(), before);
});

test('owner previews and budgets retain the asset and subtract taxes every projected month', () => {
  const life = lifeFor();
  buy(life);
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  payNow(life.book, loan.id, owed(loan), { day: 0, date: START, env: { cashRateAnnual: 0.04 }, wallet: life.ledger.wallet() });
  advance(life, 1);
  life.monthlyTakeHome = 0;
  const orders = currentOrders(life);
  const startWorth = life.netWorth();
  const futures = [{ stock: new Float64Array([100, 100, 100]), bond: new Float64Array([100, 100, 100]) }];
  const preview = runPreview(life, orders, { kind: 'net_worth', amount: 2_000_000 }, { futures, month: 0, capAge: life.age + 1 });
  assert.equal(cents(preview.p50[1]), cents(startWorth - 950 - 315.88));
  assert.equal(cents(preview.p50[2]), cents(startWorth - 2 * (950 + 315.88)));
  assert.equal(budget(life, orders).surplus, -1265.88);
});

for (const downPct of [0.2, 0.1] as const) test(`Calendar forecasts actual owner bills with ${downPct * 100}% down and no zero-dollar rent`, () => {
  const life = lifeFor();
  buy(life, 2, downPct);
  advance(life, 19);
  const before = life.toSave();
  const scheduled = scheduleFor(life, 20, life.market.dateOf(20));
  assert.deepEqual(life.toSave(), before);
  assert.equal(scheduled.some(m => m.chip === 'Rent'), false);
  assert.equal(scheduled.find(m => m.text === 'Property tax and insurance')?.amount, -315.88);
  assert.equal(scheduled.some(m => m.text === 'Mortgage insurance (PMI)'), downPct < 0.2);
  const actual = life.onDay(20, life.market.dateOf(20));
  for (const event of actual) if (event.type === 'bill') {
    assert.equal(scheduled.find(m => m.text === event.name)?.amount, -event.amount);
  }
  assert.equal(scheduleFor(life, 21, life.market.dateOf(21)).some(m => m.text === 'Property tax and insurance'), false);
});

test('Calendar omits rent for a tent and PMI for a paid-off home', () => {
  const life = lifeFor();
  buy(life, 2, 0.1);
  const loan = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  payNow(life.book, loan.id, owed(loan), { day: 0, date: START, env: { cashRateAnnual: 0.04 }, wallet: life.ledger.wallet() });
  advance(life, 1);
  const scheduled = scheduleFor(life, 20, life.market.dateOf(20));
  assert.ok(scheduled.some(m => m.text === 'Property tax and insurance'));
  assert.ok(!scheduled.some(m => m.text === 'Mortgage insurance (PMI)' || m.chip === 'Rent'));
  life.fileBankruptcy(7, life.today);
  const tent = scheduleFor(life, 20, life.market.dateOf(20));
  assert.ok(!tent.some(m => m.chip === 'Rent' || m.text === 'Property tax and insurance' || m.text === 'Mortgage insurance (PMI)'));
});

for (const payment of [NaN, Infinity, -Infinity]) test(`non-finite existing debt payment (${payment}) denies an upgrade atomically`, () => {
  const life = lifeFor();
  buy(life);
  const other = installment({ id: 'other', kind: 'personal', name: 'Other loan', balance: 1000, apr: 0.1, months: 24, day: 0 });
  other.scheduledPayment = payment;
  life.book.debts.push(other);
  let heard = 0;
  life.onEvents(() => heard++);
  // JSON would erase NaN, so compare the complete detached state instead.
  const before = life.detached();
  const history = structuredClone(life.history);
  const log = structuredClone(life.log);
  const quote = life.quoteHome(3);
  assert.equal(quote.ok, false);
  assert.ok(quote.reasons.length > 0);
  assert.equal(life.chooseHome(3).ok, false);
  assert.deepEqual(life.detached(), before);
  assert.deepEqual(life.history, history);
  assert.deepEqual(life.log, log);
  assert.equal(heard, 0);
});

import { project } from '../src/sim/debt/strategy.ts';

for (const extra of [0, 500]) test(`preview PMI cancels at mortgage 80 percent LTV with other debts and $${extra} extra payments`, () => {
  const life = lifeFor();
  buy(life, 2, 0.1);
  const mortgage = life.book.debts.find(d => d.id === life.home.mortgageId)!;
  // Another long-lived debt must not count toward mortgage LTV.
  life.book.debts.push(installment({ id: 'other-long-loan', kind: 'personal', name: 'Other loan', balance: 200_000, apr: 0.2, months: 360, day: 0 }));
  const before = life.toSave();
  // The higher-interest loan consumes the extra payments throughout this horizon.
  const orders = { ...currentOrders(life), debtStrategy: 'avalanche' as const, extraMonthly: extra };
  const horizon = 110;
  const futures = [{ stock: new Float64Array(horizon + 1).fill(100), bond: new Float64Array(horizon + 1).fill(100) }];
  const preview = runPreview(life, orders, { kind: 'net_worth', amount: 1e12 }, { futures, month: 0, capAge: life.age + 10 });
  const debt = project(life.book.debts, orders.debtStrategy, orders.extraMonthly);
  // Independent amortization formula: principal just after each monthly payment.
  const principal = (month: number) => mortgage.balance * (1 + mortgage.aprAnnual / 12) ** month
    - mortgage.scheduledPayment! * ((1 + mortgage.aprAnnual / 12) ** month - 1) / (mortgage.aprAnnual / 12);
  const cancelMonth = Array.from({ length: horizon }, (_, m) => m).find(m => principal(m) <= life.home.value * 0.8)!;
  assert.ok(cancelMonth > 0 && cancelMonth < horizon);
  assert.ok(principal(cancelMonth) > 0);
  assert.ok(debt.series[cancelMonth] > life.home.value * 0.8);
  // In a flat market, the cash cost is recoverable from net worth and debt changes.
  const housingCost = (month: number) => cents(life.monthlyTakeHome - life.living - life.minimums() - extra
    - (preview.p50[month] - preview.p50[month - 1]) - (debt.series[month] - debt.series[month - 1]));
  assert.equal(housingCost(cancelMonth), cents(315.88 + cents(principal(cancelMonth - 1) * 0.005 / 12)));
  assert.equal(housingCost(cancelMonth + 1), 315.88);
  assert.equal(housingCost(cancelMonth + 2), 315.88);
  assert.deepEqual(life.toSave(), before);
});
