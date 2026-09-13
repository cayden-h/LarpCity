import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { PlayerLife, defaultAccounts } from '../src/sim/life/index.ts';
import { newBook } from '../src/sim/debt/factory.ts';
import { MarketPath } from '../src/sim/market/index.ts';

// The eligibility helper has no DOM dependency; ignore only its stylesheet import.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/ui/home-picker.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { homePickerEligibility } = await import('../src/ui/home-picker.ts');
hooks.deregister();

function renter(rent: number, cash = 1_000_000) {
  const book = newBook({ debts: [], agi: 500_000, monthlyTakeHome: 500_000 / 15, day: 0 });
  book.profile.score = 800;
  return new PlayerLife({
    place: { abbr: 'TX', name: 'Texas', rpp: { all: 100, goods: 100, housing: 100 } },
    day: 0, book, grossAnnual: 500_000, rent, market: new MarketPath(), cashRate: () => 0.04,
    accounts: defaultAccounts(0).map(a => ({ ...a, balance: a.id === 'savings' ? cash : 0 })),
  });
}

test('rented townhouse keeps its badge but offers the quoted purchase and mortgage costs', () => {
  const life = renter(2_000);
  const quote = life.quoteHome(3);
  assert.equal(life.home.tier, 3);
  assert.equal(life.home.tenure, 'rent');
  assert.equal(quote.ok, true);
  assert.deepEqual(homePickerEligibility(life.home, life.rent, quote, true), { occupiesLot: true, current: false, canMove: true });
  assert.equal(life.chooseHome(3).ok, true);
  const owned = life.quoteHome(3);
  assert.deepEqual(homePickerEligibility(life.home, life.rent, owned, true), { occupiesLot: true, current: true, canMove: false });
});

test('studio can be re-rented at the quoted rate, then becomes the current transaction', () => {
  const life = renter(1_200);
  const quote = life.quoteHome(1);
  assert.equal(quote.ok, true);
  assert.notEqual(quote.rent, life.rent);
  assert.deepEqual(homePickerEligibility(life.home, life.rent, quote, true), { occupiesLot: true, current: false, canMove: true });
  assert.equal(life.chooseHome(1).ok, true);
  assert.deepEqual(homePickerEligibility(life.home, life.rent, life.quoteHome(1), true), { occupiesLot: true, current: true, canMove: false });
});

test('unaffordable purchase of the occupied townhouse still exposes quote costs and reasons', () => {
  const life = renter(2_000, 0);
  const quote = life.quoteHome(3);
  assert.equal(quote.ok, false);
  assert.ok(quote.reasons.length);
  assert.deepEqual(homePickerEligibility(life.home, life.rent, quote, true), { occupiesLot: true, current: false, canMove: false });
});

test('missing lots and the emergency tent cannot be chosen', () => {
  const life = renter(2_000);
  assert.equal(homePickerEligibility(life.home, life.rent, life.quoteHome(3), false).canMove, false);
  assert.equal(homePickerEligibility(life.home, life.rent, life.quoteHome(0), true).canMove, false);
});
