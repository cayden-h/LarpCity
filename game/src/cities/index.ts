// City registry: hand-made cities by id, templates for everything else, and
// every landmark factory the scene can place.

import type { CityDef, LandmarkFactory, StateInfo } from "../engine/types";
import { austin } from "./austin";
import { AUSTIN_LANDMARKS } from "./austin.landmarks";
import { capitol, grainElevator, lighthouse, steeple } from "./common.landmarks";
import { dallas } from "./dallas";
import { DALLAS_LANDMARKS } from "./dallas.landmarks";
import { COAST_LANDMARKS } from "./features/coast.landmarks";
import { RURAL_LANDMARKS } from "./features/rural.landmarks";
import { WILD_LANDMARKS } from "./features/wild.landmarks";
import { houston } from "./houston";
import { astrodome, beaconTower, lovettHall, refinery, shipChannelBridge, spaceRocket } from "./houston.landmarks";
import { miami } from "./miami";
import { MIAMI_LANDMARKS } from "./miami.landmarks";
import { newYork } from "./new-york";
import { NY_LANDMARKS } from "./new-york.landmarks";
import { sanFrancisco } from "./san-francisco";
import { SF_LANDMARKS } from "./san-francisco.landmarks";
import { DOME_COLORS, templateCity } from "./templates";

const HANDMADE: Record<string, CityDef> = { houston, dallas, austin, miami, "new-york": newYork, "san-francisco": sanFrancisco };

export const LANDMARKS: Record<string, LandmarkFactory> = {
  "lovett-hall": lovettHall,
  "space-rocket": spaceRocket,
  "ship-channel-bridge": shipChannelBridge,
  refinery,
  astrodome,
  "beacon-tower": beaconTower,
  lighthouse,
  "grain-elevator": grainElevator,
  steeple,
  ...Object.fromEntries(Object.entries(DOME_COLORS).map(([name, color]) => [`capitol-${name}`, capitol(color)])),
  ...DALLAS_LANDMARKS,
  ...NY_LANDMARKS,
  ...AUSTIN_LANDMARKS,
  ...SF_LANDMARKS,
  ...MIAMI_LANDMARKS,
  ...RURAL_LANDMARKS,
  ...WILD_LANDMARKS,
  ...COAST_LANDMARKS,
};

export function cityFor(state: StateInfo): CityDef {
  return HANDMADE[state.cityId] ?? templateCity(state);
}

/** Specialized cities marked as pins on the states map. */
export const PINS: { id: string; name: string; state: string; lon: number; lat: number }[] = [
  { id: "houston", name: "Houston", state: "TX", lon: -95.37, lat: 29.76 },
  { id: "san-francisco", name: "San Francisco", state: "CA", lon: -122.42, lat: 37.77 },
  { id: "new-york", name: "New York", state: "NY", lon: -74.0, lat: 40.71 },
  { id: "dallas", name: "Dallas", state: "TX", lon: -96.8, lat: 32.78 },
  { id: "austin", name: "Austin", state: "TX", lon: -97.74, lat: 30.27 },
  { id: "miami", name: "Miami", state: "FL", lon: -80.19, lat: 25.76 },
];

export function isHandmade(cityId: string): boolean {
  return cityId in HANDMADE;
}

/** A pin city inside its state: same prices and tier, its own city and plates. */
export function stateForPin(pinId: string, states: StateInfo[]): StateInfo | undefined {
  const pin = PINS.find((p) => p.id === pinId);
  const state = pin && states.find((s) => s.abbr === pin.state);
  return pin && state ? { ...state, city: pin.name, cityId: pin.id } : undefined;
}
