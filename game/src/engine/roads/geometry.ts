// Tile-space geometry for the road network: polylines sampled by distance,
// cubic Bezier connectors, and the distance between two paths.

export interface P {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, atan2 in tile space (0 = +x, PI/2 = +y). */
  h: number;
}

export class Path {
  readonly pts: P[];
  readonly cum: number[];
  readonly length: number;
  /** Axis-aligned bounds of pts, for a cheap reject before a full distance scan. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Per-segment bounds (segBox[4*i..4*i+3] = minX,maxX,minY,maxY of pts[i]..pts[i+1]), for
   * rejecting most segment pairs before the full segSeg computation. */
  readonly segBox: Float64Array;

  constructor(pts: P[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    this.length = this.cum[this.cum.length - 1];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const n = Math.max(0, pts.length - 1);
    const segBox = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1];
      const sMinX = Math.min(a.x, b.x), sMaxX = Math.max(a.x, b.x);
      const sMinY = Math.min(a.y, b.y), sMaxY = Math.max(a.y, b.y);
      segBox[i * 4] = sMinX;
      segBox[i * 4 + 1] = sMaxX;
      segBox[i * 4 + 2] = sMinY;
      segBox[i * 4 + 3] = sMaxY;
      if (sMinX < minX) minX = sMinX;
      if (sMaxX > maxX) maxX = sMaxX;
      if (sMinY < minY) minY = sMinY;
      if (sMaxY > maxY) maxY = sMaxY;
    }
    this.segBox = segBox;
    // A path of fewer than two points has no segments: its bounds stay at the
    // empty sentinels (min Infinity, max -Infinity), so pathsClose rejects it at once.
    this.minX = pts.length ? minX : Infinity;
    this.maxX = pts.length ? maxX : -Infinity;
    this.minY = pts.length ? minY : Infinity;
    this.maxY = pts.length ? maxY : -Infinity;
  }

  /** Point and heading at distance s along the path, clamped to its ends. */
  at(s: number): Pose {
    const d = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1];
    const t = seg > 0 ? (d - this.cum[i - 1]) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Distance along the path of the point on it nearest p. */
  project(p: P): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d < bestD) {
        bestD = d;
        best = this.cum[i - 1] + (this.cum[i] - this.cum[i - 1]) * t;
      }
    }
    return best;
  }
}

/** A cubic Bezier from p0 to p3, sampled as n + 1 points. */
export function bezier(p0: P, p1: P, p2: P, p3: P, n = 12): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  out[0] = { ...p0 };
  out[n] = { ...p3 };
  return out;
}

function pointSeg(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

function segSeg(a: P, b: P, c: P, d: P): number {
  const cross = (o: P, p: P, q: P) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

/** The smallest distance between two paths. */
export function minDistance(p: Path, q: Path): number {
  let best = Infinity;
  for (let i = 1; i < p.pts.length; i++)
    for (let j = 1; j < q.pts.length; j++) best = Math.min(best, segSeg(p.pts[i - 1], p.pts[i], q.pts[j - 1], q.pts[j]));
  return best;
}

/**
 * Whether two paths ever come within `thresh` of each other: exactly
 * `minDistance(p, q) < thresh`, but a bounding-box reject skips the scan
 * when the paths cannot possibly be close, and the scan itself stops at the
 * first close pair instead of always finding the true minimum (the caller
 * only needs the boolean, and most conflicting movements clash immediately).
 */
export function pathsClose(p: Path, q: Path, thresh: number): boolean {
  if (p.minX - q.maxX >= thresh || q.minX - p.maxX >= thresh || p.minY - q.maxY >= thresh || q.minY - p.maxY >= thresh) return false;
  const pb = p.segBox, qb = q.segBox;
  const pn = pb.length / 4, qn = qb.length / 4;
  for (let i = 0; i < pn; i++) {
    const pMinX = pb[i * 4], pMaxX = pb[i * 4 + 1], pMinY = pb[i * 4 + 2], pMaxY = pb[i * 4 + 3];
    for (let j = 0; j < qn; j++) {
      if (pMinX - qb[j * 4 + 1] >= thresh || qb[j * 4] - pMaxX >= thresh || pMinY - qb[j * 4 + 3] >= thresh || qb[j * 4 + 2] - pMaxY >= thresh) continue;
      if (segSeg(p.pts[i], p.pts[i + 1], q.pts[j], q.pts[j + 1]) < thresh) return true;
    }
  }
  return false;
}
