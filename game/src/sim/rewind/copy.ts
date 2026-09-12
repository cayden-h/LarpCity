// Copies for rewind checkpoints. A deep copy keeps each object's class (so a
// copied PlayerLife still runs its days) and copies Maps, arrays, and Dates;
// the seeded MarketPath and functions are shared, since neither changes as the
// player plays. `serialize` turns a copy into a string two copies can be
// compared by, which is how a timeline checks that replaying days reproduces a
// checkpoint exactly.

import { MarketPath } from "../market/index.ts";

export function deepCopy<T>(x: T, seen = new Map<unknown, unknown>()): T {
  if (x === null || typeof x !== "object" || x instanceof MarketPath) return x;
  if (seen.has(x)) return seen.get(x) as T;
  if (x instanceof Date) return new Date(x.getTime()) as T;
  if (x instanceof Map) {
    const m = new Map();
    seen.set(x, m);
    for (const [k, v] of x) m.set(k, deepCopy(v, seen));
    return m as T;
  }
  if (x instanceof Set) {
    const s = new Set();
    seen.set(x, s);
    for (const v of x) s.add(deepCopy(v, seen));
    return s as T;
  }
  if (Array.isArray(x)) {
    const a: unknown[] = [];
    seen.set(x, a);
    for (const v of x) a.push(deepCopy(v, seen));
    return a as T;
  }
  const o = Object.create(Object.getPrototypeOf(x)) as Record<string, unknown>;
  seen.set(x, o);
  for (const k of Object.keys(x)) o[k] = deepCopy((x as Record<string, unknown>)[k], seen);
  return o as T;
}

/** A stable string for comparing two copies: Maps and Sets as entries, the shared market and functions left out. */
export function serialize(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => {
    if (v instanceof MarketPath) return undefined;
    if (v instanceof Map) return { map: [...v] };
    if (v instanceof Set) return { set: [...v] };
    return v;
  });
}
