// Save and restore: every stateful sim piece encodes to plain JSON and comes
// back identical, and a restored life plays on exactly like one never saved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/twins.ts";
import { Ledger } from "../src/sim/money/accounts.ts";
import { CrashWatch } from "../src/sim/skip/crash.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, SAVE_DAILY_DAYS, STARTER_PORTFOLIO, compactHistory, type LifeEvent, type LifeSnapshot, type Place } from "../src/sim/life/index.ts";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import { applyOrders } from "../src/sim/skip/orders.ts";
import { NpcTown } from "../src/sim/npcs/index.ts";
import { LifeTimeline, serialize } from "../src/sim/rewind/index.ts";
import { applyForCard, openCard, recordApplication, type ApplicationResult } from "../src/sim/money/index.ts";
import { cardOffer } from "../src/debt-demo/shop-value.ts";
import { CURATED } from "../src/data/cards-curated.ts";
import { encodeGame, parseSave, restoreGame, SAVE_VERSION, SaveFormatError } from "../src/sim/save/codec.ts";
import type { DeskState } from "../src/sim/save/types.ts";
import { Inbox } from "../src/sim/mail/inbox.ts";

const START = new Date(2026, 8, 11);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("twins round-trip through JSON", () => {
  const market = new MarketPath(3, START);
  const t = new Twins(market);
  t.seedHolding("LTM", 10, 0);
  t.buy("NNST", 500, 20);
  t.sell(120);
  t.buy("LTM", 300, 60);
  const back = Twins.fromSave(json(t.toSave()), market);
  assert.deepEqual(back.toSave(), t.toSave());
  assert.equal(back.held(400), t.held(400));
  assert.equal(back.autopilot(400), t.autopilot(400));
});

test("a ledger round-trips with a pending transfer and keeps numbering transfers", () => {
  const l = new Ledger([
    { id: "checking", kind: "checking", name: "Checking", balance: 1000, apy: 0, openedDay: 0 },
    { id: "savings", kind: "savings", name: "Savings", balance: 0, apy: 0.04, openedDay: 0 },
  ]);
  const ctx = { day: 5, date: new Date(2026, 8, 16), age: 27 };
  l.transfer("checking", "savings", 100, "ach", ctx);
  const back = Ledger.fromSave(json(l.toSave()));
  assert.deepEqual(back.toSave(), l.toSave());
  const a = l.transfer("checking", "savings", 50, "internal", ctx);
  const b = back.transfer("checking", "savings", 50, "internal", ctx);
  assert.equal(b.id, a.id);
  assert.deepEqual(back.toSave(), l.toSave());
});

test("the crash watch keeps its private recovery count", () => {
  const c = new CrashWatch();
  c.update(100, "sell_all");
  c.update(70, "sell_all"); // sells
  c.update(101, "sell_all"); // recovered, month 0
  const back = CrashWatch.fromSave(json(c.toSave()));
  assert.deepEqual(back.toSave(), c.toSave());
  assert.equal(back.update(102, "sell_all"), c.update(102, "sell_all"));
});

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

/** Applies for a curated card the way the Card Shop does: the life's own application history, then the card on approval. */
function applyCard(life: PlayerLife, slug: string, day: number, roll: number): ApplicationResult {
  const card = CURATED.find((c) => c.slug === slug)!;
  const applicant = { age: life.age, annualIncome: 200_000, monthlyDebtPayments: life.minimums(), monthlyHousing: life.rent };
  const r = applyForCard({ product: card.terms, applicant, book: life.book, offer: cardOffer(card), history: life.applications, day, roll });
  recordApplication(life.book, life.applications, r, day, { issuerKey: card.terms.issuerKey, productId: card.tccpId, bonusCardId: card.slug });
  if (r.decision === "approved") openCard(life.book, card.terms, r, day, `card-${card.slug}-${day}`).name = card.name;
  return r;
}

/** A day inside the ACH transfer's settlement window, so a save carries it pending. */
const ACH_DAY = 100;

