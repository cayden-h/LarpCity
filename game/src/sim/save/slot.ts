// Which of the player's three save slots this page plays (meeting 2026-09-13),
// and the pre-built demo lives judges can load into one. The slot comes from
// `?slot=` and is remembered in this browser, so the Money desk's window and a
// reload play the same slot. The demos are built by scripts/build-demo-slots.ts
// into public/demo/<id>.json.

export const SLOT_IDS = [0, 1, 2] as const;
export type SlotId = (typeof SLOT_IDS)[number];

const KEY = "larp.slot";

export function parseSlot(v: string | null | undefined): SlotId | null {
  if (v === null || v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return (SLOT_IDS as readonly number[]).includes(n) ? (n as SlotId) : null;
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The slot in the URL, else the one this browser played last, else 0. */
export function activeSlot(params: URLSearchParams, storage = browserStorage()): SlotId {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(KEY) ?? null;
  } catch {
    // Site data blocked: the URL or slot 0.
  }
  return parseSlot(params.get("slot")) ?? parseSlot(stored) ?? 0;
}

export function rememberSlot(slot: SlotId, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, String(slot));
  } catch {
    // Not remembered; the URL still says which slot.
  }
}

/** A pre-built life for the judged demo. */
export interface DemoLife {
  id: string;
  title: string;
  pitch: string;
}

export const DEMOS: readonly DemoLife[] = [
  {
    id: "first-taxes",
    title: "Year one in San Francisco",
    pitch: "22, just out of college with student loans and a 600 credit score. Tax day is days away, with the year-1 tutorial.",
  },
  {
    id: "ai-bubble",
    title: "Married into the AI bubble",
    pitch: "Just married with a prenup to decide, and heavy in the hyped AI stock as the bubble starts to pop.",
  },
  {
    id: "almost-retired",
    title: "Ready to retire",
    pitch: "62, after forty years of steady saving. Open Goals and press Retire to see the final score, then look back on the whole life.",
  },
];

const demoKey = (slot: SlotId) => `larp.slot.${slot}.demo`;

/** Notes which demo life `slot` is playing in this browser ("" for a life of its own), so the end screen can play it again. */
export function rememberDemo(slot: SlotId, id: string | null, storage = browserStorage()): void {
  try {
    storage?.setItem(demoKey(slot), id ?? "");
  } catch {
    // Not remembered; the end screen just doesn't offer to play the demo again.
  }
}

/** The demo life `slot` is playing in this browser, if it is one. */
export function demoFor(slot: SlotId, storage = browserStorage()): DemoLife | null {
  let id: string | null = null;
  try {
    id = storage?.getItem(demoKey(slot)) ?? null;
  } catch {
    // Site data blocked: not a known demo.
  }
  return DEMOS.find((d) => d.id === id) ?? null;
}
