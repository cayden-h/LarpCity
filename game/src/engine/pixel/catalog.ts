// Every code-drawn pixel family in one list, for the contact sheet and the art tests.

import { boatArt, BOAT_KINDS } from "./boats.ts";
import { PixelCanvas } from "./canvas.ts";
import { glintArt, patternArt, TERRAINS } from "./ground-art.ts";
import { boulderArt, cactusArt, reedsArt, SPECIES, treeArt, VARIANTS } from "./plants.ts";
import { lampArt, vehicleArt } from "./vehicles.ts";

export interface Family {
  name: string;
  art: PixelCanvas[];
  /** Sprites are outlined and anchored; patterns tile seamlessly; glints are bare light. */
  kind?: "sprite" | "pattern" | "glint";
}

/** A pattern repeated 3 x 3, so the sheet shows whether it tiles seamlessly. */
function tiled(p: PixelCanvas): PixelCanvas {
  const c = new PixelCanvas(p.w * 3, p.h * 3);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) c.put(x, y, p.at(x % p.w, y % p.h).color);
  return c;
}

const GROUND: Record<string, number> = { grass: 0x65b045, sand: 0xe8d7a8, soil: 0x7a5c3a, forest: 0x4c8a3a, rock: 0x8c7f6e, asphalt: 0x454b55, plaza: 0xd9d4c7, lot: 0xb3b9ae, marsh: 0x6a9a50, deep: 0x3f86c4, shallow: 0x5aa0d4 };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const SUMMER = 0x5db43f, FALL = 0xb8a23a;

export function contactFamilies(): Family[] {
  return [
    ...SPECIES.map((s) => ({ name: `tree-${s}`, art: range(VARIANTS).map((v) => treeArt(s, v, { leaf: SUMMER })) })),
    { name: "tree-seasons", art: [treeArt("oak", 1, { leaf: FALL }), treeArt("oak", 2, { leaf: SUMMER, bare: true }), treeArt("oak", 3, { leaf: SUMMER, bare: true, snow: true }), treeArt("pine", 1, { leaf: SUMMER, snow: true }), treeArt("oak", 0, { leaf: 0x86a867, snow: true })] },
    { name: "plants-other", art: [...range(3).map(cactusArt), boulderArt(0, false), boulderArt(1, true), ...range(2).map(reedsArt)] },
    ...["sedan", "taxi", "police", "pickup", "van", "bus", "cable-car", "convertible", "snowplow"].map((kind, i) => ({
      name: `vehicle-${kind}`,
      art: range(8).map((f) => vehicleArt({ kind, color: [0xd84a3a, 0xf3c21a, 0xf4f4f4, 0x3a6fb0, 0x6b8e5a, 0xc0392b, 0xb33a2e, 0x2f8f9d, 0xf0a020][i] }, f)),
    })),
    { name: "vehicle-lamps", kind: "glint", art: range(8).map(lampArt) },
    ...BOAT_KINDS.map((k) => ({ name: `boat-${k}`, art: [boatArt(k, true, false, 0), boatArt(k, true, true, 1), boatArt(k, false, false, 0), boatArt(k, false, true, 1)] })),
    { name: "ground", kind: "pattern", art: TERRAINS.map((t) => tiled(patternArt(t, GROUND[t]))) },
    { name: "water-glints", kind: "glint", art: range(3).map((f) => glintArt(f, GROUND.deep)) },
  ];
}
