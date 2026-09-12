// What makes each non-specialized state its own place: terrain, water, street
// grid, how dense the city is, and signature features (wind farms, oil wells,
// lighthouses, ski lifts, riverboats...). The regional template supplies the
// palette and climate; the vibe decides the shape of the world.

import type { FeatureSite, FeatureSpec, Terrain } from "../engine/types";

export type WaterShape = "river" | "wide-river" | "lake" | "coast" | "none";
export type Side = "north" | "south" | "east" | "west";

export interface StateVibe {
  terrain: Terrain;
  water: WaterShape;
  coastSide?: Side;
  /** Street spacing in tiles (5 dense old town, 7 spread-out). */
  grid: number;
  /** City size and height multiplier (0.6 small town, 1.3 big city). */
  density: number;
  farms: number;
  forest: number;
  features: FeatureSpec[];
  tagline: string;
  /** Extra wall colors mixed into the template palette. */
  accents?: number[];
}

const SIZE: Record<string, [number, number]> = {
  "wind-farm": [3, 3], pumpjacks: [3, 2], farmstead: [3, 3], "power-plant": [3, 3], racetrack: [4, 3],
  mountain: [3, 3], "ski-lift": [3, 4], "adobe-mission": [2, 2], "saguaro-garden": [2, 2], volcano: [4, 4], "glacier-harbor": [3, 3],
  riverboat: [3, 1], "casino-strip": [4, 2], "ferris-wheel": [2, 2], "fishing-harbor": [3, 2], "music-row": [3, 1], monument: [2, 2], orchard: [3, 3],
  lighthouse: [1, 1], "grain-elevator": [3, 2], steeple: [1, 1],
};

const SITE: Record<string, FeatureSite> = {
  "wind-farm": "rural", pumpjacks: "rural", farmstead: "rural", "power-plant": "rural", racetrack: "suburb",
  mountain: "edge", "ski-lift": "edge", "adobe-mission": "core", "saguaro-garden": "rural", volcano: "edge", "glacier-harbor": "coast",
  riverboat: "water", "casino-strip": "core", "ferris-wheel": "coast", "fishing-harbor": "coast", "music-row": "core", monument: "core", orchard: "rural",
  lighthouse: "coast", "grain-elevator": "rural", steeple: "core",
};

/** "wind-farm*3" means three wind farms. */
function f(...items: string[]): FeatureSpec[] {
  return items.map((item) => {
    const [id, n] = item.split("*");
    const [w, d] = SIZE[id];
    return { id, w, d, where: SITE[id], count: n ? Number(n) : 1 };
  });
}

type Opts = Partial<Omit<StateVibe, "terrain" | "water" | "features" | "tagline">>;

function v(terrain: Terrain, water: WaterShape, features: FeatureSpec[], tagline: string, opts: Opts = {}): StateVibe {
  return { terrain, water, grid: 6, density: 1, farms: 0.3, forest: 0.3, features, tagline, ...opts };
}