/** The player's choices, on fixed days, the same for the saved and the unsaved life. */
function decide(life: PlayerLife, day: number): void {
  if (day === 20) life.buy("LTM", 300, day);
  if (day === 30) applyCard(life, "capital-one-quicksilver", day, 0);
  if (day === 35) {
    // Move part of an older card's balance onto the new card.
    const to = life.book.debts.find((d) => d.id === "card-capital-one-quicksilver-30");
    const from = life.book.debts.find((d) => d.kind === "credit_card" && d !== to && d.balance > 100);
    if (to && from) life.ledger.balanceTransfer(from, to, Math.min(500, Math.floor(from.balance / 2)), day);
  }
  if (day === 45)
    applyOrders(life, { depositMonthly: 400, k401Pct: 0.06, stockPct: 0.9, debtStrategy: "avalanche", extraMonthly: 100, emergencyMonths: 3, lifestyle: "normal", crashRule: "sell_half" });
  if (day === 200) life.sell("NNST", "all", day);
  if (day === ACH_DAY) {
    const ctx = { day, date: dateOf(day), age: life.age };
    if (life.ledger.quote("checking", "savings", 100, "ach", ctx).ok) life.ledger.transfer("checking", "savings", 100, "ach", ctx);
  }
  if (day === 260) {
    const ctx = { day, date: dateOf(day), age: life.age };
    if (life.ledger.quote("savings", "checking", 200, "internal", ctx).ok) life.ledger.transfer("savings", "checking", 200, "internal", ctx);
  }
  if (day === 300) life.setEmployed(false, day);
  if (day === 420) life.setEmployed(true, day);
  if (day === 500) life.setPlace(CA, day);
  if (day === 600) life.book.extraMonthly = 200;
}

function play(life: PlayerLife, from: number, to: number): LifeEvent[] {
  const all: LifeEvent[] = [];
  life.onEvents((events) => all.push(...events));
  for (let day = from + 1; day <= to; day++) {
    life.onDay(day, dateOf(day));
    decide(life, day);
  }
  return all;
}

const LIVES: [string, (market: MarketPath) => PlayerLife][] = [
  ["sample household", (market) => new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO })],
  [
    "intake life",
    (market) =>
      lifeFromIntake({ job: "Nurse", salary: 72_000, rent: 1_400, debt: 15_000, savings: 3_000 }, { place: TX, day: 0, market, holdings: STARTER_PORTFOLIO }),
  ],
];
const END = 900;

for (const seed of [5, 20260912]) {
  for (const [name, make] of LIVES) {
    for (const saveDay of [1, 44, ACH_DAY, 301, 777]) {
      test(`${name}, seed ${seed}, saved on day ${saveDay}, plays on exactly like one never saved`, () => {
        const control = make(new MarketPath(seed, START));
        const controlEvents = play(control, 0, END).filter((e) => e.day > saveDay);

        const before = make(new MarketPath(seed, START));
        play(before, 0, saveDay);
        if (saveDay === ACH_DAY) assert.ok(before.ledger.pending.length > 0, "the ACH transfer is still pending at the save");
        if (saveDay >= 30) assert.ok(before.applications.length > 0 && before.book.debts.some((d) => d.id === "card-capital-one-quicksilver-30"), "the new card crosses the save");
        const restored = PlayerLife.fromSave(json(before.toSave()), { market: new MarketPath(seed, START) });
        const restoredEvents = play(restored, saveDay, END);

        assert.deepEqual(restoredEvents, controlEvents);
        assert.deepEqual(restored.toSave(), control.toSave());
        assert.equal(restored.netWorth(), control.netWorth());
        // The calendar and the recorder's fork read the log: the days after the save match, and the saved days came along.
        assert.deepEqual(restored.log.filter((e) => e.day > saveDay), control.log.filter((e) => e.day > saveDay));
        assert.deepEqual(restored.log.filter((e) => e.day <= saveDay), json(before.log.filter((e) => e.day > saveDay - SAVE_DAILY_DAYS)));
      });
    }
  }
}

