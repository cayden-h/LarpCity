import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, feedbackFacts, newsFacts } from './facts.js';
import type { EventRow, SnapshotRow } from '../store/runs.js';

const event = (payload: Record<string, unknown>): EventRow => ({ day: 1, kind: 'home', payload, key: '1:0' });
test('housing purchases and losses are usable news and coach facts', () => {
  const bought = event({ to: 2, tenure: 'own', reason: 'choice', value: 252700, rent: 0 });
  assert.match(describe(bought)!, /Bought.*Small house.*\$252,700/);
  const rented = event({ to: 1, tenure: 'rent', reason: 'move', rent: 892 });
  assert.match(describe(rented)!, /Studio apartment.*\$892/);
  for (const reason of ['eviction', 'foreclosure', 'bankruptcy']) {
    const loss = event({ to: 0, tenure: 'none', reason });
    assert.match(describe(loss)!, new RegExp(reason, 'i'));
    assert.match(describe(loss)!, /tent/i);
    const facts = newsFacts(0, 2, [], [loss]);
    assert.equal(facts.notableCounts.home, 1);
    assert.equal(facts.headlines.length, 1);
  }
  const snapshot = { day: 1, netWorth: 200000, checking: 10000, savings: 0, brokerage: 0, retirement: 0, debt: 0 } as SnapshotRow;
  assert.deepEqual(feedbackFacts('goal', 1, [snapshot], [bought]).recent.housing, [describe(bought)]);
});