export const VIBES: Record<string, StateVibe> = {
  AL: v("forest", "river", f("farmstead*2", "orchard"), "Pine woods, cotton fields, and a slow river", { forest: 0.45 }),
  AK: v("tundra", "coast", f("glacier-harbor", "fishing-harbor", "mountain*5"), "Glaciers, fishing boats, and mountains to the water", { coastSide: "west", density: 0.6, farms: 0 }),
  AZ: v("desert", "none", f("saguaro-garden*4", "adobe-mission", "mountain*3"), "Desert sprawl, saguaros, and red mountains", { density: 1.1, farms: 0.05, forest: 0, accents: [0xe7a26b, 0xd98b5f] }),
  AR: v("forest", "river", f("farmstead", "riverboat"), "Ozark woods along the Arkansas River", { forest: 0.5 }),
  CO: v("mountains", "lake", f("ski-lift", "mountain*6"), "Mile-high city under snowy peaks", { farms: 0.15, forest: 0.35 }),
  CT: v("hills", "river", f("steeple", "orchard"), "Insurance towers and New England greens", { grid: 5, forest: 0.4 }),
  DE: v("plains", "coast", f("farmstead*2", "fishing-harbor", "lighthouse"), "Farm fields down to the bay", { coastSide: "east", density: 0.75, farms: 0.5 }),
  DC: v("plains", "wide-river", f("monument", "steeple"), "Monuments on the Potomac", { density: 1.2, grid: 5, farms: 0.05, forest: 0.3 }),
  GA: v("forest", "river", f("orchard*2", "farmstead"), "Peach orchards and a leafy skyline", { density: 1.2, forest: 0.4 }),
  HI: v("island", "coast", f("volcano", "fishing-harbor", "lighthouse"), "Volcano, surf, and island breezes", { coastSide: "south", farms: 0.1, forest: 0.5 }),
  ID: v("mountains", "river", f("farmstead*2", "ski-lift", "mountain*3"), "River city between farms and foothills", { farms: 0.45 }),
  IL: v("plains", "river", f("wind-farm*2", "farmstead*2", "grain-elevator"), "Prairie capital ringed by corn and wind", { farms: 0.65, forest: 0.1 }),
  IN: v("plains", "river", f("racetrack", "farmstead*2", "grain-elevator"), "Crossroads of America and a famous oval", { farms: 0.6, forest: 0.15 }),
  IA: v("plains", "river", f("farmstead*3", "wind-farm*2", "grain-elevator"), "Corn country and wind turbines", { farms: 0.75, forest: 0.08, density: 0.85 }),
  KS: v("plains", "river", f("wind-farm*2", "grain-elevator*2", "farmstead"), "Wheat, wind, and wide skies", { farms: 0.75, forest: 0.05, density: 0.8 }),
  KY: v("hills", "river", f("racetrack", "farmstead*2", "riverboat"), "Bluegrass horse farms on the Kentucky River", { farms: 0.45, density: 0.75 }),
  LA: v("swamp", "wide-river", f("riverboat*2", "pumpjacks", "music-row"), "Bayous, riverboats, and jazz", { farms: 0.15, forest: 0.35 }),
  ME: v("forest", "coast", f("lighthouse*2", "fishing-harbor*2"), "Lighthouses, lobster boats, and pines", { coastSide: "east", density: 0.7, forest: 0.55, farms: 0.1 }),
  MD: v("forest", "coast", f("fishing-harbor*2", "lighthouse", "ferris-wheel"), "Sailboats and crab shacks on the bay", { coastSide: "east", grid: 5 }),
  MA: v("hills", "coast", f("fishing-harbor", "lighthouse", "steeple"), "Brick lanes, a busy harbor, and old steeples", { coastSide: "east", density: 1.25, grid: 5, accents: [0x9c4a36] }),
  MI: v("forest", "lake", f("lighthouse", "power-plant", "farmstead"), "Great Lakes shores and factory towns", { forest: 0.4 }),
  MN: v("forest", "lake", f("wind-farm", "farmstead*2"), "Land of lakes and long winters", { forest: 0.4, farms: 0.35 }),
  MS: v("swamp", "wide-river", f("riverboat", "farmstead*2"), "Delta farms and a lazy river", { farms: 0.4, density: 0.75 }),
  MO: v("hills", "wide-river", f("riverboat", "farmstead*2", "power-plant"), "Missouri River bluffs and farm country", { farms: 0.4 }),
  MT: v("mountains", "river", f("mountain*6", "farmstead", "ski-lift"), "Big Sky ranches under the Rockies", { density: 0.6, farms: 0.3 }),
  NE: v("plains", "none", f("farmstead*3", "grain-elevator*2", "wind-farm"), "Cornhusker fields to the horizon", { farms: 0.8, forest: 0.05, density: 0.8 }),
  NV: v("desert", "none", f("casino-strip", "mountain*4"), "A neon strip in the desert", { density: 1.25, farms: 0, forest: 0, accents: [0xf8bbd0, 0xb39ddb] }),
  NH: v("forest", "lake", f("steeple", "ski-lift", "mountain*2"), "Granite hills, ski slopes, and steeples", { density: 0.65, forest: 0.55 }),
  NJ: v("plains", "coast", f("ferris-wheel", "power-plant", "farmstead"), "Boardwalks, turnpikes, and garden farms", { coastSide: "east", density: 1.15, grid: 5 }),
  NM: v("desert", "none", f("adobe-mission*2", "mountain*3", "saguaro-garden"), "Adobe plazas and high desert", { density: 0.75, farms: 0.05, forest: 0.05, accents: [0xd9a47a, 0xc98b6b] }),
  NC: v("forest", "river", f("orchard", "farmstead", "power-plant"), "Research parks among the pines", { forest: 0.45 }),
  ND: v("plains", "wide-river", f("pumpjacks*3", "wind-farm*2", "grain-elevator"), "Oil wells, wheat, and wind", { farms: 0.6, forest: 0.03, density: 0.65 }),
  OH: v("plains", "river", f("farmstead*2", "power-plant", "racetrack"), "Rust Belt grit and farm towns", { density: 1.1, farms: 0.5 }),
  OK: v("plains", "river", f("pumpjacks*3", "wind-farm*2"), "Oil derricks and prairie wind", { farms: 0.45, forest: 0.1 }),
  OR: v("forest", "river", f("mountain*3", "orchard", "farmstead"), "Evergreen valleys and orchards", { forest: 0.55 }),
  PA: v("hills", "wide-river", f("power-plant*2", "steeple", "farmstead"), "River towns, steel, and farm country", { farms: 0.35, forest: 0.4 }),
  RI: v("hills", "coast", f("lighthouse*2", "fishing-harbor", "steeple"), "A tiny state with a big harbor", { coastSide: "south", density: 1.1, grid: 5 }),
  SC: v("swamp", "river", f("orchard", "farmstead"), "Palmettos, peaches, and rivers", { forest: 0.4 }),
  SD: v("hills", "wide-river", f("grain-elevator", "mountain*3", "farmstead"), "The Missouri River and the Black Hills", { density: 0.6, farms: 0.5 }),
  TN: v("hills", "river", f("music-row", "riverboat", "farmstead"), "Music Row and the Cumberland River", { density: 1.1, forest: 0.4 }),
  UT: v("mountains", "lake", f("ski-lift", "mountain*6"), "Salt flats below snowy ski peaks", { farms: 0.1, forest: 0.15, accents: [0xe0c9a6] }),
  VT: v("forest", "river", f("steeple", "ski-lift", "farmstead*2"), "Maple woods, dairy farms, and ski hills", { density: 0.55, forest: 0.55, farms: 0.3 }),
  VA: v("hills", "river", f("steeple", "orchard", "farmstead"), "A historic river city and rolling farms", { forest: 0.4, farms: 0.35 }),
  WA: v("forest", "coast", f("fishing-harbor", "ferris-wheel", "mountain*3", "lighthouse"), "Puget Sound ferries and evergreen peaks", { coastSide: "west", forest: 0.55 }),
  WV: v("mountains", "river", f("power-plant", "mountain*5", "riverboat"), "Mountain hollows and a winding river", { density: 0.65, forest: 0.6, farms: 0.1 }),
  WI: v("forest", "lake", f("farmstead*3", "wind-farm"), "Lakes, dairy barns, and cheese country", { farms: 0.55, forest: 0.3 }),
  WY: v("plains", "none", f("pumpjacks*2", "wind-farm*2", "mountain*4", "farmstead"), "A rodeo town where the plains meet the Rockies", { density: 0.55, farms: 0.2, forest: 0.1 }),
};

export const DEFAULT_VIBE: StateVibe = v("plains", "river", f("farmstead"), "A state capital", {});
