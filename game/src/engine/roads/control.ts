// Intersection control. Which control a node gets depends on the classes of
// the roads that meet there (the spec's table); Task 5 adds priorities,
// signal plans, and crosswalks.

import { RANK, type RoadClass } from "./types.ts";
import type { Arm, Movement, RNode, RoadNet } from "./graph.ts";

export type ControlKind = "signal" | "allway" | "stop" | "yield" | "merge" | "none";

export interface ArmInfo {
  cls: RoadClass;
  /** 0 for arms along x, 1 for arms along y. */
  axis: 0 | 1;
}

export function controlKind(kind: "cross" | "bend" | "end" | "edge" | "merge", arms: ArmInfo[], inCore: boolean): ControlKind {
  if (kind === "merge") return "merge";
  if (kind !== "cross") return "none";
  if (arms.every((a) => a.cls === "highway")) return "yield";
  const rankOf = (axis: 0 | 1) => Math.max(-1, ...arms.filter((a) => a.axis === axis).map((a) => RANK[a.cls]));
  const r0 = rankOf(0), r1 = rankOf(1);
  const hi = Math.max(r0, r1), lo = Math.min(r0, r1);
  if (hi >= 2 && lo >= 1) return "signal";
  if (hi === 1 && lo === 1) return "allway";
  if (inCore && hi < 2) return "allway";
  if (lo === 0 && hi >= 1) return "stop";
  return "yield";
}

/** Controls that paint crosswalks and a stop bar. */
export function hasCrosswalks(c: ControlKind): boolean {
  return c === "signal" || c === "allway";
}

const axisOf = (a: Arm): 0 | 1 => (Math.abs(a.dir.x) > 0.5 ? 0 : 1);

/** Arms that give way at a stop or yield node. */
export function minorArms(node: RNode): Set<Arm> {
  if (node.control !== "stop" && node.control !== "yield") return new Set();
  const rank = (axis: 0 | 1) => Math.max(-1, ...node.arms.filter((a) => axisOf(a) === axis).map((a) => RANK[a.seg.road.cls]));
  const count = (axis: 0 | 1) => node.arms.filter((a) => axisOf(a) === axis).length;
  const r0 = rank(0), r1 = rank(1);
  const minor: 0 | 1 = r0 !== r1 ? (r0 < r1 ? 0 : 1) : count(0) !== count(1) ? (count(0) < count(1) ? 0 : 1) : 1;
  return new Set(node.arms.filter((a) => axisOf(a) === minor));
}

const armOf = (node: RNode, m: Movement): Arm => node.arms.find((a) => a.seg === m.from.seg)!;

export function assignPriorities(net: RoadNet): void {
  for (const node of net.nodes) {
    const minor = minorArms(node);
    for (const m of node.movements) {
      switch (node.control) {
        case "stop":
        case "yield":
          m.priority = minor.has(armOf(node, m)) ? 0 : m.turn === "left" ? 1 : 2;
          break;
        case "allway":
          m.priority = 1;
          break;
        case "signal":
          m.priority = m.turn === "left" ? 1 : 2;
          break;
        case "merge":
          m.priority = m.turn === "merge" ? 0 : 2;
          break;
        default:
          m.priority = m.turn === "uturn" ? 0 : 2;
      }
    }
  }
}

export type Light = "G" | "P" | "Y" | "R";

export interface Phase {
  green: Set<Movement>;
  permitted: Set<Movement>;
  walk: Set<Arm>;
  dur: number;
}

export interface SignalPlan {
  node: RNode;
  phases: Phase[];
  cycle: number;
  offset: number;
}

const YELLOW = 3;
const ALL_RED = 1;
const ORDER: Record<string, number> = { straight: 0, right: 1, uturn: 2, left: 3 };

function phaseOf(ms: Movement[], dur: number, walk: Arm[]): Phase {
  const green = new Set<Movement>(), permitted = new Set<Movement>();
  for (const m of [...ms].sort((a, b) => ORDER[a.turn] - ORDER[b.turn] || a.id - b.id)) {
    if (m.conflicts.some((c) => green.has(c))) permitted.add(m);
    else green.add(m);
  }
  return { green, permitted, walk: new Set(walk), dur };
}

/** A signal plan for every signal node, keyed by node id. */
export function buildSignals(net: RoadNet): Map<number, SignalPlan> {
  const plans = new Map<number, SignalPlan>();
  for (const node of net.nodes) {
    if (node.control !== "signal") continue;
    const phases: Phase[] = [];
    for (const axis of [0, 1] as const) {
      const arms = node.arms.filter((a) => axisOf(a) === axis);
      const ms = node.movements.filter((m) => arms.some((a) => a.seg === m.from.seg));
      if (!ms.length) continue;
      const walk = node.arms.filter((a) => axisOf(a) !== axis && a.crosswalk);
      const lefts = ms.filter((m) => m.turn === "left");
      const thru = ms.filter((m) => m.turn !== "left");
      const multi = arms.some((a) => a.seg.lanes.filter((l) => l.to === node).length >= 2);
      if (multi && lefts.length) {
        phases.push(phaseOf(lefts, 5, []));
        phases.push(phaseOf(thru, 12, walk));
      } else phases.push(phaseOf(ms, 9, walk));
    }
    const cycle = phases.reduce((sum, p) => sum + p.dur + YELLOW + ALL_RED, 0);
    const offset = ((node.p.x + node.p.y) / 1.25) % cycle;
    plans.set(node.id, { node, phases, cycle, offset });
  }
  return plans;
}

/** Where in the cycle time t falls: the phase, and whether it is green, yellow, or all-red. */
function stage(plan: SignalPlan, t: number): { phase: Phase; part: "green" | "yellow" | "red"; left: number } {
  let u = (((t + plan.offset) % plan.cycle) + plan.cycle) % plan.cycle;
  for (const phase of plan.phases) {
    if (u < phase.dur) return { phase, part: "green", left: phase.dur - u };
    u -= phase.dur;
    if (u < YELLOW) return { phase, part: "yellow", left: YELLOW - u };
    u -= YELLOW;
    if (u < ALL_RED) return { phase, part: "red", left: ALL_RED - u };
    u -= ALL_RED;
  }
  return { phase: plan.phases[0], part: "red", left: 0 };
}

export function signalState(plan: SignalPlan, m: Movement, t: number): Light {
  const { phase, part } = stage(plan, t);
  const on = phase.green.has(m) ? "G" : phase.permitted.has(m) ? "P" : null;
  if (!on || part === "red") return "R";
  return part === "yellow" ? "Y" : on;
}

export function walkAllowed(plan: SignalPlan, arm: Arm, t: number): boolean {
  const { phase, part } = stage(plan, t);
  return part === "green" && phase.walk.has(arm);
}
