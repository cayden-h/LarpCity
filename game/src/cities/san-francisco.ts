// San Francisco. The Pacific and the Golden Gate strait run down the west
// edge with the red suspension bridge crossing to the Marin headlands, the
// bay wraps the north shore with the island prison offshore, downtown towers
// cluster in the northeast, a cable car line climbs straight up from the
// waterfront, Golden Gate Park stretches across the west side, and the
// painted Victorian row faces Alamo Square in the southeast.

import { LayoutBuilder } from "../engine/layout";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

const landmarks: LandmarkPlacement[] = [
  { id: "sf-golden-gate", x: 4, y: 12, w: 5, d: 1 },
  { id: "sf-island-prison", x: 23, y: 1, w: 3, d: 3 },
  { id: "sf-coit-tower", x: 18, y: 8, w: 2, d: 2 },
  { id: "sf-pyramid-tower", x: 25, y: 8, w: 2, d: 2 },
  { id: "sf-glass-tower", x: 30, y: 13, w: 2, d: 2 },
  { id: "sf-painted-ladies", x: 29, y: 28, w: 5, d: 1 },
];

function layout(): string[] {
  const L = new LayoutBuilder(36, 32);
  L.rect(4, 0, 5, 32, "w"); // the Golden Gate strait
  L.rect(0, 21, 4, 11, "w"); // open Pacific south of the headlands
  L.rect(9, 0, 27, 6, "w"); // the bay along the north shore
  L.rect(23, 1, 3, 3, "P"); // the island prison, surrounded by bay water
  L.shore("s"); // Ocean Beach, Crissy Field, and the Marin coves
  // City grid: the Embarcadero along the bay, the bridge approach, and cross streets.
  L.roadX(6, 10, 34);
  L.roadX(12, 3, 34); // crosses the strait as the Golden Gate
  for (const y of [17, 23, 29]) L.roadX(y, 10, 34);
  for (const x of [10, 28, 34]) L.roadY(x, 6, 29);
  L.roadY(16, 6, 17).roadY(16, 23, 29); // broken by Golden Gate Park
  L.roadY(22, 6, 29, "t"); // the cable car line, bay to the southern hills
  // Marin headlands loop on the far side of the bridge.
  L.roadY(1, 8, 16).roadY(3, 8, 16).roadX(8, 1, 3).roadX(16, 1, 3);
  L.frontage(2);
  // Parks: the Marin headlands, Golden Gate Park, the Presidio, Telegraph Hill, Alamo Square.
  const park = (x: number, y: number, w: number, h: number) => L.replace(x, y, w, h, "b", "p").replace(x, y, w, h, ".", "p");
  park(0, 0, 4, 21);
  park(11, 18, 11, 5);
  park(11, 7, 5, 5);
  park(17, 7, 5, 4);
  park(29, 24, 5, 4);
  for (const lm of landmarks) {
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) if (L.get(i, j) !== "B" && L.get(i, j) !== "=") L.set(i, j, "P");
  }
  L.set(11, 25, "h"); // the player's home in the Sunset, next to a road
  L.clipCorners(3);
  return L.build();
}

