// Miami: Brickell and downtown glass condo towers on the mainland (west),
// Biscayne Bay in the middle crossed by two causeways, the cruise port on its
// own island in the bay, and Miami Beach on a long barrier island (east) with
// a pastel Art Deco hotel strip facing the sand and the open Atlantic.

import { LayoutBuilder } from "../engine/layout";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";

// Column plan (x): mainland 0-13, bay 14-22 (port island 16-20), barrier
// island 23-30 (road at 25, hotels 26-27, beach 28-30), ocean 31-35.
const landmarks: LandmarkPlacement[] = [
  { id: "mia-condo-towers", x: 12, y: 13, w: 2, d: 4 },
  { id: "mia-cruise-terminal", x: 16, y: 3, w: 5, d: 2 },
  { id: "mia-deco-hotels", x: 26, y: 7, w: 2, d: 12 },
  { id: "mia-lifeguard-towers", x: 29, y: 3, w: 1, d: 24 },
  // Palms: on the beach, along the bayfront, and on the port island.
  ...([
    [28, 2], [28, 5], [28, 20], [28, 23], [28, 27],
    [13, 19], [13, 21], [13, 23], [19, 7], [23, 13], [23, 25],
  ] as const).map(([x, y]) => ({ id: "mia-palms", x, y, w: 1, d: 1 })),
];

function layout(): string[] {
  const L = new LayoutBuilder(36, 32);
  L.rect(14, 0, 9, 32, "w"); // Biscayne Bay
  L.rect(31, 0, 5, 32, "w"); // Atlantic Ocean
  L.rect(16, 3, 5, 6, "P"); // port island, paved apron
  L.rect(28, 0, 2, 32, "s"); // Miami Beach sand (the waterline row comes from shore())

  // Mainland grid.
  for (const y of [2, 18, 29]) L.roadX(y, 0, 11);
  for (const x of [2, 6, 11]) L.roadY(x, 0, 31);
  // Two causeways from the mainland across the bay to the island spine.
  for (const y of [12, 24]) L.roadX(y, 0, 25);
  // Port Boulevard: mainland -> bridge -> port island -> bridge down to the north causeway.
  L.roadX(6, 0, 18);
  L.roadY(18, 6, 12);
  // Collins-style spine down the barrier island.
  L.roadY(25, 0, 31);

  L.frontage(2);
  // Bayfront park on the mainland shore and a neighborhood park inland.
  L.rect(12, 7, 2, 5, "p");
  L.replace(3, 25, 3, 3, "b", "p").replace(3, 25, 3, 3, ".", "p");
  // Landmark land is paved plaza; beach landmarks keep their sand.
  for (const lm of landmarks)
    for (let j = lm.y; j < lm.y + lm.d; j++)
      for (let i = lm.x; i < lm.x + lm.w; i++) {
        const c = L.get(i, j);
        if (c !== "B" && c !== "=" && c !== "w" && c !== "s") L.set(i, j, "P");
      }
  L.set(3, 20, "h"); // the player's home, on the road at x = 2
  L.shore("s", (x) => x >= 28);
  L.clipCorners(3);
  return L.build();
}

// Monthly odds per day, January first. Dry, mild winters; a wet season of
// near-daily afternoon storms from June to September; hurricane risk peaking
// August to October. Never snows.
const climate: Climate[] = [
  { cloudy: 0.25, rain: 0.08, storm: 0.01, snow: 0, fog: 0.04, heat: 0.01 },
  { cloudy: 0.24, rain: 0.07, storm: 0.01, snow: 0, fog: 0.03, heat: 0.02 },
  { cloudy: 0.24, rain: 0.08, storm: 0.02, snow: 0, fog: 0.02, heat: 0.04 },
  { cloudy: 0.22, rain: 0.09, storm: 0.03, snow: 0, fog: 0.01, heat: 0.07 },
  { cloudy: 0.24, rain: 0.17, storm: 0.05, snow: 0, fog: 0.01, heat: 0.12 },
  { cloudy: 0.2, rain: 0.28, storm: 0.07, snow: 0, fog: 0, heat: 0.17 },
  { cloudy: 0.18, rain: 0.26, storm: 0.08, snow: 0, fog: 0, heat: 0.24 },
  { cloudy: 0.18, rain: 0.26, storm: 0.14, snow: 0, fog: 0, heat: 0.22 },
  { cloudy: 0.2, rain: 0.27, storm: 0.16, snow: 0, fog: 0, heat: 0.16 },
  { cloudy: 0.22, rain: 0.18, storm: 0.11, snow: 0, fog: 0.01, heat: 0.07 },
  { cloudy: 0.24, rain: 0.1, storm: 0.03, snow: 0, fog: 0.02, heat: 0.03 },
  { cloudy: 0.25, rain: 0.08, storm: 0.01, snow: 0, fog: 0.03, heat: 0.01 },
];

export const miami: CityDef = {
  id: "miami",
  name: "Miami",
  state: "FL",
  tagline: "Magic City: Art Deco pastels, Biscayne Bay, and the cruise capital",
  plates: "miami",
  layout: layout(),
  zones: [
    { x: 7, y: 8, r: 5, kind: "downtown" }, // downtown
    { x: 8, y: 15, r: 4, kind: "downtown" }, // Brickell
    { x: 6, y: 22, r: 4, kind: "midtown" }, // Little Havana
    { x: 25, y: 3, r: 4, kind: "midtown" }, // North Beach
    { x: 25, y: 28, r: 4, kind: "midtown" }, // South Beach
  ],
  palette: {
    // Pastel pink, mint, butter yellow, sky blue, lilac, white, peach.
    walls: [0xf8bbd0, 0xb2f0dc, 0xfff1a8, 0xb3e5fc, 0xd9c8f0, 0xfafafa, 0xffd3bf],
    roofs: [0xf5f5f5, 0xe0e0e0, 0x80cbc4, 0xf48fb1],
    trim: [0xffffff, 0x26a69a, 0xf06292, 0xffb74d, 0x9575cd],
    roofTypes: ["flat", "flat", "terrace", "hip"],
    grass: 0x5cc24a,
    water: 0x2ab3c9,
    sand: 0xf3e3b8,
    maxFloors: 18,
  },
  backdrop: {
    terrain: "coast",
    terrainColor: 0x4f9f4a,
    skyline: [[0.3, 0.02, 0.45], [0.34, 0.025, 0.6], [0.38, 0.02, 0.5], [0.42, 0.03, 0.75], [0.46, 0.02, 0.55], [0.5, 0.025, 0.65], [0.55, 0.02, 0.4]],
    props: ["palms"],
    sea: true,
  },
  climate,
  snowInWinter: false,
  landmarks,
  vehicles: [
    { kind: "convertible", weight: 3 },
    { kind: "sedan", weight: 4 },
    { kind: "taxi", weight: 2 },
    { kind: "bus", weight: 1 },
  ],
  boats: [
    { kind: "cruise", weight: 2 },
    { kind: "speedboat", weight: 2.5 },
    { kind: "sailboat", weight: 2 },
    { kind: "ferry", weight: 1 },
  ],
  traffic: 40,
  hazards: ["storm", "rain", "heat"],
  outskirts: {
    terrain: "swamp", farms: 0.12, forest: 0.15, suburbs: 10, grid: 6, beltway: true,
    features: [
      { id: "orchard", w: 3, d: 3, where: "rural", count: 2 },
      { id: "fishing-harbor", w: 3, d: 2, where: "coast", count: 2 },
    ],
  },
};
