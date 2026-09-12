// The road graph: nodes, trims, lanes, movements, conflicts, reachability. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, type RoadNet } from "../src/engine/roads/graph.ts";
import type { RoadDef } from "../src/engine/roads/types.ts";

const local = (id: string, path: [number, number][]): RoadDef => ({ id, cls: "local", path, lanes: [1, 1] });
const crosses = (net: RoadNet) => net.nodes.filter((n) => n.kind === "cross");

test("two crossing locals make one 4-way node with 12 movements", () => {
  const net = buildGraph([local("a", [[0.5, 5.5], [10.5, 5.5]]), local("b", [[5.5, 0.5], [5.5, 10.5]])]);
  const [n] = crosses(net);
  assert.equal(crosses(net).length, 1);
  assert.deepEqual([n.p.x, n.p.y], [5.5, 5.5]);
  assert.equal(n.arms.length, 4);
  assert.equal(net.segments.length, 4);
  assert.equal(net.lanes.length, 8);
  const turns = n.movements.map((m) => m.turn).sort();
  assert.deepEqual(turns, ["left", "left", "left", "left", "right", "right", "right", "right", "straight", "straight", "straight", "straight"]);
  const straight = n.movements.filter((m) => m.turn === "straight");
  const ns = straight.find((m) => Math.abs(m.from.path.at(0).x - 5.5) < 0.6)!;
  const ew = straight.find((m) => Math.abs(m.from.path.at(0).y - 5.5) < 0.6)!;
  assert.ok(ns.conflicts.includes(ew), "crossing straights conflict");
  const rights = n.movements.filter((m) => m.turn === "right");
  for (const a of rights) for (const b of rights) if (a !== b) assert.ok(!a.conflicts.includes(b), "right turns from different arms do not conflict");
});

test("movements run from the end of their entry lane to the start of their exit lane", () => {
  const net = buildGraph([local("a", [[0.5, 5.5], [10.5, 5.5]]), local("b", [[5.5, 0.5], [5.5, 10.5]])]);
  for (const m of net.movements) {
    const a = m.from.path.at(m.from.path.length), b = m.path.at(0);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);
    const c = m.to.path.at(0), d = m.path.at(m.path.length);
    assert.ok(Math.hypot(c.x - d.x, c.y - d.y) < 1e-9);
  }
});

test("lanes keep right and sit half a lane from a 1-tile road's centerline", () => {
  const net = buildGraph([local("a", [[0.5, 2.5], [8.5, 2.5]])]);
  const east = net.lanes.find((l) => l.forward)!;
  const west = net.lanes.find((l) => !l.forward)!;
  assert.equal(east.path.at(0).y, 2.75);
  assert.equal(west.path.at(0).y, 2.25);
  assert.ok(west.path.at(0).x > west.path.at(west.path.length).x, "the backward lane runs west");
});

test("a local ending on an arterial makes a T with stop control; the arterial is trimmed by the local's half-width", () => {
  const art: RoadDef = { id: "art", cls: "arterial", path: [[0.5, 7], [15.5, 7]], lanes: [2, 2] };
  const net = buildGraph([art, local("x", [[7.5, 8.5], [7.5, 14.5]])]);
  const [n] = crosses(net);
  assert.equal(n.arms.length, 3);
  assert.equal(n.control, "stop");
  assert.deepEqual([n.p.x, n.p.y], [7.5, 7]);
  const artArm = n.arms.find((a) => a.seg.road.id === "art")!;
  const locArm = n.arms.find((a) => a.seg.road.id === "x")!;
  assert.equal(artArm.trim, 0.5);
  assert.equal(locArm.trim, 1);
});

test("a stub inside the intersection box is removed", () => {
  const art: RoadDef = { id: "art", cls: "arterial", path: [[0.5, 7], [15.5, 7]], lanes: [2, 2] };
  const net = buildGraph([art, local("x", [[7.5, 6.5], [7.5, 14.5]])]);
  const [n] = crosses(net);
  assert.equal(n.arms.length, 3);
  assert.equal(net.nodes.filter((m) => m.kind === "end").length, 3, "the arterial's two ends and the local's far end");
});

test("a lone street is fully reachable through U-turns at its dead ends", () => {
  const net = buildGraph([local("a", [[0.5, 2.5], [8.5, 2.5]])]);
  assert.equal(net.movements.filter((m) => m.turn === "uturn").length, 2);
  assert.ok(net.lanes.every((l) => l.live));
});

test("a highway crossing an arterial is grade-separated", () => {
  const hwy: RoadDef = { id: "h", cls: "highway", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] };
  const art: RoadDef = { id: "a", cls: "arterial", path: [[15, 0.5], [15, 20.5]], lanes: [2, 2] };
  const net = buildGraph([hwy, art]);
  assert.equal(crosses(net).length, 0);
  assert.equal(net.segments.length, 2);
});

test("a ramp beside a highway diverges from the rightmost lane", () => {
  const hwy: RoadDef = { id: "h", cls: "highway", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] };
  const ramp: RoadDef = { id: "r", cls: "ramp", ramp: "off", path: [[10, 11.5], [14, 11.5]], lanes: [1, 0] };
  const net = buildGraph([hwy, ramp, local("s", [[14.5, 11.5], [14.5, 20.5]])]);
  const merge = net.nodes.find((n) => n.kind === "merge")!;
  assert.ok(merge, "a merge node exists");
  assert.deepEqual([merge.p.x, merge.p.y], [10, 10]);
  const div = merge.movements.filter((m) => m.turn === "diverge");
  assert.equal(div.length, 1);
  assert.equal(div[0].from.forward, true);
  assert.equal(div[0].from.index, div[0].from.count - 1);
  assert.equal(div[0].to.seg.road.id, "r");
});

test("every lane and movement has a unique track id", () => {
  const net = buildGraph([local("a", [[0.5, 5.5], [10.5, 5.5]]), local("b", [[5.5, 0.5], [5.5, 10.5]])]);
  assert.equal(net.tracks.length, net.lanes.length + net.movements.length);
  net.tracks.forEach((t, i) => assert.equal(t.tid, i));
});