test("saved history is daily for the recent past and weekly before it", () => {
  const snaps = Array.from({ length: 1000 }, (_, day) => ({ day }) as LifeSnapshot);
  const kept = compactHistory(snaps, 999, 400).map((s) => s.day);
  assert.ok(kept.includes(600) && kept.includes(999));
  assert.ok(kept.includes(0) && kept.includes(7) && !kept.includes(8));
  assert.equal(kept.length, 400 + Math.floor(599 / 7) + 1);
});

test("a restored life keeps its home state's rent after a move", () => {
  const life = new PlayerLife({ place: TX, day: 0, rent: 1_000 });
  life.setPlace(CA, 3);
  const back = PlayerLife.fromSave(json(life.toSave()), { market: new MarketPath() });
  assert.equal(back.rent, life.rent);
  assert.equal(back.place.abbr, "CA");
});

test("the NPC town restores and keeps living like one never saved", () => {
  const make = (saved?: ReturnType<NpcTown["toSave"]>) => new NpcTown({ place: TX, day: 0, market: new MarketPath(9, START), start: START, saved });
  const control = make();
  for (let d = 1; d <= 120; d++) control.onDay(d);
  const before = make();
  for (let d = 1; d <= 60; d++) before.onDay(d);
  const restored = make(json(before.toSave()));
  for (let d = 61; d <= 120; d++) restored.onDay(d);
  assert.deepEqual(restored.toSave(), control.toSave());
});

test("a saved log keeps the same recent days as the saved history", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  play(life, 0, 500);
  const save = life.toSave(100);
  assert.ok(save.log.length > 0);
  assert.ok(save.log.every((e) => e.day > 400));
  assert.deepEqual(save.log, json(life.log.filter((e) => e.day > 400)));
});

test("a restored life has exactly the fields of a fresh one, so rewind copies it whole", () => {
  const fresh = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  play(fresh, 0, 30);
  const restored = PlayerLife.fromSave(json(fresh.toSave()), { market: new MarketPath(5, START) });
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(fresh).sort());
});

for (const [name, make] of LIVES) {
  test(`${name}: a restored life rewinds on its timeline exactly like one never saved`, () => {
    const seed = 20260912;
    const control = make(new MarketPath(seed, START));
    const controlLine = new LifeTimeline(control, { start: START });
    play(control, 0, 320);

    const before = make(new MarketPath(seed, START));
    play(before, 0, 250);
    const restored = PlayerLife.fromSave(json(before.toSave()), { market: new MarketPath(seed, START) });
    const restoredLine = new LifeTimeline(restored, { start: START });
    play(restored, 250, 320);

    // Back to before the unemployment on day 300, then a different life from there.
    controlLine.rewindTo(270);
    restoredLine.rewindTo(270);
    assert.equal(restored.today, 270);
    assert.equal(serialize(restored.detached()), serialize(control.detached()));
    assert.deepEqual(restored.toSave(), control.toSave());
    for (const life of [control, restored]) {
      for (let day = 271; day <= 330; day++) {
        life.onDay(day, dateOf(day));
        if (day === 280) life.buy("LTM", 150, day);
      }
    }
    assert.deepEqual(restored.toSave(), control.toSave());
  });
}

test("a restored NPC town rewinds like one never saved", () => {
  const make = (saved?: ReturnType<NpcTown["toSave"]>) => new NpcTown({ place: TX, day: 0, market: new MarketPath(9, START), start: START, saved });
  const control = make();
  for (let d = 1; d <= 120; d++) control.onDay(d);
  const before = make();
  for (let d = 1; d <= 60; d++) before.onDay(d);
  const restored = make(json(before.toSave()));
  for (let d = 61; d <= 120; d++) restored.onDay(d);
  control.rewind(90);
  restored.rewind(90);
  for (const life of restored.lives.values()) assert.equal(life.today, 90);
  assert.deepEqual(restored.toSave(), control.toSave());
  for (let d = 91; d <= 110; d++) {
    control.onDay(d);
    restored.onDay(d);
  }
  assert.deepEqual(restored.toSave(), control.toSave());
});

