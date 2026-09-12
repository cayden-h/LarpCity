// New York City. Manhattan is a long island between the Hudson (west) and the
// East River, with a tight street grid, Central Park up north, midtown Art
// Deco spires, the downtown financial district with a glass tower, a stone
// suspension bridge to Brooklyn's brownstones, and the harbor to the south
// with a small island for the copper statue.

import { LayoutBuilder } from "../engine/layout";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

const landmarks: LandmarkPlacement[] = [
  { id: "ny-deco-spire", x: 15, y: 14, w: 2, d: 2 },
  { id: "ny-sunburst-spire", x: 21, y: 11, w: 2, d: 2 },
  { id: "ny-flatiron", x: 12, y: 17, w: 2, d: 2 },
  { id: "ny-glass-tower", x: 9, y: 20, w: 2, d: 2 },
  { id: "ny-stone-bridge", x: 27, y: 22, w: 3, d: 1 },
  { id: "ny-statue", x: 10, y: 29, w: 2, d: 2 },
];

function layout(): string[] {
  const L = new LayoutBuilder(36, 32);
  L.rect(0, 0, 4, 32, "w"); // Hudson River
  L.rect(27, 0, 3, 32, "w"); // East River
  L.rect(0, 27, 36, 5, "w"); // Upper Bay
  // Manhattan avenues (north-south) and streets (east-west), three tiles apart.
  for (const x of [5, 8, 20, 23, 26]) L.roadY(x, 2, 25);
  for (const x of [11, 14, 17]) L.roadY(x, 10, 25); // these stop at the park
  L.roadX(2, 5, 26);
  for (const y of [16, 19, 25]) L.roadX(y, 5, 26);
  // Two crossings to Brooklyn; the lower one carries the stone bridge.
  for (const y of [13, 22]) L.roadX(y, 5, 32);
  L.roadX(10, 5, 26);
  L.roadY(32, 4, 22); // Brooklyn waterfront road closes the loop and runs north to the Heights
  L.frontage(2);
  // Central Park fills the block between the avenues north of 10th row.
  L.replace(9, 3, 11, 7, "b", "p").replace(9, 3, 11, 7, ".", "p");
  // Battery Park at the southern tip, a green strip in Brooklyn Heights.
  L.replace(6, 26, 7, 1, "b", "p").replace(6, 26, 7, 1, ".", "p");
  L.replace(30, 23, 2, 3, "b", "p").replace(30, 23, 2, 3, ".", "p");
  for (const lm of landmarks) {
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) if (L.get(i, j) !== "B" && L.get(i, j) !== "=") L.set(i, j, "P");
  }
  L.set(33, 17, "h"); // a Brooklyn brownstone on the waterfront road
  L.shore("s", (x, y) => (x * 5 + y * 3) % 4 === 0);
  L.clipCorners(3);
  return L.build();
}

// Monthly odds per day, January first. Snowy winters with nor'easters,
// hot humid summers with thunderstorms, late-summer tropical storms.
const climate: Climate[] = [
  { cloudy: 0.32, rain: 0.08, storm: 0.04, snow: 0.24, fog: 0.05, heat: 0 },
  { cloudy: 0.3, rain: 0.08, storm: 0.04, snow: 0.22, fog: 0.05, heat: 0 },
  { cloudy: 0.3, rain: 0.15, storm: 0.03, snow: 0.1, fog: 0.07, heat: 0 },
  { cloudy: 0.28, rain: 0.2, storm: 0.03, snow: 0.01, fog: 0.08, heat: 0 },
  { cloudy: 0.26, rain: 0.18, storm: 0.04, snow: 0, fog: 0.1, heat: 0.02 },
  { cloudy: 0.22, rain: 0.14, storm: 0.07, snow: 0, fog: 0.06, heat: 0.1 },
  { cloudy: 0.2, rain: 0.12, storm: 0.1, snow: 0, fog: 0.04, heat: 0.22 },
  { cloudy: 0.2, rain: 0.12, storm: 0.1, snow: 0, fog: 0.05, heat: 0.18 },
  { cloudy: 0.2, rain: 0.12, storm: 0.07, snow: 0, fog: 0.07, heat: 0.06 },
  { cloudy: 0.24, rain: 0.14, storm: 0.04, snow: 0, fog: 0.09, heat: 0 },
  { cloudy: 0.3, rain: 0.15, storm: 0.04, snow: 0.03, fog: 0.07, heat: 0 },
  { cloudy: 0.32, rain: 0.1, storm: 0.04, snow: 0.16, fog: 0.05, heat: 0 },
];

export const newYork: CityDef = {
  id: "new-york",
  name: "New York City",
  state: "NY",
  tagline: "The Big Apple: Art Deco spires, yellow cabs, and harbor ferries",
  plates: "new-york",
  layout: layout(),
  zones: [
    { x: 11, y: 22, r: 5, kind: "downtown" },
    { x: 17, y: 15, r: 5, kind: "midtown" },
    { x: 23, y: 12, r: 3, kind: "midtown" },
    { x: 6, y: 6, r: 4, kind: "residential" },
    { x: 23, y: 5, r: 4, kind: "residential" },
    { x: 33, y: 17, r: 6, kind: "residential" },
  ],
  palette: {
    walls: [0x8d5a44, 0xb5543c, 0xe0d6c2, 0x9e9e9e, 0xc9b79c, 0x7d8b99, 0xa0674f],
    roofs: [0x5d4037, 0x455a64, 0x6d6d6d],
    trim: [0xffffff, 0x37474f, 0x2e7d32, 0xf2b134],
    roofTypes: ["flat", "water-tower", "flat", "water-tower", "antenna"],
    grass: 0x5fa84a,
    water: 0x4a86b8,
    sand: 0xd8cfb8,
    maxFloors: 20,
  },
  backdrop: {
    terrain: "coast",
    terrainColor: 0x6f9e5a,
    skyline: [
      [0.3, 0.02, 0.35], [0.33, 0.025, 0.5], [0.36, 0.02, 0.42], [0.39, 0.03, 0.62], [0.42, 0.02, 0.55],
      [0.45, 0.025, 0.95], [0.48, 0.02, 0.6], [0.51, 0.03, 0.72], [0.54, 0.02, 0.58], [0.57, 0.025, 0.85],
      [0.6, 0.02, 0.8], [0.63, 0.03, 0.6], [0.66, 0.02, 0.48], [0.69, 0.025, 0.4],
    ],
    props: ["statue", "suspension-bridge"],
    sea: true,
  },
  climate,
  snowInWinter: true,
  landmarks,
  vehicles: [
    { kind: "taxi", weight: 6 },
    { kind: "sedan", weight: 2.5 },
    { kind: "bus", weight: 1.5 },
    { kind: "van", weight: 1.2 },
    { kind: "police", weight: 0.5 },
  ],
  boats: [
    { kind: "ferry", weight: 4 },
    { kind: "tug", weight: 1.5 },
    { kind: "sailboat", weight: 1.2 },
  ],
  traffic: 46,
  hazards: ["snow", "storm", "rain", "fog"],
  outskirts: {
    terrain: "plains", farms: 0.08, forest: 0.3, suburbs: 14, grid: 5, beltway: true,
    features: [
      { id: "ferris-wheel", w: 2, d: 2, where: "coast" },
      { id: "fishing-harbor", w: 3, d: 2, where: "coast" },
      { id: "power-plant", w: 3, d: 3, where: "rural" },
    ],
  },
};
