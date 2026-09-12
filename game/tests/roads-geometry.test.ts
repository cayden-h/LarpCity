// Path sampling, projection, Bezier curves, and path distance. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bezier, minDistance, Path } from "../src/engine/roads/geometry.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("a path knows its length and samples points and headings by distance", () => {
  const p = new Path([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }]);
  near(p.length, 5);
  const a = p.at(1);
  near(a.x, 1);
  near(a.y, 0);
  near(a.h, 0);
  const b = p.at(3.5);
  near(b.x, 2);
  near(b.y, 1.5);
  near(b.h, Math.PI / 2);
  near(p.at(-1).x, 0);
  near(p.at(99).y, 3);
});

test("project finds the distance along the path of the nearest point", () => {
  const p = new Path([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  near(p.project({ x: 1.5, y: 2 }), 1.5);
  near(p.project({ x: -3, y: 0 }), 0);
  near(p.project({ x: 9, y: 1 }), 4);
});

test("bezier starts and ends at its end points", () => {
  const pts = bezier({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, 10);
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[10], { x: 2, y: 2 });
});

test("minDistance is 0 for crossing paths and the gap for parallel ones", () => {
  const a = new Path([{ x: 0, y: 0 }, { x: 2, y: 2 }]);
  const b = new Path([{ x: 0, y: 2 }, { x: 2, y: 0 }]);
  near(minDistance(a, b), 0);
  const c = new Path([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  const d = new Path([{ x: 0, y: 0.5 }, { x: 3, y: 0.5 }]);
  near(minDistance(c, d), 0.5);
});