// Monthly odds per day, January first. Winter is the rainy season; summer is
// fog season, when the marine layer pours through the Gate most mornings.
// September and October bring the rare hot spells. Wildfire smoke arrives
// through the "smoke" hazard event, since Climate has no smoke odds.
const climate: Climate[] = [
  { cloudy: 0.3, rain: 0.28, storm: 0.03, snow: 0, fog: 0.1, heat: 0 },
  { cloudy: 0.3, rain: 0.26, storm: 0.03, snow: 0, fog: 0.1, heat: 0 },
  { cloudy: 0.3, rain: 0.2, storm: 0.02, snow: 0, fog: 0.12, heat: 0 },
  { cloudy: 0.28, rain: 0.1, storm: 0.01, snow: 0, fog: 0.18, heat: 0 },
  { cloudy: 0.25, rain: 0.04, storm: 0, snow: 0, fog: 0.3, heat: 0.01 },
  { cloudy: 0.2, rain: 0.02, storm: 0, snow: 0, fog: 0.4, heat: 0.02 },
  { cloudy: 0.18, rain: 0.01, storm: 0, snow: 0, fog: 0.5, heat: 0.01 },
  { cloudy: 0.18, rain: 0.01, storm: 0, snow: 0, fog: 0.48, heat: 0.02, smoke: 0.04 },
  { cloudy: 0.16, rain: 0.02, storm: 0.01, snow: 0, fog: 0.3, heat: 0.08, smoke: 0.06 },
  { cloudy: 0.18, rain: 0.06, storm: 0.01, snow: 0, fog: 0.18, heat: 0.06, smoke: 0.05 },
  { cloudy: 0.25, rain: 0.16, storm: 0.02, snow: 0, fog: 0.12, heat: 0.01 },
  { cloudy: 0.3, rain: 0.26, storm: 0.03, snow: 0, fog: 0.1, heat: 0 },
];

export const sanFrancisco: CityDef = {
  id: "san-francisco",
  name: "San Francisco",
  state: "CA",
  tagline: "Fog, cable cars, and the Golden Gate",
  plates: "san-francisco",
  layout: layout(),
  zones: [
    { x: 29, y: 11, r: 6, kind: "downtown" },
    { x: 20, y: 14, r: 4, kind: "midtown" },
    { x: 28, y: 20, r: 4, kind: "midtown" },
    { x: 13, y: 26, r: 7, kind: "residential" },
    { x: 24, y: 26, r: 5, kind: "residential" },
    { x: 1.5, y: 12, r: 4, kind: "residential" },
  ],
  palette: {
    // Victorian pastels: pink, mint, butter yellow, sky blue, white, peach, lavender.
    walls: [0xf6b8c8, 0xbfe6d0, 0xfbe7a1, 0xaed6f1, 0xfafafa, 0xf8cfa8, 0xd9c8ec],
    roofs: [0x5b6770, 0x6d4c41, 0x8d9ba5, 0x37474f],
    trim: [0xffffff, 0xfafafa, 0x37474f, 0xc8452f],
    roofTypes: ["gable", "flat", "gable"],
    grass: 0x6cb04a,
    water: 0x3f97cf,
    sand: 0xe9dcb8,
    maxFloors: 14,
  },
  backdrop: {
    terrain: "hills",
    terrainColor: 0x76a35a,
    skyline: [[0.62, 0.02, 0.45], [0.645, 0.025, 0.6], [0.67, 0.015, 0.9], [0.69, 0.02, 0.55], [0.71, 0.025, 0.5]],
    props: ["suspension-bridge", "pines"],
    sea: true,
  },
  climate,
  snowInWinter: false,
  landmarks,
  vehicles: [
    { kind: "sedan", weight: 4 },
    { kind: "hatch", weight: 3 },
    { kind: "taxi", weight: 1.5 },
    { kind: "cable-car", weight: 1.2 },
    { kind: "bus", weight: 1 },
    { kind: "van", weight: 0.8 },
    { kind: "police", weight: 0.3 },
  ],
  boats: [
    { kind: "ferry", weight: 3 },
    { kind: "sailboat", weight: 3 },
    { kind: "tug", weight: 1 },
  ],
  traffic: 38,
  hazards: ["fog", "smoke", "rain"],
  outskirts: {
    terrain: "hills", farms: 0.15, forest: 0.4, suburbs: 10, grid: 6, beltway: false,
    features: [
      { id: "wind-farm", w: 3, d: 3, where: "rural", count: 2 },
      { id: "orchard", w: 3, d: 3, where: "rural", count: 2 },
      { id: "mountain", w: 3, d: 3, where: "edge", count: 3 },
      { id: "fishing-harbor", w: 3, d: 2, where: "coast" },
    ],
  },
};