/** Plain days, with none of `decide`'s choices. */
function tick(life: PlayerLife, from: number, to: number): void {
  for (let day = from + 1; day <= to; day++) life.onDay(day, dateOf(day));
}

test("card applications survive a save, so the issuer rules and sign-up bonuses still remember them", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  tick(life, 0, 10);
  assert.equal(applyCard(life, "capital-one-quicksilver", 10, 0).decision, "approved");
  assert.equal(applyCard(life, "amex-blue-cash-everyday", 10, 0).decision, "approved");
  const back = PlayerLife.fromSave(json(life.toSave()), { market: new MarketPath(5, START) });
  assert.deepEqual(back.applications, json(life.applications));
  // Capital One approves about one card every 6 months.
  const again = applyCard(back, "capital-one-venture", 40, 0);
  assert.equal(again.decision, "denied");
  assert.match(again.reasons.join(" "), /Capital One/);
  // Amex pays a card's sign-up bonus once per lifetime.
  assert.equal(applyCard(back, "amex-blue-cash-everyday", 400, 0).bonusEligible, false);
});

test("a whole game encodes, survives JSON, and parses back", () => {
  const market = new MarketPath(11, START);
  const life = new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO });
  const town = new NpcTown({ place: TX, day: 0, market, start: START });
  const mail = new Inbox();
  const save = encodeGame({ seed: 11, day: 0, hash: "TX", bankRun: "11-abc", life, town, mail, desk: null });
  assert.equal(save.version, SAVE_VERSION);
  const back = parseSave(json(save));
  assert.deepEqual(back, save);
});

test("a save from an unknown version or with no life is refused, not half-loaded", () => {
  assert.throws(() => parseSave({ version: SAVE_VERSION + 1, seed: 1, day: 0, life: {} }), SaveFormatError);
  assert.throws(() => parseSave({ version: SAVE_VERSION, seed: 1, day: 0 }), SaveFormatError);
  assert.throws(() => parseSave("nope"), SaveFormatError);
});

test("a rewind to before a card application forgets it", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  const line = new LifeTimeline(life, { start: START });
  tick(life, 0, 60);
  assert.equal(applyCard(life, "capital-one-quicksilver", 60, 0).decision, "approved");
  tick(life, 60, 80);
  assert.equal(life.applications.length, 1);
  line.rewindTo(55);
  assert.deepEqual(life.applications, []);
  assert.equal(applyCard(life, "capital-one-venture", 56, 0).decision, "approved");
});

test("a save whose life doesn't decode is refused whole", () => {
  const market = new MarketPath(11, START);
  const save = parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: {} });
  assert.throws(() => restoreGame(save, { market, place: TX, start: START }), SaveFormatError);
});

test("a save with a broken inbox parses to an empty one", () => {
  const save = parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, mail: {} });
  assert.deepEqual(save.mail.items, []);
  assert.equal(save.mail.seq, 0);
  const noSeq = parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, mail: { items: [{ id: "m7", day: 1 }] } });
  assert.equal(noSeq.mail.seq, 7);
});

test("a pay stub with a non-finite takeHome doesn't survive the save", () => {
  const withPay = (lastPay: unknown) => parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, mail: { items: [], seq: 0, lastPay } }).mail.lastPay;
  assert.deepEqual(withPay({ takeHome: 2000, garnished: false, unemployed: false }), { takeHome: 2000, garnished: false, unemployed: false });
  assert.equal(withPay({ takeHome: NaN, garnished: false, unemployed: false }), null);
  assert.equal(withPay({ takeHome: Infinity, garnished: false, unemployed: false }), null);
  assert.equal(withPay({ garnished: false, unemployed: false }), null, "missing takeHome");
  assert.equal(withPay({ takeHome: "2000" }), null, "takeHome not a number");
  assert.equal(withPay(null), null);
});

