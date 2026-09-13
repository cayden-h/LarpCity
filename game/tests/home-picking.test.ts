import assert from 'node:assert/strict';
import test from 'node:test';
import { hitsHomeBody } from '../src/engine/home-picking.ts';

test('home picking follows the extruded lot diamond, not sprite padding', () => {
  assert.equal(hitsHomeBody(0, 16, 0, 0, 60), true);
  assert.equal(hitsHomeBody(0, -59, 0, 0, 60), true);
  assert.equal(hitsHomeBody(31, -58, 0, 0, 60), false);
  assert.equal(hitsHomeBody(31, 30, 0, 0, 60), false);
  assert.equal(hitsHomeBody(40, 0, 0, 0, 60), false);
  assert.equal(hitsHomeBody(0, -61, 0, 0, 60), false);
});

test('home picking translates with world tile coordinates', () => {
  const x = 63, y = 65;
  assert.equal(hitsHomeBody((x-y)*32, (x+y+1)*16-40, x, y, 60), true);
  assert.equal(hitsHomeBody((x-y)*32+45, (x+y+1)*16, x, y, 60), false);
});
