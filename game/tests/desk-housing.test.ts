import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { PlayerLife, defaultAccounts } from '../src/sim/life/index.ts';
import { creditCard, newBook } from '../src/sim/debt/factory.ts';
import { isOpen, owed } from '../src/sim/debt/engine.ts';
import type { HomeEvent } from '../src/sim/life/homes.ts';

// Execute the shipped desk handlers without booting its DOM, network, or save client.
const source = readFileSync(new URL('../src/debt-demo/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('desk.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['onLifeEvents', 'nextMove', 'cardsPage', 'upcoming', 'openDecision', 'closeDecision',
  'showParkedDecisions', 'askBankruptcy', 'monthlyHousingBills', 'housingReserve', 'cashAfterHousing',
  'isHousingLoss', 'homeLossDescription', 'queueHomeLoss', 'showNextHomeLoss', 'askHomeLoss']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name!.text)).map(n => n.getText(ast));
const click = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(ast) === 'app.addEventListener' && n.expression.arguments[0]?.getText(ast) === '"click"')!;

function person(owner = true) {
  const book = newBook({ debts: [], agi: 500_000, monthlyTakeHome: 30_000, day: 0 });
  book.profile.score = 800;
  const life = new PlayerLife({ place: { abbr: 'TX', name: 'Texas', rpp: { all: 100, goods: 100, housing: 100 } },
    day: 0, book, grossAnnual: 500_000, rent: 1_200, cashRate: () => 0.04,
    accounts: defaultAccounts(0).map(a => ({ ...a, balance: a.id === 'savings' ? 1_000_000 : 0 })) });
  if (owner) assert.ok(life.chooseHome(2, 0, { downPct: 0.1 }).ok);
  return life;
}

