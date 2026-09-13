// Which zone a tile belongs to: the nearest zone by distance over radius.
// Kept free of PixiJS so the traffic sim and tests can use it.

import type { CityDef, ZoneKind } from "./types";

export function zoneAt(city: Pick<CityDef, "zones">, x: number, y: number): ZoneKind {
  let best: ZoneKind = "residential";
  let bestScore = Infinity;
  for (const z of city.zones) {
    const score = Math.hypot(x - z.x, y - z.y) / z.r;
    if (score < bestScore) {
      bestScore = score;
      best = z.kind;
    }
  }
  return bestScore <= 1.35 ? best : "residential";
}
