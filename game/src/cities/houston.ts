// Houston, the home base (Rice University). Buffalo Bayou winds through the
// middle, the Ship Channel runs along the east edge with a cable-stayed
// bridge to the port, downtown towers in the north, Rice and Hermann Park in
// the southwest, the domed stadium and the space center in the south.

import { LayoutBuilder } from "../engine/layout.ts";
import type { RoadDef } from "../engine/roads/types";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

const landmarks: LandmarkPlacement[] = [
  { id: "beacon-tower", x: 15, y: 3, w: 2, d: 2 },
  { id: "refinery", x: 27, y: 3, w: 3, d: 4 },
  { id: "lovett-hall", x: 3, y: 22, w: 4, d: 2 },
  { id: "astrodome", x: 15, y: 27, w: 4, d: 3 },
  { id: "space-rocket", x: 27, y: 27, w: 2, d: 2 },
  { id: "ship-channel-bridge", x: 30, y: 20, w: 4, d: 1 },
];

function layout(): { layout: string[]; roads: RoadDef[] } {
  const L = new LayoutBuilder(36, 32);
  L.rect(30, 0, 4, 32, "w"); // Ship Channel
  L.path([[0, 16.5], [5, 16], [10, 17.5], [15, 16.5], [20, 17], [25, 16], [30, 16.5]], "w", 2); // Buffalo Bayou
  for (const y of [2, 14, 26]) L.roadX(y, 0, 29);
  L.roadX(20, 0, 35); // crosses the channel to the port
  L.arterialX(8, 0, 35); // four lanes across the channel to the port
  for (const x of [2, 8, 20, 26]) L.roadY(x, 0, 31);
  L.arterialY(13, 0, 31); // the main north-south avenue, west of the beacon tower
  L.roadY(34, 8, 20); // port road on the east bank
  L.frontage(2);
  // Parks: Memorial Park (west), Hermann Park (by Rice), a downtown green.
  L.replace(3, 9, 5, 5, "b", "p").replace(3, 9, 5, 5, ".", "p");
  L.replace(9, 21, 5, 5, "b", "p").replace(9, 21, 5, 5, ".", "p");
  L.replace(10, 4, 3, 3, "b", "p").replace(10, 4, 3, 3, ".", "p");
  for (const lm of landmarks) {
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) if (L.get(i, j) !== "B" && L.get(i, j) !== "=") L.set(i, j, "P");
  }
  L.set(21, 22, "h"); // the player's home, next to a road
  L.shore("~", (x, y) => (x * 7 + y * 3) % 3 !== 0);
  L.clipCorners(3);
  const grid = L.build();
  return { layout: grid, roads: L.roads() };
}

const core = layout();

// Monthly odds per day, January first. Hurricane season peaks Aug-Sep.
const climate: Climate[] = [
  { cloudy: 0.3, rain: 0.14, storm: 0.02, snow: 0.01, fog: 0.1, heat: 0 },
  { cloudy: 0.28, rain: 0.13, storm: 0.02, snow: 0.005, fog: 0.09, heat: 0 },
  { cloudy: 0.25, rain: 0.12, storm: 0.04, snow: 0, fog: 0.07, heat: 0.02 },
  { cloudy: 0.22, rain: 0.12, storm: 0.05, snow: 0, fog: 0.05, heat: 0.05 },
  { cloudy: 0.2, rain: 0.13, storm: 0.07, snow: 0, fog: 0.03, heat: 0.1 },
  { cloudy: 0.2, rain: 0.16, storm: 0.08, snow: 0, fog: 0.02, heat: 0.2 },
  { cloudy: 0.18, rain: 0.15, storm: 0.07, snow: 0, fog: 0.01, heat: 0.28 },
  { cloudy: 0.18, rain: 0.15, storm: 0.1, snow: 0, fog: 0.01, heat: 0.3 },
  { cloudy: 0.2, rain: 0.16, storm: 0.1, snow: 0, fog: 0.02, heat: 0.2 },
  { cloudy: 0.2, rain: 0.12, storm: 0.05, snow: 0, fog: 0.05, heat: 0.08 },
  { cloudy: 0.26, rain: 0.12, storm: 0.03, snow: 0, fog: 0.08, heat: 0.01 },
  { cloudy: 0.3, rain: 0.13, storm: 0.02, snow: 0.005, fog: 0.1, heat: 0 },
];

export const houston: CityDef = {
  id: "houston",
  name: "Houston",
  state: "TX",
  tagline: "Space City: bayous, refineries, and Rice University",
  plates: "houston",
  layout: core.layout,
  roads: core.roads,
  zones: [
    { x: 15, y: 5, r: 6, kind: "downtown" },
    { x: 9, y: 11, r: 5, kind: "midtown" },
    { x: 22, y: 5, r: 3, kind: "midtown" },
    { x: 28, y: 9, r: 4, kind: "industrial" },
    { x: 34.5, y: 14, r: 7, kind: "industrial" },
    { x: 5, y: 23, r: 3.5, kind: "campus" },
  ],
  palette: {
    walls: [0xd9b98f, 0xb5543c, 0xefe3c8, 0xc7cdd3, 0x9fc5e8, 0xa9c29a, 0xf4c7a1],
    roofs: [0x6d4c41, 0x8d6e63, 0x546e7a, 0xb5543c],
    trim: [0xffffff, 0x37474f, 0xf2b134, 0x2e7d32],
    roofTypes: ["gable", "hip", "flat"],
    grass: 0x6cbf4a,
    water: 0x4f9dbf,
    sand: 0xe8d7a8,
    maxFloors: 12,
  },
  backdrop: {
    terrain: "flat",
    terrainColor: 0x7cae5a,
    skyline: [[0.38, 0.02, 0.5], [0.41, 0.025, 0.7], [0.44, 0.02, 0.6], [0.47, 0.03, 0.9], [0.5, 0.02, 0.65], [0.53, 0.025, 0.8], [0.56, 0.02, 0.55]],
    props: ["stacks"],
    sea: false,
  },
  climate,
  snowInWinter: false,
  landmarks,
  vehicles: [
    { kind: "pickup", weight: 4 },
    { kind: "sedan", weight: 4 },
    { kind: "hatch", weight: 2 },
    { kind: "van", weight: 1.2 },
    { kind: "bus", weight: 0.8 },
    { kind: "police", weight: 0.3 },
  ],
  boats: [
    { kind: "tanker", weight: 3 },
    { kind: "tug", weight: 2 },
    { kind: "speedboat", weight: 1.5 },
    { kind: "kayak", weight: 1 },
  ],
  traffic: 42,
  hazards: ["storm", "heat", "rain", "fog"],
  outskirts: {
    terrain: "plains", farms: 0.3, forest: 0.3, suburbs: 12, grid: 6, beltway: true,
    features: [
      { id: "pumpjacks", w: 3, d: 2, where: "rural", count: 2 },
      { id: "power-plant", w: 3, d: 3, where: "rural" },
      { id: "farmstead", w: 3, d: 3, where: "rural", count: 2 },
    ],
  },
};
