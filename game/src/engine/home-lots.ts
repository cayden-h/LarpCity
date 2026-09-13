import type { CityGrid } from './grid';
import type { CityDef } from './types';
import { roadTiles } from './roads/types.ts';
import { zoneAt } from './zones.ts';

export interface HomeLot {
  tier: number;
  x: number;
  y: number;
  w: 1;
  d: 1;
  where: string;
  /** Why a requested location or neighborhood could not be used. */
  rationale?: string;
}

const BUILDABLE = new Set(['b', 'h', '.', 'p', 's', 'f']);
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const FLOORS = [1, 4, 1, 3, 2, 2];
const LABELS = ['Park edge', 'Midtown', 'Small-house neighborhood', 'Inner residential', 'Suburb ring', 'Coast or map edge'];
const key = (x: number, y: number) => `${x},${y}`;

/**
 * Plan before reserving or populating the grid. Coordinates, including explicit
 * homes, are in expanded-world space. The caller alone reserves these tiles.
 * Safety is mandatory; missing neighborhood terrain falls back with a reason.
 */
export function planHomeLots(grid: CityGrid, city: CityDef): HomeLot[] {
  const core = city.core ?? { x: 0, y: 0, w: grid.w, h: grid.h };
  const distanceFromCore = (x: number, y: number) => Math.max(0, core.x - x, x - (core.x + core.w - 1), core.y - y, y - (core.y + core.h - 1));
  const occupied = new Set<string>();
  for (const lm of city.landmarks) for (let y = lm.y; y < lm.y + lm.d; y++) for (let x = lm.x; x < lm.x + lm.w; x++) occupied.add(key(x,y));
  const restricted = new Set(city.roads.filter(r => r.cls === 'highway' || r.cls === 'ramp').flatMap(roadTiles).map(([x,y]) => key(x,y)));
  const surface = (x: number, y: number) => ['=', 't'].includes(grid.at(x,y)) && !restricted.has(key(x,y)) && !occupied.has(key(x,y));
  const beside = (x: number, y: number, predicate: (x: number, y: number) => boolean) => STEPS.some(([dx,dy]) => predicate(x+dx,y+dy));

  // Multi-source Manhattan distance respects the world's clipped outline and
  // inland water; a rectangular bounding-box edge would misplace inland villas.
  const edge = new Map<string, number>();
  const queue: [number, number][] = [];
  for (const {x,y,c} of grid.cells()) if (c === 'w' || c === ' ' || x === 0 || y === 0 || x === grid.w-1 || y === grid.h-1) {
    edge.set(key(x,y), 0); queue.push([x,y]);
  }
  for (let i = 0; i < queue.length; i++) {
    const [x,y] = queue[i];
    for (const [dx,dy] of STEPS) {
      const nx = x+dx, ny = y+dy, k = key(nx,ny);
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h || edge.has(k)) continue;
      edge.set(k, edge.get(key(x,y))!+1); queue.push([nx,ny]);
    }
  }
  const candidates = [...grid.cells()].filter(({x,y,c}) => BUILDABLE.has(c) && !occupied.has(key(x,y)) && !restricted.has(key(x,y)) && beside(x,y,surface));
  type Candidate = typeof candidates[number];
  const safeSightline = (p: Candidate, tier: number) => city.landmarks.every(lm => {
    // Same isometric column/depth clearance used by the filler-building cap.
    const ahead = p.x+p.y+1 - (lm.x+lm.y+(lm.w+lm.d)/2);
    const offset = Math.abs(p.x-p.y - (lm.x+lm.w/2-lm.y-lm.d/2));
    return !(ahead > 0 && ahead < 10 && offset <= (lm.w+lm.d)/2+.5 && FLOORS[tier] > 2+Math.floor(ahead/3));
  });
  // The reverse check: a landmark standing between the home and the camera would hide it.
  const unobstructed = (p: Candidate) => city.landmarks.every(lm => {
    const ahead = lm.x+lm.y+(lm.w+lm.d)/2 - (p.x+p.y+1);
    const offset = Math.abs(p.x-p.y - (lm.x+lm.w/2-lm.y-lm.d/2));
    return !(ahead > 0 && ahead < 6 && offset <= (lm.w+lm.d)/2+.5);
  });
  const geographic =(p: Candidate, tier: number): boolean => {
    const d = distanceFromCore(p.x,p.y);
    switch (tier) {
      case 0: return p.c === 'p' || beside(p.x,p.y,(x,y) => grid.at(x,y) === 'p');
      case 1: return d === 0 && zoneAt(city,p.x,p.y) === 'midtown';
      case 2: return p.c === 'h';
      case 3: return d === 0 && zoneAt(city,p.x,p.y) === 'residential';
      case 4: return d > 0 && d <= (city.outskirts?.suburbs ?? 10) && p.c === 'b';
      case 5: return edge.get(key(p.x,p.y))! <= 3;
      default: return false;
    }
  };
  const used = new Set<string>();
  const results = new Map<number, HomeLot>();
  const reasons = new Map<number, string>();
  const existingHome = candidates.find(p => p.c === 'h');
  const available = (p: Candidate, tier: number) => !used.has(key(p.x,p.y)) && (tier === 2 || p !== existingHome) && safeSightline(p,tier) && unobstructed(p);

  // Reserve explicit lots before rule picks. Tier 2 has first claim to h;
  // duplicate explicit coordinates otherwise resolve by ascending tier.
  const order = [2, 0, 1, 3, 4, 5];
  for (const tier of order) {
    const requested = city.homes?.find(h => h.tier === tier);
    if (!requested) continue;
    const p = candidates.find(p => p.x === requested.x && p.y === requested.y);
    if (!p || !available(p,tier)) {
      reasons.set(tier, 'Explicit lot is not buildable with surface-road access, conflicts with a reserved home, or blocks a landmark sightline.');
      continue;
    }
    // A curated city may intentionally choose a different neighborhood.
    results.set(tier,{ tier, x:p.x, y:p.y, w:1, d:1, where:requested.where?.trim() || LABELS[tier] });
    used.add(key(p.x,p.y));
  }
  for (const tier of order) {
    if (results.has(tier)) continue;
    const safe = candidates.filter(p => available(p,tier));
    const preferred = safe.filter(p => geographic(p,tier));
    const pool = preferred.length ? preferred : safe;
    if (!pool.length) throw new Error(`Cannot place home lot tier ${tier} in ${city.id}: no safe surface-road lot remains.`);
    const score = (p: Candidate) => {
      if (tier === 5) return edge.get(key(p.x,p.y))!;
      const zones = city.zones.filter(z => z.kind === (tier === 1 ? 'midtown' : 'residential') && distanceFromCore(z.x,z.y) === 0);
      if (tier === 1 || tier === 3) return Math.min(...zones.map(z => Math.hypot(p.x-z.x,p.y-z.y)/z.r));
      return Math.hypot(p.x-(core.x+core.w/2),p.y-(core.y+core.h/2));
    };
    pool.sort((a,b) => score(a)-score(b) || a.y-b.y || a.x-b.x);
    const p = pool[0];
    const explanation = [reasons.get(tier), !preferred.length ? `No safe ${LABELS[tier].toLowerCase()} lot exists; using accessible residential land.` : undefined].filter(Boolean).join(' ');
    results.set(tier,{ tier, x:p.x, y:p.y, w:1, d:1, where:preferred.length ? LABELS[tier] : 'Residential fallback', ...(explanation ? { rationale:explanation } : {}) });
    used.add(key(p.x,p.y));
  }
  return [...results.values()].sort((a,b) => a.tier-b.tier);
}
