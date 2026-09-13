// Every code-drawn pixel family in one list, for the contact sheet and the art tests.

import type { PixelCanvas } from "./canvas.ts";
import { boulderArt, cactusArt, reedsArt, SPECIES, treeArt, VARIANTS } from "./plants.ts";

export interface Family {
  name: string;
  art: PixelCanvas[];
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const SUMMER = 0x5db43f, FALL = 0xb8a23a;

export function contactFamilies(): Family[] {
  return [
    ...SPECIES.map((s) => ({ name: `tree-${s}`, art: range(VARIANTS).map((v) => treeArt(s, v, { leaf: SUMMER })) })),
    { name: "tree-seasons", art: [treeArt("oak", 1, { leaf: FALL }), treeArt("oak", 2, { leaf: SUMMER, bare: true }), treeArt("oak", 3, { leaf: SUMMER, bare: true, snow: true }), treeArt("pine", 1, { leaf: SUMMER, snow: true }), treeArt("oak", 0, { leaf: 0x86a867, snow: true })] },
    { name: "plants-other", art: [...range(3).map(cactusArt), boulderArt(0, false), boulderArt(1, true), ...range(2).map(reedsArt)] },
  ];
}
