// Regional templates: every state without a hand-made city gets one. The
// region supplies palette, climate, vehicles, and landmark flavor; the
// state's vibe (vibes.ts) shapes the core (water, grid, size, density) and
// the world around it (terrain, farms, forest, signature features).

import { LayoutBuilder } from "../engine/layout";
import { hashKeys, rngFor } from "../engine/rng";
import type { BackdropDef, BoatKind, CityDef, CityPalette, Climate, LandmarkPlacement, StateInfo, VehicleKind, WeatherKind } from "../engine/types";
import { DEFAULT_VIBE, VIBES, type Side, type StateVibe } from "./vibes";

interface TemplateStyle {
  shore: "s" | "~" | ".";
  palette: CityPalette;
  climate: Climate[];
  snowInWinter: boolean;
  backdrop: BackdropDef;
  dome: string;
  vehicles: { kind: VehicleKind; weight: number }[];
  boats: { kind: BoatKind; weight: number }[];
  hazards: WeatherKind[];
}

/**
 * Twelve months from a winter and a summer profile, blended by season.
 * `fireSeason` adds wildfire smoke odds from August through October.
 */
function climateOf(winter: Climate, summer: Climate, fireSeason = 0): Climate[] {
  return Array.from({ length: 12 }, (_, m) => {
    const k = (1 - Math.cos(((m - 0.5) / 12) * Math.PI * 2)) / 2; // 0 in Jan, 1 in Jul
    const blend = (a: number, b: number) => +(a + (b - a) * k).toFixed(3);
    return {
      cloudy: blend(winter.cloudy, summer.cloudy),
      rain: blend(winter.rain, summer.rain),
      storm: blend(winter.storm, summer.storm),
      snow: blend(winter.snow, summer.snow),
      fog: blend(winter.fog, summer.fog),
      heat: blend(winter.heat, summer.heat),
      smoke: m >= 7 && m <= 9 ? fireSeason : 0,
    };
  });
}

const CARS = [
  { kind: "sedan" as const, weight: 4 },
  { kind: "hatch" as const, weight: 3 },
  { kind: "pickup" as const, weight: 2 },
  { kind: "van" as const, weight: 1 },
  { kind: "bus" as const, weight: 0.7 },
];

const HOMES = { roofs: [0x6d4c41, 0x546e7a, 0x8d6e63, 0x37474f], trim: [0xffffff, 0x37474f, 0xf2b134] };

