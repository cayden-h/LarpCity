// Austin: Lady Bird Lake runs east-west through the middle with three road
// bridges (the downtown avenue bridge in the center, where the bats live).
// Downtown sits on the north bank with the pink granite capitol at the head
// of the main avenue and the university campus above it; the hike-and-bike
// trail lines both shores; bungalow neighborhoods and a food-truck lot fill
// the south bank.

import { LayoutBuilder } from "../engine/layout.ts";
import type { RoadDef } from "../engine/roads/types";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

const landmarks: LandmarkPlacement[] = [
  { id: "atx-campus-tower", x: 16, y: 3, w: 2, d: 2 },
  { id: "atx-capitol", x: 16, y: 7, w: 3, d: 3 },
  { id: "atx-owl-tower", x: 27, y: 11, w: 2, d: 2 },
  { id: "atx-bat-bridge", x: 17, y: 17, w: 1, d: 3 },
  { id: "atx-food-trucks", x: 19, y: 22, w: 3, d: 3 },
];

function layout(): { layout: string[]; roads: RoadDef[] } {
  const L = new LayoutBuilder(36, 32);
  // Lady Bird Lake, wider to the east and with a cove by the park to the west.
  L.rect(0, 17, 36, 3, "w");
  L.rect(26, 16, 5, 1, "w");
  L.rect(5, 20, 4, 1, "w");
  // East-west streets; the lakeshore drives are rows 14-15 (four lanes) and 21.
  for (const y of [1, 6, 10, 21, 26, 30]) L.roadX(y, 3, 32);
  L.arterialX(14, 3, 32);
  // North-south streets. Columns 3, 17 (the main avenue), and 32 bridge the lake.
  L.roadY(3, 1, 30);
  L.roadY(32, 1, 30);
  L.roadY(17, 10, 30); // the avenue starts at the capitol's front steps
  L.roadY(10, 1, 15).roadY(10, 21, 30);
  L.arterialY(24, 1, 15).arterialY(24, 21, 30);
  L.frontage(2);
  // Hike-and-bike trail greenbelt along both shores, plus the big park to the southwest.
  L.replace(0, 16, 36, 1, "b", "p").replace(0, 16, 36, 1, ".", "p");
  L.replace(0, 20, 36, 1, "b", "p").replace(0, 20, 36, 1, ".", "p");
  L.replace(4, 22, 6, 4, "b", "p").replace(4, 22, 6, 4, ".", "p");
  // Campus lawn around the tower and a green square downtown.
  L.replace(11, 2, 5, 4, "b", "p").replace(11, 2, 5, 4, ".", "p");
  L.replace(11, 11, 3, 3, "b", "p");
  // Hill Country greenbelt on the west and east edges, a pocket park in the south.
  L.replace(0, 0, 2, 32, "b", "p").replace(0, 0, 2, 32, ".", "p");
  L.replace(34, 0, 2, 32, "b", "p").replace(34, 0, 2, 32, ".", "p");
  L.replace(0, 0, 36, 1, "b", ".").replace(0, 31, 36, 1, "b", ".");
  L.replace(26, 27, 3, 2, "b", "p");
  for (const lm of landmarks) {
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) if (L.get(i, j) !== "B" && L.get(i, j) !== "=") L.set(i, j, "P");
  }
  L.set(12, 25, "h"); // a south-side bungalow, next to the street on row 26
  L.clipCorners(3);
  const grid = L.build();
  return { layout: grid, roads: L.roads() };
}

const core = layout();

