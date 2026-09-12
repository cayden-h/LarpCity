// Road network data: road classes and the RoadDef vectors cities and the
// world builder emit. The tile grid is stamped from these; the graph
// (graph.ts) and the traffic sim (sim.ts) read them.

export type RoadClass = "local" | "collector" | "arterial" | "highway" | "ramp";

export interface RoadDef {
  id: string;
  cls: RoadClass;
  /** Centerline in tile coordinates, axis-aligned pieces only. */
  path: [number, number][];
  /** Lanes along the path's direction and against it (0 against = one-way). */
  lanes: [number, number];
  tram?: boolean;
  /** A country road: local class, driven faster. */
  rural?: boolean;
  /** Whether the path's start and end stop at the world's edge, where cars enter and leave. */
  edge?: [boolean, boolean];
  /**
   * Ramps only: an "off" ramp's path starts beside the highway (it diverges),
   * an "on" ramp's path ends beside it (it merges). The path runs in the
   * direction of travel.
   */
  ramp?: "on" | "off";
}

/** Every lane is half a tile wide, so a 1-tile row of road holds two lanes. */
export const LANE_W = 0.5;

/** Desired speed in tiles per second. */
const SPEED: Record<RoadClass, number> = { local: 0.8, collector: 1.0, arterial: 1.25, highway: 1.8, ramp: 1.2 };

/** Importance, used to pick intersection control. */
export const RANK: Record<RoadClass, number> = { local: 0, ramp: 1, collector: 1, arterial: 2, highway: 3 };

export function defaultLanes(cls: RoadClass): [number, number] {
  if (cls === "ramp") return [1, 0];
  if (cls === "arterial" || cls === "highway") return [2, 2];
  return [1, 1];
}

/** Width in tiles: half the total lane count, at least one tile. */
export function roadWidth(r: Pick<RoadDef, "lanes">): number {
  return Math.max(1, Math.ceil((r.lanes[0] + r.lanes[1]) / 2));
}

export function roadSpeed(r: Pick<RoadDef, "cls" | "rural">): number {
  return r.rural ? 1.3 : SPEED[r.cls];
}

/** Every tile a road covers. */
export function roadTiles(r: RoadDef): [number, number][] {
  const w = roadWidth(r);
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < r.path.length; k++) {
    const [ax, ay] = r.path[k], [bx, by] = r.path[k + 1];
    const horiz = ay === by;
    const across = horiz ? ay : ax;
    const first = Math.round(across - w / 2);
    const lo = Math.floor(Math.min(horiz ? ax : ay, horiz ? bx : by));
    const hi = Math.floor(Math.max(horiz ? ax : ay, horiz ? bx : by));
    for (let i = lo; i <= hi; i++)
      for (let j = first; j < first + w; j++) {
        const t: [number, number] = horiz ? [i, j] : [j, i];
        const key = `${t[0]},${t[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(t);
        }
      }
  }
  return out;
}