export const TEMPLATES: Record<string, TemplateStyle> = {
  "pacific-coast": {
    shore: "s",
    palette: { walls: [0x8fb3a3, 0xc9d6df, 0x7d9bb0, 0xe8e2d0, 0xa1887f], ...HOMES, roofTypes: ["gable", "gable", "hip"], grass: 0x4f9a4a, water: 0x3f8c9c, sand: 0xd8cfb8, maxFloors: 9 },
    climate: climateOf({ cloudy: 0.45, rain: 0.35, storm: 0.02, snow: 0.02, fog: 0.12, heat: 0 }, { cloudy: 0.25, rain: 0.05, storm: 0, snow: 0, fog: 0.08, heat: 0.05 }, 0.05),
    snowInWinter: false,
    backdrop: { terrain: "mountains", terrainColor: 0x3f6f4f, skyline: [], props: [], sea: true },
    dome: "silver",
    vehicles: CARS, boats: [{ kind: "ferry", weight: 2 }, { kind: "sailboat", weight: 2 }, { kind: "tug", weight: 1 }],
    hazards: ["rain", "fog", "smoke"],
  },
  "desert-southwest": {
    shore: "s",
    palette: { walls: [0xe0b08a, 0xd9c2a3, 0xc98b6b, 0xf0dcc0, 0xb97a57], ...HOMES, roofTypes: ["flat", "flat", "hip"], grass: 0xb9b36a, water: 0x4aa3c9, sand: 0xe7c9a0, maxFloors: 10 },
    climate: climateOf({ cloudy: 0.15, rain: 0.04, storm: 0.01, snow: 0.01, fog: 0, heat: 0.02 }, { cloudy: 0.12, rain: 0.05, storm: 0.05, snow: 0, fog: 0, heat: 0.45 }, 0.02),
    snowInWinter: false,
    backdrop: { terrain: "mesas", terrainColor: 0xc0704a, skyline: [], props: [], sea: false },
    dome: "copper",
    vehicles: CARS, boats: [],
    hazards: ["heat", "smoke", "storm"],
  },
  "mountain-west": {
    shore: ".",
    palette: { walls: [0xa1887f, 0xd7ccc8, 0x8d6e63, 0xbcaaa4, 0xcfd8dc], ...HOMES, roofTypes: ["gable", "gable", "hip"], grass: 0x6aa84f, water: 0x3d8fc2, sand: 0xd8cfb8, maxFloors: 10 },
    climate: climateOf({ cloudy: 0.3, rain: 0.02, storm: 0, snow: 0.2, fog: 0.03, heat: 0 }, { cloudy: 0.2, rain: 0.08, storm: 0.06, snow: 0, fog: 0.01, heat: 0.12 }, 0.04),
    snowInWinter: true,
    backdrop: { terrain: "mountains", terrainColor: 0x6d7f8f, skyline: [], props: [], sea: false },
    dome: "gold",
    vehicles: CARS, boats: [{ kind: "kayak", weight: 2 }, { kind: "sailboat", weight: 1 }],
    hazards: ["snow", "smoke", "heat"],
  },
  "great-plains": {
    shore: ".",
    palette: { walls: [0xc62828, 0xefe3c8, 0xd7ccc8, 0x90a4ae, 0xf4c7a1], ...HOMES, roofTypes: ["gable", "hip", "flat"], grass: 0x8fbf4a, water: 0x5b8fa8, sand: 0xd8cfb8, maxFloors: 8 },
    climate: climateOf({ cloudy: 0.3, rain: 0.03, storm: 0.01, snow: 0.15, fog: 0.04, heat: 0 }, { cloudy: 0.18, rain: 0.1, storm: 0.1, snow: 0, fog: 0.01, heat: 0.25 }),
    snowInWinter: true,
    backdrop: { terrain: "flat", terrainColor: 0xd9b25a, skyline: [], props: [], sea: false },
    dome: "silver",
    vehicles: [...CARS, { kind: "pickup", weight: 4 }], boats: [{ kind: "kayak", weight: 1 }],
    hazards: ["storm", "snow", "heat"],
  },
  "great-lakes": {
    shore: "s",
    palette: { walls: [0xb5543c, 0x9c4a36, 0xd7ccc8, 0xefe3c8, 0x8d6e63], ...HOMES, roofTypes: ["gable", "flat", "hip"], grass: 0x5fb04a, water: 0x3f86c6, sand: 0xe4d6b0, maxFloors: 12 },
    climate: climateOf({ cloudy: 0.45, rain: 0.03, storm: 0, snow: 0.25, fog: 0.05, heat: 0 }, { cloudy: 0.22, rain: 0.12, storm: 0.06, snow: 0, fog: 0.03, heat: 0.12 }),
    snowInWinter: true,
    backdrop: { terrain: "flat", terrainColor: 0x5f8f4a, skyline: [], props: [], sea: true },
    dome: "silver",
    vehicles: CARS, boats: [{ kind: "sailboat", weight: 2 }, { kind: "ferry", weight: 1 }, { kind: "speedboat", weight: 1 }],
    hazards: ["snow", "storm", "rain"],
  },
  northeast: {
    shore: ".",
    palette: { walls: [0xb5543c, 0xfafafa, 0x9c4a36, 0xe0d6c2, 0x6d8fa3], ...HOMES, roofTypes: ["gable", "gable", "hip"], grass: 0x5fa84a, water: 0x4a86b5, sand: 0xd8cfb8, maxFloors: 12 },
    climate: climateOf({ cloudy: 0.4, rain: 0.06, storm: 0.01, snow: 0.2, fog: 0.05, heat: 0 }, { cloudy: 0.25, rain: 0.12, storm: 0.05, snow: 0, fog: 0.04, heat: 0.1 }),
    snowInWinter: true,
    backdrop: { terrain: "hills", terrainColor: 0x5f8f4a, skyline: [], props: [], sea: false },
    dome: "gold",
    vehicles: CARS, boats: [{ kind: "sailboat", weight: 1 }, { kind: "kayak", weight: 1 }],
    hazards: ["snow", "storm", "rain"],
  },
  southeast: {
    shore: "~",
    palette: { walls: [0xfafafa, 0xefe3c8, 0xb5543c, 0xf4c7a1, 0xc8e6c9], ...HOMES, roofTypes: ["hip", "gable", "flat"], grass: 0x5fb04a, water: 0x5c9aa0, sand: 0xe0cfa0, maxFloors: 10 },
    climate: climateOf({ cloudy: 0.3, rain: 0.12, storm: 0.02, snow: 0.01, fog: 0.08, heat: 0 }, { cloudy: 0.22, rain: 0.15, storm: 0.08, snow: 0, fog: 0.03, heat: 0.25 }),
    snowInWinter: false,
    backdrop: { terrain: "hills", terrainColor: 0x4f7f3f, skyline: [], props: [], sea: false },
    dome: "white",
    vehicles: [...CARS, { kind: "pickup", weight: 2 }], boats: [{ kind: "tug", weight: 1 }, { kind: "speedboat", weight: 1 }],
    hazards: ["storm", "heat", "rain"],
  },
  island: {
    shore: "s",
    palette: { walls: [0xfafafa, 0xffe0b2, 0xb2dfdb, 0xf8bbd0, 0xfff9c4], ...HOMES, roofTypes: ["hip", "flat"], grass: 0x5cc24a, water: 0x2ab3c9, sand: 0xf3e3b8, maxFloors: 14 },
    climate: climateOf({ cloudy: 0.3, rain: 0.18, storm: 0.02, snow: 0, fog: 0.02, heat: 0.02 }, { cloudy: 0.25, rain: 0.1, storm: 0.03, snow: 0, fog: 0, heat: 0.1 }),
    snowInWinter: false,
    backdrop: { terrain: "hills", terrainColor: 0x3f8f4a, skyline: [], props: [], sea: true },
    dome: "copper",
    vehicles: [...CARS, { kind: "convertible", weight: 2 }], boats: [{ kind: "sailboat", weight: 2 }, { kind: "cruise", weight: 1 }, { kind: "kayak", weight: 1 }],
    hazards: ["storm", "rain"],
  },
};

