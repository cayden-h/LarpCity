// Seeded value noise for terrain: forests, ponds, mountains, farm patchwork.

import { hashKeys } from "./rng.ts";

function lattice(seed: number, x: number, y: number): number {
  return hashKeys(seed, x, y) / 4294967296;
}

export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, x0, y0), b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1), d = lattice(seed, x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in 0..1 (three octaves). */
export function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 977, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** A stable 0..1 number for a cell (for patchwork farms, parks). */
export function cellHash(seed: number, ...keys: (string | number)[]): number {
  return hashKeys(seed, ...keys) / 4294967296;
}
