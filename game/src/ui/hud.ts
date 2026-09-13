// The always-visible DOM HUD keeps the player's home controls, who they are,
// and a chip when saving stops. Location, calendar, and weather live in the phone apps.

import "./home-picker.css";
import { pixelIcon } from "./pixel-icons";
import { HOME_TIERS } from "../engine/hero";
import type { SaveStatus } from "../sim/save/manager";

export interface HudActions {
  chooseHome(): void;
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
          <button type="button" class="home-name home-choose" data-home aria-haspopup="dialog" title="Choose a home"></button>
          <button class="round find" data-home-focus type="button" title="Find my home" aria-label="Find my home">${pixelIcon("pin")}</button>
        </div>
        <div class="hud-chip" data-save-chip hidden></div>
      </section>
      <section class="card id-card">
        <div class="label">Player</div>
        <div class="id-card-row">
          <div class="id-card-avatar" data-player-avatar></div>
          <div class="id-card-info">
            <div class="id-card-name" data-player-name></div>
            <div class="id-card-age" data-player-age></div>
            <div class="id-card-job" data-who></div>
          </div>
        </div>
      </section>`;
    this.q<HTMLButtonElement>("[data-home]").addEventListener("click", () => actions.chooseHome());
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
    // The ID card and the happiness meter stand on the home card, whose height grows with the
    // save chip, so they follow its real height (--home-h in pixel-theme.css and happiness.css).
    const home = this.q(".home");
    new ResizeObserver(() => document.documentElement.style.setProperty("--home-h", `${home.offsetHeight}px`)).observe(home);
  }

  render(homeTier: number | null): void {
    this.q("[data-home]").textContent = homeTier === null ? "No home lot" : HOME_TIERS[homeTier];
  }

  /** The player's job, on the ID card under their age. */
  setWho(text: string): void {
    this.q("[data-who]").textContent = text;
  }

  /** Fills the ID card; name/avatar are fixed at intake, but age advances daily, so this is called again from `clock.onDay`. */
  setPlayer(name: string, age: number, avatar: "male" | "female"): void {
    this.q("[data-player-name]").textContent = name;
    this.q("[data-player-age]").textContent = `Age ${Math.floor(age)}`;
    this.q("[data-player-avatar]").textContent = AVATAR_EMOJI[avatar];
  }

  /** Shows a chip only when saving has stopped; a working save stays quiet. */
  setSave(status: SaveStatus): void {
    const chip = this.q("[data-save-chip]");
    chip.textContent = SAVE_CHIPS[status] ?? "";
    chip.hidden = !chip.textContent;
  }
}

/** The two characters a new life picks between on the title screen (ui/title.ts); the ID card shows the same one. */
export const AVATAR_EMOJI: Record<"male" | "female", string> = { male: "🧑", female: "👩" };

/** What the HUD says for each save status where saving has stopped. */
const SAVE_CHIPS: Partial<Record<SaveStatus, string>> = {
  offline: "Offline, not saving",
  conflict: "Open in another tab, not saving",
  failed: "Couldn't save this life",
};