export const DOME_COLORS: Record<string, number> = { gold: 0xe0b43c, silver: 0xb0bec5, copper: 0x5fae8f, white: 0xf5f5f5 };

export function templateCity(state: StateInfo): CityDef {
  const style = TEMPLATES[state.cityId] ?? TEMPLATES.southeast;
  const vibe: StateVibe = VIBES[state.abbr] ?? DEFAULT_VIBE;
  const seed = hashKeys(state.abbr, "layout");
  const rng = rngFor(seed);
  // Bigger, denser cities get a bigger core.
  const W = Math.round(24 + 10 * vibe.density), H = Math.round(22 + 9 * vibe.density);
  const L = new LayoutBuilder(W, H);
  const landmarks: LandmarkPlacement[] = [];

  carveWater(L, vibe, rng, W, H);
  const S = vibe.grid;
  for (let y = 2; y < H - 1; y += S) L.roadX(y, 0, W - 1, "=", 5);
  for (let x = 2; x < W - 1; x += S) L.roadY(x, 0, H - 1, "=", 5);
  L.frontage(2);
  if (style.shore !== ".") L.shore(style.shore);

  // The capitol in its own green square near the middle.
  const bx = 2 + S * Math.max(0, Math.floor((W / 2 - 2) / S) - 1), by = 2 + S * Math.max(0, Math.floor((H / 2 - 2) / S) - 1);
  const free = (x: number, y: number, w: number, d: number) => {
    for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) if (!["b", ".", "p"].includes(L.get(i, j))) return false;
    return true;
  };
  const cx = bx + 1, cy = by + 1, cw = Math.min(3, S - 2), cd = Math.min(3, S - 2);
  if (free(cx, cy, cw, cd)) {
    L.replace(bx + 1, by + 1, S - 1, S - 1, "b", "p").replace(bx + 1, by + 1, S - 1, S - 1, ".", "p");
    landmarks.push({ id: `capitol-${style.dome}`, x: cx, y: cy, w: cw, d: cd });
    for (let j = cy; j < cy + cd; j++) for (let i = cx; i < cx + cw; i++) L.set(i, j, "P");
  }
  // The player's home: the first lot next to a road, a block or two from the capitol.
  let placedHome = false;
  for (let r = S + 2; r < Math.max(W, H) && !placedHome; r++)
    for (let dy = -r; dy <= r && !placedHome; dy++)
      for (const dx of [-r, r]) {
        const hx = cx + dx, hy = cy + dy + 1;
        if (L.get(hx, hy) === "b" && ["=", "t"].some((c) => [L.get(hx - 1, hy), L.get(hx + 1, hy), L.get(hx, hy - 1), L.get(hx, hy + 1)].includes(c as never))) {
          L.set(hx, hy, "h");
          placedHome = true;
          break;
        }
      }

  const maxFloors = Math.max(4, Math.round(style.palette.maxFloors * vibe.density));
  return {
    id: `${state.cityId}-${state.abbr.toLowerCase()}`,
    name: state.city,
    state: state.abbr,
    tagline: vibe.tagline,
    plates: state.cityId,
    layout: L.build(),
    // Towers stand behind the capitol (toward the back of the map) so the
    // skyline frames the dome instead of hiding it.
    zones: [
      { x: cx - S, y: cy - S, r: 3 + 2 * vibe.density, kind: "downtown" },
      { x: cx + S, y: cy - S, r: 3.5, kind: "midtown" },
      { x: cx - S, y: cy + S, r: 3, kind: "midtown" },
      { x: W - 3, y: H - 3, r: 4, kind: "industrial" },
    ],
    palette: { ...style.palette, walls: [...style.palette.walls, ...(vibe.accents ?? [])], maxFloors },
    backdrop: style.backdrop,
    climate: style.climate,
    snowInWinter: style.snowInWinter || vibe.terrain === "tundra",
    landmarks,
    vehicles: style.vehicles,
    boats: style.boats,
    traffic: Math.round(22 * vibe.density + 8),
    hazards: style.hazards,
    outskirts: {
      terrain: vibe.terrain,
      farms: vibe.farms,
      forest: vibe.forest,
      suburbs: Math.round(6 + 5 * vibe.density),
      grid: S,
      beltway: vibe.density >= 0.8,
      features: vibe.features,
    },
  };
}

