// The always-visible DOM HUD only keeps the player's home controls. Location,
// calendar, and weather live in the phone apps.

import { pixelIcon } from "./pixel-icons";
import { HOME_TIERS } from "../engine/hero";

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
        <div class="label">${pixelIcon("home")} Your home</div>
        <div class="home-row">
          <button class="round" data-tier-step="-1" title="Net worth down">−</button>
          <div class="home-name" data-home></div>
          <button class="round" data-tier-step="1" title="Net worth up">+</button>
          <button class="round find" data-home-focus title="Find my home">${pixelIcon("pin")}</button>
        </div>
      </section>

    `;
    this.el.querySelectorAll<HTMLButtonElement>("[data-tier-step]").forEach((b) =>
      b.addEventListener("click", () => actions.tier(Number(b.dataset.tierStep))),
    );
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
  }

  render(homeTier: number | null): void {
    this.q("[data-home]").textContent = homeTier === null ? "No home lot" : HOME_TIERS[homeTier];
  }
}