test("a desk whose lists aren't lists is dropped; the game still loads", () => {
  assert.equal(parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, desk: { feed: 5 } }).desk, null);
  assert.equal(parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, desk: { feed: [], bank: {} } }).desk, null);
  const old = parseSave({ version: SAVE_VERSION, seed: 11, day: 5, life: { x: 1 }, desk: { feed: [], bank: [], crash: null, recovery: null } });
  assert.equal(old.desk!.recap, null, "a desk saved before the recap field reads it as none");
});

test("a whole game on a later day restores through JSON with its letters, NPC lives, and desk", () => {
  const seed = 11;
  const market = new MarketPath(seed, START);
  const life = new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO });
  const town = new NpcTown({ place: TX, day: 0, market, start: START });
  const mail = new Inbox();
  const lookup = (id: string) => {
    const d = life.book.debts.find((x) => x.id === id);
    return { name: d?.name ?? "A debt", kind: d?.kind };
  };
  life.onEvents((events) => mail.add(events, lookup));
  const DAY = 320;
  play(life, 0, DAY);
  for (let d = 1; d <= DAY; d++) town.onDay(d);
  assert.ok(mail.items.length > 0, "the life sent letters");
  mail.markRead(mail.items[0].id);
  const desk: DeskState = {
    feed: [{ day: 300, text: "Laid off", tone: "down" }],
    bank: [{ day: 301, name: "Rent", category: "Housing", icon: "home", amount: 1200, kind: "out" }],
    crash: { day: 200, drop: 0.22, choice: "hold" },
    recovery: { day: 310, you: 5000, held: 5100, autopilot: 5300 },
    recap: { headline: "Holding paid off", lesson: "Selling in a crash locks in the loss." },
  };
  const save = encodeGame({ seed, day: DAY, hash: "TX", bankRun: "11-abc", life, town, mail, desk });
  const parsed = parseSave(json(save));
  assert.deepEqual(parsed, json(save));
  const back = restoreGame(parsed, { market: new MarketPath(seed, START), place: TX, start: START });
  assert.equal(back.life.today, DAY);
  assert.equal(back.life.netWorth(), life.netWorth());
  assert.deepEqual(back.life.toSave(), life.toSave());
  assert.deepEqual(back.town.toSave(), town.toSave());
  assert.deepEqual(back.mail.toSave(), mail.toSave());
  assert.deepEqual(parsed.desk, desk);
});

import { trimDesk } from "../src/sim/save/desk.ts";

test("a rewind trims the city's copy of the desk to the morning of the day", () => {
  const desk: DeskState = {
    feed: [
      { day: 10, text: "Paid rent", tone: "down" },
      { day: 20, text: "Laid off", tone: "down" },
    ],
    bank: [
      { day: 19, name: "Rent", category: "Housing", icon: "home", amount: 1200, kind: "out" },
      { day: 20, name: "Pay", category: "Income", icon: "cash", amount: 2000, kind: "in" },
    ],
    crash: { day: 15, drop: 0.22, choice: "hold" },
    recovery: { day: 25, you: 5000, held: 5100, autopilot: 5300 },
    recap: { headline: "Holding paid off", lesson: "Selling in a crash locks in the loss." },
  };
  const at20 = trimDesk(desk, 20);
  assert.deepEqual(at20.feed.map((f) => f.day), [10]);
  assert.deepEqual(at20.bank.map((t) => t.day), [19]);
  assert.deepEqual(at20.crash, desk.crash);
  assert.equal(at20.recovery, null);
  assert.equal(at20.recap, null);
  const at15 = trimDesk(desk, 15);
  assert.equal(at15.crash, null);
  assert.deepEqual(trimDesk(desk, 30), desk);
  assert.equal(desk.feed.length, 2, "the original is left alone");
});
