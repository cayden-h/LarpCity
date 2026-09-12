// Off-screen, one-shot renders of every distinct city, so the states map can
// show a real in-game render for a state before the player ever visits it.
// Only ~14 distinct cities exist (6 hand-made, 8 regional templates) since
// every state without its own hand-made city shares one with its region —
// cheap enough to render all of them once, in the background, at idle time.

import { Application } from "pixi.js";
import { cityFor, LANDMARKS, PINS, stateForPin } from "../cities";
import { Clock } from "./clock";
import { CityScene } from "./scene";
import { loadSpriteSet } from "./sprites";
import type { StateInfo } from "./types";

const THUMB_W = 560;
const THUMB_H = 315;
/** Simulated seconds to settle traffic, foot traffic, and time-of-day tint before capturing. */
const SETTLE_STEPS = 40;

/** One representative state per distinct city (handmade id or template region). */
function representativeStates(states: StateInfo[]): StateInfo[] {
  const byCityId = new Map<string, StateInfo>();
  for (const s of states) if (!byCityId.has(s.cityId)) byCityId.set(s.cityId, s);
  for (const p of PINS) {
    const s = stateForPin(p.id, states);
    if (s && !byCityId.has(s.cityId)) byCityId.set(s.cityId, s);
  }
  return [...byCityId.values()];
}

// A single offscreen Application, reused for every city and never destroyed.
// Sprite textures are loaded through the shared global `Assets` cache, which
// the real game also reads from — destroying a renderer that touched those
// textures tore down GPU state out from under the main game's renderer the
// moment the player visited a city whose sprites this module had also
// rendered, throwing deep inside PixiJS mid-frame and leaving the new city
// unrendered until a full page reload. Keeping one small hidden canvas alive
// for the rest of the session avoids ever touching that shared state again.
let sharedApp: Application | null = null;

async function getSharedApp(): Promise<Application> {
  if (sharedApp) return sharedApp;
  const app = new Application();
  await app.init({ width: THUMB_W, height: THUMB_H, antialias: true, background: "#5d9e46", resolution: 1, autoStart: false });
  sharedApp = app;
  return app;
}

async function renderThumbnail(state: StateInfo): Promise<string | null> {
  const city = cityFor(state);
  const sprites = await loadSpriteSet(city.id).catch(() => null);
  const app = await getSharedApp();
  let scene: CityScene | null = null;
  try {
    const clock = new Clock();
    clock.speed = 0;
    scene = new CityScene(app, city, clock, LANDMARKS, sprites);
    app.stage.addChild(scene.root);
    scene.resize(THUMB_W, THUMB_H);
    // resetCamera() centers on the core's bounding box, which for a sparse or
    // off-center layout can land on open ground with no buildings in frame.
    // The player's home is always placed inside the built-up core, so it's a
    // reliable "there's a city here" anchor for an unattended thumbnail.
    if (scene.hero) scene.focusHome(0.55);
    else {
      scene.resetCamera();
      scene.zoomBy(1.2);
    }
    for (let i = 0; i < SETTLE_STEPS; i++) scene.update(0.15);
    // Skip app.render(): the global CullerPlugin (main.ts) wraps it to cull
    // against `renderer.screen`, and for this offscreen app that consistently
    // culled out every building and ground chunk, leaving only the (non-
    // cullable) hero and NPCs. Rendering the stage directly bypasses culling,
    // which only exists as a perf optimization anyway — irrelevant for a
    // single off-screen capture.
    app.renderer.render({ container: app.stage });
    return app.canvas.toDataURL("image/webp", 0.84);
  } catch (err) {
    console.warn(`[larp] thumbnail render failed for ${state.cityId}`, err);
    return null;
  } finally {
    scene?.destroy();
    app.stage.removeChildren();
  }
}

/**
 * Renders every distinct city once in the background, one at a time at idle
 * time, and hands each finished thumbnail to `onReady`. `skip` filters out
 * cities that already have a preview (a real capture always wins, and there's
 * no point rendering a city twice).
 */
export function prerenderCityThumbnails(states: StateInfo[], onReady: (cityId: string, dataUrl: string) => void, skip: (cityId: string) => boolean): void {
  const queue = representativeStates(states).filter((s) => !skip(s.cityId));
  const idle = (fn: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 2000 });
    else setTimeout(fn, 300);
  };
  const step = () => {
    const state = queue.shift();
    if (!state) return;
    renderThumbnail(state)
      .then((url) => {
        if (url) onReady(state.cityId, url);
      })
      .finally(() => idle(step));
  };
  idle(step);
}