// Monthly odds per day, January first. Scorching July-August, a stormy
// spring (April-June), mild winters with a rare ice day.
const climate: Climate[] = [
  { cloudy: 0.3, rain: 0.1, storm: 0.01, snow: 0.01, fog: 0.08, heat: 0 },
  { cloudy: 0.28, rain: 0.1, storm: 0.02, snow: 0.01, fog: 0.07, heat: 0 },
  { cloudy: 0.25, rain: 0.1, storm: 0.05, snow: 0, fog: 0.05, heat: 0.02 },
  { cloudy: 0.22, rain: 0.1, storm: 0.08, snow: 0, fog: 0.03, heat: 0.05 },
  { cloudy: 0.22, rain: 0.13, storm: 0.1, snow: 0, fog: 0.02, heat: 0.12 },
  { cloudy: 0.16, rain: 0.1, storm: 0.07, snow: 0, fog: 0.01, heat: 0.3 },
  { cloudy: 0.1, rain: 0.05, storm: 0.04, snow: 0, fog: 0, heat: 0.5 },
  { cloudy: 0.1, rain: 0.05, storm: 0.04, snow: 0, fog: 0, heat: 0.55 },
  { cloudy: 0.15, rain: 0.09, storm: 0.05, snow: 0, fog: 0.01, heat: 0.3 },
  { cloudy: 0.2, rain: 0.1, storm: 0.06, snow: 0, fog: 0.03, heat: 0.08 },
  { cloudy: 0.25, rain: 0.09, storm: 0.03, snow: 0, fog: 0.06, heat: 0.01 },
  { cloudy: 0.3, rain: 0.09, storm: 0.01, snow: 0.005, fog: 0.08, heat: 0 },
];

export const austin: CityDef = {
  id: "austin",
  name: "Austin",
  state: "TX",
  tagline: "Live music, a pink granite capitol, and bats under the bridge",
  plates: "austin",
  layout: core.layout,
  roads: core.roads,
  zones: [
    // Towers sit east of the capitol, and low midtown blocks stand in front of
    // it, so the pink dome stays visible from the default camera.
    { x: 27, y: 12, r: 4.5, kind: "downtown" },
    { x: 19, y: 12, r: 3.5, kind: "midtown" },
    { x: 13, y: 3, r: 6, kind: "campus" },
    { x: 27, y: 9, r: 5, kind: "midtown" },
    { x: 6, y: 9, r: 5, kind: "midtown" },
    { x: 10, y: 27, r: 9, kind: "residential" },
    { x: 27, y: 27, r: 8, kind: "residential" },
  ],
  palette: {
    // Limestone cream, pink granite, warm brick, sage, turquoise accents.
    walls: [0xefe3c6, 0xd9927f, 0xb8654a, 0xe6d3ab, 0xa9b89a, 0xf2c6a8, 0x7fc8c0],
    roofs: [0xa8472f, 0x6d4c41, 0x7e8f73, 0x5b6b73],
    trim: [0xffffff, 0x3a9e98, 0xf2b134, 0x6d4c41],
    roofTypes: ["gable", "hip", "flat", "terrace"],
    grass: 0x79b84e,
    water: 0x4fb0c6,
    sand: 0xe6d6ad,
    maxFloors: 14,
  },
  backdrop: {
    terrain: "hills",
    terrainColor: 0x7aa860,
    skyline: [[0.4, 0.02, 0.45], [0.43, 0.025, 0.62], [0.46, 0.02, 0.85], [0.52, 0.025, 0.58], [0.55, 0.02, 0.7], [0.58, 0.02, 0.5]],
    props: ["dome"],
    sea: false,
  },
  climate,
  snowInWinter: false,
  landmarks,
  vehicles: [
    { kind: "sedan", weight: 4 },
    { kind: "pickup", weight: 3 },
    { kind: "hatch", weight: 3 }, // hatchbacks, and stand-ins for the scooters
    { kind: "bus", weight: 0.8 },
    { kind: "police", weight: 0.2 },
  ],
  boats: [
    { kind: "kayak", weight: 4 },
    { kind: "speedboat", weight: 1.5 }, // paddle boats
    { kind: "sailboat", weight: 1.2 },
  ],
  traffic: 36,
  hazards: ["heat", "storm", "smoke"],
  outskirts: {
    terrain: "hills", farms: 0.25, forest: 0.4, suburbs: 10, grid: 6, beltway: true,
    features: [
      { id: "music-row", w: 3, d: 1, where: "suburb" },
      { id: "orchard", w: 3, d: 3, where: "rural", count: 2 },
      { id: "farmstead", w: 3, d: 3, where: "rural" },
    ],
  },
};
