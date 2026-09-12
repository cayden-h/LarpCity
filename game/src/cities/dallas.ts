// Dallas, Big D. The Trinity River winds down the west side through a wide
// green floodplain park, crossed by a white arch bridge. A compact glassy
// downtown sits east of the levee with the sphere tower and the green-outlined
// tower, double-deck freeways box it in, the stadium district lies to the
// southeast, and big-lot suburbs spread out to the north and east.

import { LayoutBuilder } from "../engine/layout";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

const W = 36, H = 32;
/** The row the arch bridge spans; its footprint is read off the built layout. */
const ARCH_ROW = 20;

const fixed: LandmarkPlacement[] = [
  { id: "dal-sphere-tower", x: 15, y: 9, w: 2, d: 2 },
  { id: "dal-outline-tower", x: 20, y: 5, w: 2, d: 2 },
  { id: "dal-stadium", x: 25, y: 22, w: 5, d: 4 },
  { id: "dal-cowboy-boots", x: 31, y: 15, w: 2, d: 2 },
];

/** Downtown core and the stadium block keep dense frontage; elsewhere lots get yards. */
const dense = (x: number, y: number) => (x >= 14 && x <= 29 && y >= 4 && y <= 13) || (x >= 24 && x <= 30 && y >= 20 && y <= 27);

function layout(): string[] {
  const L = new LayoutBuilder(W, H);
  // Trinity River, winding south along the west side.
  L.path([[8, -1], [6, 4], [9, 10], [7, 16], [8.5, 21], [6, 26], [7, 33]], "w", 2);
  // Surface streets and river crossings; 12-13 and 23-24 are double freeways.
  for (const y of [4, 12, 13, 20, 27]) L.roadX(y);
  L.roadX(8, 14, 24); // downtown cross street
  L.roadY(1, 4, 27); // Oak Cliff, on the west bank
  for (const x of [14, 19, 23, 24, 30]) L.roadY(x);
  L.frontage(2);
  // The floodplain between the levees: open prairie grass with scattered trees.
  for (let y = 0; y < H; y++)
    for (let x = 2; x <= 13; x++) {
      const c = L.get(x, y);
      if (c === "b" || c === ".") L.set(x, y, (x * 5 + y * 3) % 4 === 0 ? "p" : ".");
    }
  // Suburbs: thin the frontage into big lots with yards.
  for (let y = 0; y < H; y++)
    for (let x = 14; x < W; x++) {
      if (L.get(x, y) !== "b" || dense(x, y)) continue;
      const k = (x + y * 2) % 5;
      if (k === 0) L.set(x, y, "p");
      else if (k === 3) L.set(x, y, ".");
    }
  // Parks: a downtown green and a lake park by the stadium; parking around it.
  L.replace(20, 9, 2, 2, "b", "p");
  L.replace(25, 21, 5, 1, "b", "P").replace(25, 26, 5, 1, "b", "P");
  L.replace(25, 21, 5, 1, ".", "P").replace(25, 26, 5, 1, ".", "P");
  for (const lm of fixed) {
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) if (L.get(i, j) !== "B" && L.get(i, j) !== "=") L.set(i, j, "P");
  }
  L.set(27, 3, "h"); // the player's home, on the north suburban road
  L.shore("~", (x, y) => (x * 7 + y * 3) % 5 === 0);
  L.clipCorners(3);
  return L.build();
}

const grid = layout();
const archStart = grid[ARCH_ROW].indexOf("B");
const archEnd = grid[ARCH_ROW].lastIndexOf("B");

const landmarks: LandmarkPlacement[] = [
  ...fixed,
  { id: "dal-arch-bridge", x: archStart, y: ARCH_ROW, w: archEnd - archStart + 1, d: 1 },
];