function desk(life: PlayerLife, hosted = true) {
  const feed: string[] = [], bank: any[] = [], parked: HomeEvent[] = [];
  let clickHandler: (event: unknown) => void;
  const c: Record<string, any> = {
    life, isOpen, owed, decision: null, resumeSpeed: 2, reportingRewind: false,
    pendingHomeLosses: [], handledHomeLosses: new Set(),
    clock: { day: life.today, start: life.market.dateOf(0), speed: hosted ? 0 : 2 },
    host: hosted ? { takeDecisions: () => parked.splice(0), parkDecisions: (events: HomeEvent[]) => parked.push(...events), changed() {} } : undefined,
    DECISION_RANK: { home: 0, bankruptcy_eligible: 1, cannot_cover: 2, bear_market: 3 },
    log: (_day: number, text: string) => feed.push(text), bankLog: (entry: unknown) => bank.push(entry),
    deskState: () => ({}), scheduleRender() {}, render() {}, saveDesk() {},
    dateOf: (day: number) => life.market.dateOf(day), nextDue: () => null, minPayment: () => 0,
    usd: (n: number) => n.toFixed(2), rate: String, pctOf: String, esc: String, monthDay: (d: Date) => d.toISOString(),
    row: (o: unknown) => JSON.stringify(o), nextCard: (title: string, body: string, cta?: unknown) => JSON.stringify({ title, body, cta }),
    aprNow: (d: { aprAnnual: number }) => d.aprAnnual, cardId: 'card', moveAct: null,
    pay: (_id: string, amount: number) => { c.lastPayment = amount; }, fundEmergency() {}, freeDate: () => 'later',
    go: (tab: string) => { c.tab = tab; },
    app: { addEventListener: (_name: string, handler: typeof clickHandler) => { clickHandler = handler; } },
  };
  createContext(c);
  runInContext(ts.transpileModule([...functions, click.getText(ast)].join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText, c);
  life.onEvents(events => c.onLifeEvents(events));
  return { c, feed, bank, parked, choose: (index: number) => clickHandler({ target: { closest: () => ({ dataset: { option: String(index) } }) } }) };
}

function cash(life: PlayerLife, amount: number) {
  for (const a of life.ledger.accounts.values()) a.balance = a.id === 'checking' ? amount : 0;
}
function addCard(life: PlayerLife) {
  const card = creditCard({ id: 'card', name: 'Card', balance: 1_000, limit: 1_500, apr: 0.2, day: 0 });
  card.statementBalance = 1_000;
  life.book.debts.push(card);
}

test('Home and Cards reserve mortgage, tax, insurance and PMI before suggesting card payments', () => {
  const life = person(); addCard(life); cash(life, 300);
  const { c } = desk(life);
  assert.doesNotMatch(c.nextMove(), /Pay down the Card/);
  c.cardsPage(); c.moveAct();
  assert.equal(c.lastPayment, 0);
  const mortgage = life.book.debts[0].scheduledPayment!;
  const bills = life.housingBills();
  cash(life, Math.ceil((mortgage + bills.taxAndInsurance + bills.pmi) * 100) / 100 + 200);
  assert.match(c.nextMove(), /Pay down the Card/); c.moveAct();
  assert.equal(c.lastPayment, 200);
  c.cardsPage(); c.moveAct(); assert.equal(c.lastPayment, 200);
});

test('renter card payments retain the stated rent reserve', () => {
  const life = person(false); addCard(life); cash(life, 1_400);
  const { c } = desk(life);
  c.nextMove(); c.moveAct(); assert.equal(c.lastPayment, 200);
  c.cardsPage(); c.moveAct(); assert.equal(c.lastPayment, 200);
});

test('actual housing bills keep their names and Housing category; Upcoming forecasts each owner bill', () => {
  const life = person(); const { c, bank } = desk(life);
  const names = ['Property tax and insurance', 'Mortgage insurance (PMI)'];
  c.onLifeEvents(names.map(name => ({ type: 'bill', day: 20, name, amount: 100, paid: 60 })));
  assert.deepEqual(bank.map(e => [e.name, e.category, e.amount]), names.map(name => [name, 'Housing', -60]));
  const forecast = c.upcoming();
  for (const name of names) assert.ok(forecast.includes(name));
  assert.ok(!forecast.includes('"title":"Rent"'));
});

for (const reason of ['eviction', 'foreclosure', 'bankruptcy'] as const) test(`${reason} parked before desk load shows its reason and a paused rental recovery`, () => {
  const life = person(false);
  life.fileBankruptcy(7, 0);
  const h = desk(life);
  h.parked.push({ type: 'home', day: 0, from: 1, to: 0, tenure: 'none', reason, value: 0, rent: 0, saleProceeds: 0, cashSpent: 0, mortgageId: null });
  h.c.showParkedDecisions();
  assert.ok(h.c.decision, 'housing loss must open a decision');
  assert.match(h.c.decision.title + h.c.decision.body, new RegExp(reason, 'i'));
  const option = h.c.decision.options.findIndex((o: { label: string }) => /rent.*studio/i.test(o.label));
  assert.ok(option >= 0, 'offer an explicit rental recovery');
  assert.equal(h.c.clock.speed, 0);
  h.choose(option);
  assert.equal(life.home.tenure, 'rent');
  assert.equal(h.c.clock.speed, 0);
});

test('bankruptcy filed inside an existing decision queues housing loss instead of dropping it or resuming', () => {
  const life = person(); const h = desk(life, false);
  h.c.askBankruptcy('Test'); h.choose(0);
  assert.equal(life.home.tier, 0);
  assert.ok(h.c.decision, 'the housing-loss decision must survive the bankruptcy action');
  assert.match(h.c.decision.title + h.c.decision.body, /bankruptcy/i);
  assert.equal(h.c.clock.speed, 0);
  const option = h.c.decision.options.findIndex((o: { label: string }) => /rent.*studio/i.test(o.label));
  h.choose(option);
  assert.equal(life.home.tenure, 'rent');
  assert.equal(h.c.clock.speed, 0);
});

test('overdue card catch-up also preserves housing, while mortgage catch-up can use that reserve', () => {
  const life = person(); addCard(life); cash(life, 300);
  const card = life.book.debts.find(d => d.id === 'card')!;
  card.pastDue = 500;
  const { c } = desk(life);
  assert.equal(JSON.parse(c.nextMove()).cta.disabled, true);
  c.moveAct(); assert.equal(c.lastPayment, 0);
  card.pastDue = 0; life.book.debts[0].pastDue = 500;
  c.nextMove(); c.moveAct(); assert.equal(c.lastPayment, 300);
});

test('reviewing cash keeps time paused and Home lets the player return to rental recovery', () => {
  const life = person(false); const h = desk(life, false);
  life.fileBankruptcy(7, 0);
  const review = h.c.decision.options.findIndex((o: { label: string }) => o.label === 'Review my cash');
  h.choose(review);
  assert.equal(h.c.tab, 'cash'); assert.equal(h.c.clock.speed, 0);
  assert.match(h.c.nextMove(), /studio/i);
  h.c.moveAct();
  assert.ok(h.c.decision); assert.equal(h.c.clock.speed, 0);
});

test('a loss delivered live and parked is shown once and does not reopen after recovery', () => {
  const life = person(false); const h = desk(life);
  life.fileBankruptcy(7, 0);
  const event = life.log.find(isHousingLossEvent)!;
  const first = h.c.decision;
  h.parked.push(event); h.c.showParkedDecisions();
  assert.equal(h.c.decision, first);
  assert.equal(h.feed.filter(text => /Bankruptcy moved/.test(text)).length, 1);
  h.choose(0);
  h.parked.push(event); h.c.showParkedDecisions();
  assert.equal(h.c.decision, null);
  assert.equal(life.home.tenure, 'rent');
});

function isHousingLossEvent(event: { type: string }): event is HomeEvent { return event.type === 'home'; }

test('a changed rental quote requires another confirmation with no intervening financial mutation', () => {
  const life = person(false); const h = desk(life);
  life.fileBankruptcy(7, 0);
  const first = h.c.decision;
  life.place.rpp.housing = 150;
  const before = life.toSave();
  h.choose(0);
  assert.notEqual(h.c.decision, first);
  assert.match(h.c.decision.body, /quote changed/);
  assert.deepEqual(life.toSave(), before);
  assert.equal(h.c.clock.speed, 0);
  h.choose(0);
  assert.equal(life.rent, 1338);
  assert.equal(h.c.clock.speed, 0);
});

test('paid-off ownership reserves taxes only; tent and rental forecasts omit inapplicable bills', () => {
  const life = person(); const { c } = desk(life);
  const mortgage = life.book.debts[0];
  mortgage.balance = 0; mortgage.accrued = 0; mortgage.status = 'paid';
  assert.equal(c.housingReserve(), 315.88);
  assert.doesNotMatch(c.upcoming(), /Mortgage insurance|"title":"Rent"/);
  life.fileBankruptcy(7, 0);
  assert.equal(c.housingReserve(), 0);
  assert.doesNotMatch(c.upcoming(), /Property tax|Mortgage insurance|"title":"Rent"/);
  assert.ok(life.chooseHome(1).ok);
  assert.equal(c.housingReserve(), life.rent);
  assert.match(c.upcoming(), /"title":"Rent"/);
  assert.doesNotMatch(c.upcoming(), /Property tax|Mortgage insurance/);
});