function carveWater(L: LayoutBuilder, vibe: StateVibe, rng: () => number, W: number, H: number): void {
  switch (vibe.water) {
    case "river":
    case "wide-river": {
      const width = vibe.water === "wide-river" ? 4 : 2;
      const a = Math.floor(H * 0.25 + rng() * H * 0.2), b = Math.floor(H * 0.45 + rng() * H * 0.25);
      L.path([[-2, a], [W * 0.3, a + 2], [W * 0.65, b - 2], [W + 2, b]], "w", width);
      break;
    }
    case "lake": {
      const corner = Math.floor(rng() * 4);
      const lx = corner % 2 === 0 ? 0 : W - 11, ly = corner < 2 ? 0 : H - 9;
      L.rect(lx, ly, 11, 9, "w");
      L.rect(corner % 2 === 0 ? 0 : W - 8, corner < 2 ? 9 : H - 12, 8, 3, "w");
      break;
    }
    case "coast": {
      const side: Side = vibe.coastSide ?? "east";
      const depth = 6;
      for (let i = 0; i < Math.max(W, H); i++) {
        const jag = rng() < 0.4 ? 1 : 0;
        for (let k = 0; k < depth + jag; k++) {
          if (side === "east") L.set(W - 1 - k, i, "w");
          if (side === "west") L.set(k, i, "w");
          if (side === "south") L.set(i, H - 1 - k, "w");
          if (side === "north") L.set(i, k, "w");
        }
      }
      break;
    }
    case "none":
      break;
  }
}
