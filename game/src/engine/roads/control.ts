// Intersection control. Which control a node gets depends on the classes of
// the roads that meet there (the spec's table); Task 5 adds priorities,
// signal plans, and crosswalks.

import { RANK, type RoadClass } from "./types.ts";

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
