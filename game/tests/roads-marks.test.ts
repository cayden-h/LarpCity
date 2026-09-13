// Road markings come from the network. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/engine/roads/graph.ts";
import { roadMarks } from "../src/engine/roads/marks.ts";
import type { RoadDef } from "../src/engine/roads/types.ts";

const noBridge = () => false;

test("a signal has crosswalks on every arm and a stop bar on every incoming lane", () => {
  const net = buildGraph([
    { id: "x", cls: "arterial", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] } as RoadDef,
    { id: "y", cls: "arterial", path: [[15, 0.5], [15, 30.5]], lanes: [2, 2] } as RoadDef,
  ]);
  const marks = roadMarks(net, noBridge);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  const near = (m: { pts: { x: number; y: number }[] }) => Math.hypot(m.pts[0].x - node.p.x, m.pts[0].y - node.p.y) < 3;
  assert.equal(marks.filter((m) => m.tag === "stop" && near(m)).length, 8);
  for (const arm of node.arms) {
    const d = arm.dir;
    const onArm = marks.filter((m) => m.tag === "crosswalk" && near(m) && (m.pts[0].x - node.p.x) * d.x + (m.pts[0].y - node.p.y) * d.y > 0.5);
    assert.ok(onArm.length >= 5, `arm (${d.x},${d.y}) has ${onArm.length} stripes`);
  }
  assert.ok(marks.some((m) => m.tag === "arrow"), "left-turn arrows");
  assert.ok(marks.filter((m) => m.tag === "center" && m.color === "yellow").length > 0);
});

test("a stop T puts the stop bar only on the stem", () => {
  const net = buildGraph([
    { id: "a", cls: "arterial", path: [[0.5, 7], [15.5, 7]], lanes: [2, 2] } as RoadDef,
    { id: "s", cls: "local", path: [[7.5, 8.5], [7.5, 14.5]], lanes: [1, 1] } as RoadDef,
  ]);
  const stops = roadMarks(net, noBridge).filter((m) => m.tag === "stop");
  assert.equal(stops.length, 1);
  assert.ok(Math.abs(stops[0].pts[0].x - 7.5) < 0.5 && stops[0].pts[0].y > 7.5);
  assert.equal(roadMarks(net, noBridge).filter((m) => m.tag === "crosswalk").length, 0);
});

test("a local street gets a dashed yellow center line and nothing else", () => {
  const net = buildGraph([{ id: "a", cls: "local", path: [[0.5, 2.5], [10.5, 2.5]], lanes: [1, 1] } as RoadDef]);
  const marks = roadMarks(net, noBridge);
  assert.ok(marks.every((m) => m.tag === "center" && m.color === "yellow"));
  assert.ok(marks.length >= 18 && marks.length <= 22, `${marks.length} dashes over 10 tiles`);
});

test("marks over bridge tiles are raised", () => {
  const net = buildGraph([{ id: "a", cls: "local", path: [[0.5, 2.5], [10.5, 2.5]], lanes: [1, 1] } as RoadDef]);
  const marks = roadMarks(net, (x) => x >= 4 && x < 6);
  assert.ok(marks.some((m) => m.raised) && marks.some((m) => !m.raised));
});
