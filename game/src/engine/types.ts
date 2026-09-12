// Shared data contracts for cities, templates, and states.
// A city is data plus a few landmark draw functions; the engine does the rest.

import type { Container } from "pixi.js";
import type { Clock } from "./clock";
import type { SpriteSet } from "./sprites";

/**
 * Layout characters, one per tile:
 *   .  grass           =  road            B  bridge (road over water)
 *   w  water           s  sand / beach    ~  marsh / reeds
 *   b  building lot    p  park (trees)    P  plaza (paved, for landmarks)
 *   h  player's home   t  tram road (road with rails)
 *   O  overpass (a road over another road)
 *   f  farmland        F  forest          m  mountain rock
 *   ' ' (space) is outside the map; the world builder fills it in.
 */
export type TileChar = "." | "=" | "B" | "w" | "s" | "~" | "b" | "p" | "P" | "h" | "t" | "O" | "f" | "F" | "m" | " ";

export type Terrain = "plains" | "forest" | "hills" | "mountains" | "desert" | "swamp" | "tundra" | "island";

/** Where a feature may be placed in the generated world around a city. */
export type FeatureSite = "core" | "suburb" | "rural" | "water" | "coast" | "edge";

export interface FeatureSpec {
  id: string;
  w: number;
  d: number;
  where: FeatureSite;
  count?: number;
}

/** How the world around a city's core is generated (see engine/world.ts). */
export interface Outskirts {
  terrain: Terrain;
  /** Share of rural land in farm fields, 0..1. */
  farms: number;
  /** Share of rural land in forest, 0..1. */
  forest: number;
  /** Width of the suburban ring in tiles. */
  suburbs: number;
  /** Street spacing in the suburbs. */
  grid: number;
  /** A ring road around the suburbs. */
  beltway: boolean;
  features: FeatureSpec[];
}

export type RoofType = "flat" | "gable" | "hip" | "dome" | "antenna" | "water-tower" | "terrace";

export type VehicleKind =
  | "sedan"
  | "hatch"
  | "pickup"
  | "taxi"
  | "bus"
  | "van"
  | "convertible"
  | "cable-car"
  | "police"
  | "snowplow";

export type BoatKind = "sailboat" | "ferry" | "tanker" | "cruise" | "kayak" | "speedboat" | "tug";

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "heat" | "smoke";

export type EconomyMood = "boom" | "normal" | "bear";

export interface Climate {
  /** Probability per day of each weather type in this month; "clear" is the remainder. */
  cloudy: number;
  rain: number;
  storm: number;
  snow: number;
  fog: number;
  heat: number;
  /** Wildfire smoke days (fire season in the West); optional, defaults to 0. */
  smoke?: number;
}

export interface CityPalette {
  walls: number[];
  roofs: number[];
  trim: number[];
  roofTypes: RoofType[];
  grass: number;
  water: number;
  sand: number;
  /** Tallest filler building in floors. */
  maxFloors: number;
}

/** Procedural backdrop used until (or instead of) generated plates. */
export interface BackdropDef {
  terrain: "flat" | "hills" | "mountains" | "mesas" | "coast";
  terrainColor: number;
  /** Distant skyline towers as [x 0..1, width 0..1, height 0..1] tuples. */
  skyline: [number, number, number][];
  /** Extra silhouettes: refinery stacks, bridge towers, domes, palms, statue. */
  props: ("stacks" | "suspension-bridge" | "dome" | "palms" | "statue" | "sphere-tower" | "arch-bridge" | "rocket" | "pines" | "volcano" | "lighthouse" | "grain-elevator" | "steeple")[];
  sea: boolean;
}

export type ZoneKind = "downtown" | "midtown" | "residential" | "industrial" | "campus";

/** Buildings on lots take the style of the nearest zone (distance / radius). */
export interface Zone {
  x: number;
  y: number;
  r: number;
  kind: ZoneKind;
}

export interface LandmarkPlacement {
  id: string;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface LandmarkContext {
  clock: Clock;
  /** 0 by day, 1 at night. */
  night: () => number;
  time: () => number;
  /** 0 in calm weather, up to 1 in a full storm (for bending palms, waves). */
  storm: () => number;
  /** The city's pre-rendered sprites; a landmark with a sprite there draws it instead of its model. */
  sprites: SpriteSet | null;
}

export interface LandmarkInstance {
  /** Every container here must set its own zIndex for depth sorting. */
  views: Container[];
  /** Parts that take the time-of-day tint; lights are left out so they glow. */
  tintables: Container[];
  update?: (dt: number) => void;
}

/** A landmark builds its own display objects and returns an optional tick. */
export type LandmarkFactory = (place: LandmarkPlacement, ctx: LandmarkContext) => LandmarkInstance;

export interface CityDef {
  id: string;
  name: string;
  state: string;
  tagline: string;
  /** Folder under public/cities/ holding the 4 background plates. */
  plates: string;
  layout: string[];
  zones: Zone[];
  palette: CityPalette;
  backdrop: BackdropDef;
  /** 12 months, January first. */
  climate: Climate[];
  snowInWinter: boolean;
  landmarks: LandmarkPlacement[];
  vehicles: { kind: VehicleKind; weight: number }[];
  boats: { kind: BoatKind; weight: number }[];
  /** How many cars in a normal economy. */
  traffic: number;
  /** Events this city is exposed to, for the dev panel. */
  hazards: WeatherKind[];
  /** The generated land around the core; defaults to plains with farms. */
  outskirts?: Partial<Outskirts>;
}

export type CostTier = "LCOL" | "MCOL" | "HCOL";

export interface StateInfo {
  abbr: string;
  name: string;
  fips: string;
  /** The team's city for this state. */
  city: string;
  /** Specialized city id, or a regional template id. */
  cityId: string;
  /** BEA Regional Price Parities, 2024 (US = 100). */
  rpp: { all: number; goods: number; housing: number; utilities: number; other: number };
  tier: CostTier;
}
