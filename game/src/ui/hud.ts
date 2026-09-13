// The always-visible DOM HUD keeps the player's home controls, who they are,
// and a chip when saving stops. Location, calendar, and weather live in the phone apps.

import { pixelIcon } from "./pixel-icons";
import { HOME_TIERS } from "../engine/hero";
import type { SaveStatus } from "../sim/save/manager";

export interface HudActions {
  tier(delta: number): void;
  focusHome(): void;
}

export class Hud {
  private readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(root: HTMLElement, actions: HudActions) {
    this.el = root;
    root.innerHTML = `
      <section class="card home">
        <div class="label">${pixelIcon("home")} Your home <span class="hud-who" data-who></span></div>
        <div class="home-row">
          <button class="round" data-tier-step="-1" title="Net worth down">−</button>
          <div class="home-name" data-home></div>
          <button class="round" data-tier-step="1" title="Net worth up">+</button>
          <button class="round find" data-home-focus title="Find my home">${pixelIcon("pin")}</button>
        </div>
        <div class="hud-chip" data-save-chip hidden></div>
      </section>`;
    this.el.querySelectorAll<HTMLButtonElement>("[data-tier-step]").forEach((b) =>
      b.addEventListener("click", () => actions.tier(Number(b.dataset.tierStep))),
    );
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
  }

  render(homeTier: number | null): void {
    this.q("[data-home]").textContent = homeTier === null ? "No home lot" : HOME_TIERS[homeTier];
  }

  /** The player's job from the intake (their name, once accounts exist). */
  setWho(text: string): void {
    this.q("[data-who]").textContent = text ? `· ${text}` : "";
  }

  /** Shows a chip only when saving has stopped; a working save stays quiet. */
  setSave(status: SaveStatus): void {
    const chip = this.q("[data-save-chip]");
    chip.textContent = SAVE_CHIPS[status] ?? "";
    chip.hidden = !chip.textContent;
  }
}

/** What the HUD says for each save status where saving has stopped. */
const SAVE_CHIPS: Partial<Record<SaveStatus, string>> = {
  offline: "Offline, not saving",
  conflict: "Open in another tab, not saving",
  failed: "Couldn't save this life",
};