// Monthly odds per day, January first. Spring brings supercells, July and
// August are blast furnaces, and a winter ice storm shows up now and then.
const climate: Climate[] = [
  { cloudy: 0.35, rain: 0.08, storm: 0.01, snow: 0.03, fog: 0.06, heat: 0 },
  { cloudy: 0.33, rain: 0.09, storm: 0.02, snow: 0.03, fog: 0.05, heat: 0 },
  { cloudy: 0.3, rain: 0.1, storm: 0.05, snow: 0.005, fog: 0.04, heat: 0.02 },
  { cloudy: 0.28, rain: 0.1, storm: 0.09, snow: 0, fog: 0.03, heat: 0.05 },
  { cloudy: 0.28, rain: 0.12, storm: 0.12, snow: 0, fog: 0.02, heat: 0.12 },
  { cloudy: 0.2, rain: 0.08, storm: 0.07, snow: 0, fog: 0.01, heat: 0.3 },
  { cloudy: 0.12, rain: 0.05, storm: 0.03, snow: 0, fog: 0, heat: 0.45 },
  { cloudy: 0.12, rain: 0.05, storm: 0.03, snow: 0, fog: 0, heat: 0.48 },
  { cloudy: 0.18, rain: 0.07, storm: 0.04, snow: 0, fog: 0.01, heat: 0.3 },
  { cloudy: 0.22, rain: 0.09, storm: 0.05, snow: 0, fog: 0.03, heat: 0.08 },
  { cloudy: 0.3, rain: 0.08, storm: 0.03, snow: 0.005, fog: 0.05, heat: 0.01 },
  { cloudy: 0.35, rain: 0.08, storm: 0.01, snow: 0.02, fog: 0.06, heat: 0 },
];

export const dallas: CityDef = {
  id: "dallas",
  name: "Dallas",
  state: "TX",
  tagline: "Big D: glass towers, freeways, and the Trinity River",
  plates: "dallas",
  layout: grid,
  zones: [
    { x: 18.5, y: 8.5, r: 5, kind: "downtown" },
    { x: 27, y: 8, r: 3.5, kind: "midtown" },
    { x: 18, y: 16.5, r: 3, kind: "midtown" },
    { x: 33, y: 22, r: 3, kind: "industrial" },
  ],
  palette: {
    walls: [0x7fb3d5, 0x6fb7a8, 0xd9c29a, 0xf5f2ea, 0xb5543c, 0xc9b28a, 0x9fc5e8, 0xe8dcc4],
    roofs: [0x6d4c41, 0x8d6e63, 0x546e7a, 0xa1887f],
    trim: [0xffffff, 0x37474f, 0xd9c29a, 0x2e7d6b],
    roofTypes: ["flat", "hip", "gable"],
    grass: 0x9dbf4e,
    water: 0x4f9dd0,
    sand: 0xe6cf98,
    maxFloors: 16,
  },
  backdrop: {
    terrain: "flat",
    terrainColor: 0xc9b25a,
    skyline: [[0.4, 0.02, 0.45], [0.43, 0.025, 0.6], [0.46, 0.02, 0.75], [0.49, 0.03, 0.95], [0.52, 0.025, 0.7], [0.55, 0.02, 0.8], [0.58, 0.02, 0.5]],
    props: ["sphere-tower", "arch-bridge"],
    sea: false,
  },
  climate,
  snowInWinter: false,
  landmarks,
  vehicles: [
    { kind: "pickup", weight: 5 },
    { kind: "sedan", weight: 3.5 },
    { kind: "van", weight: 2 }, // SUVs
    { kind: "bus", weight: 0.7 },
    { kind: "police", weight: 0.3 },
  ],
  boats: [{ kind: "kayak", weight: 1 }],
  traffic: 44,
  hazards: ["storm", "heat", "snow"],
  outskirts: {
    terrain: "plains", farms: 0.5, forest: 0.15, suburbs: 12, grid: 6, beltway: true,
    features: [
      { id: "wind-farm", w: 3, d: 3, where: "rural", count: 2 },
      { id: "pumpjacks", w: 3, d: 2, where: "rural", count: 2 },
      { id: "farmstead", w: 3, d: 3, where: "rural", count: 2 },
      { id: "racetrack", w: 4, d: 3, where: "suburb" },
    ],
  },
};
