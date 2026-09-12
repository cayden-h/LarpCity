// The DOM heads-up display over the canvas: city card, calendar and speed,
// home tier, event buttons, sky and zoom controls.

import { formatDate, type Clock } from "../engine/clock";
import { HOME_TIERS } from "../engine/hero";
import type { CityEvent, SceneStatus } from "../engine/scene";
import type { CityDef, StateInfo, WeatherKind } from "../engine/types";

const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: "☀️", cloudy: "☁️", rain: "🌧️", storm: "⛈️", snow: "🌨️", fog: "🌫️", heat: "🥵", smoke: "🔥",
};
const WEATHER_NAME: Record<WeatherKind, string> = {
  clear: "Clear", cloudy: "Cloudy", rain: "Rain", storm: "Storm", snow: "Snow", fog: "Fog", heat: "Heat wave", smoke: "Smoky",
};

export const EVENTS: { id: CityEvent; icon: string; label: string }[] = [
  { id: "hurricane", icon: "🌀", label: "Hurricane" },
  { id: "snowstorm", icon: "❄️", label: "Snowstorm" },
  { id: "wildfire", icon: "🔥", label: "Wildfire" },
  { id: "drought", icon: "🏜️", label: "Drought" },
  { id: "fog", icon: "🌫️", label: "Fog" },
  { id: "pandemic", icon: "😷", label: "Pandemic" },
  { id: "crash", icon: "📉", label: "Crash" },
  { id: "boom", icon: "📈", label: "Boom" },
  { id: "clear", icon: "✨", label: "Reset" },
];

const EVENT_HAZARD: Partial<Record<CityEvent, WeatherKind>> = {
  hurricane: "storm",
  snowstorm: "snow",
  wildfire: "smoke",
  drought: "heat",
  fog: "fog",
};

export interface HudActions {
  speed(multiplier: number): void;
  skip(days: number): void;
  tier(delta: number): void;
  event(id: CityEvent): void;
  sky(value: number | null): void;
  zoom(factor: number | "reset"): void;
  openMap(): void;
  focusHome(): void;
}

export class Hud {
  private readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(root: HTMLElement, actions: HudActions) {
    this.el = root;
    root.innerHTML = `
      <section class="card city-card">
        <div class="city-name"><span data-city></span><span class="tier" data-tier></span></div>
        <div class="city-sub" data-sub></div>
        <div class="calendar"><span data-date></span><span class="dot"></span><span data-weather></span></div>
        <div class="event-banner" data-event hidden></div>
      </section>

      <button class="btn btn-map" data-map>🗺️ States</button>

      <section class="card speed">
        <div class="seg">
          <button data-speed="0" title="Pause">⏸</button>
          <button data-speed="1" title="1 week per 10 s">1×</button>
          <button data-speed="2">2×</button>
          <button data-speed="4">4×</button>
        </div>
        <button class="btn small" data-skip="7">+1 week</button>
        <button class="btn small" data-skip="30">+1 month</button>
      </section>

      <section class="card home">
        <div class="label">Your home</div>
        <div class="home-row">
          <button class="round" data-tier-step="-1" title="Net worth down">−</button>
          <div class="home-name" data-home></div>
          <button class="round" data-tier-step="1" title="Net worth up">+</button>
          <button class="round find" data-home-focus title="Find my home">📍</button>
        </div>
      </section>

      <section class="card events">
        <div class="label">Events</div>
        <div class="event-grid">
          ${EVENTS.map((e) => `<button class="event" data-ev="${e.id}" title="${e.label}"><span>${e.icon}</span>${e.label}</button>`).join("")}
        </div>
      </section>

      <section class="card sky">
        <label class="label">Sky <span data-sky-label>Auto</span></label>
        <input type="range" min="0" max="100" value="42" data-sky />
        <button class="btn small ghost" data-sky-auto>Auto</button>
        <div class="zoom">
          <button class="round" data-zoom="in">+</button>
          <button class="round" data-zoom="out">−</button>
          <button class="round" data-zoom="reset" title="Fit">⤢</button>
        </div>
      </section>
    `;
    this.el.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => actions.speed(Number(b.dataset.speed))),
    );
    this.el.querySelectorAll<HTMLButtonElement>("[data-skip]").forEach((b) =>
      b.addEventListener("click", () => actions.skip(Number(b.dataset.skip))),
    );
    this.el.querySelectorAll<HTMLButtonElement>("[data-tier-step]").forEach((b) =>
      b.addEventListener("click", () => actions.tier(Number(b.dataset.tierStep))),
    );
    this.el.querySelectorAll<HTMLButtonElement>("[data-ev]").forEach((b) =>
      b.addEventListener("click", () => actions.event(b.dataset.ev as CityEvent)),
    );
    const sky = this.q<HTMLInputElement>("[data-sky]");
    sky.addEventListener("input", () => actions.sky(Number(sky.value) / 100));
    this.q<HTMLButtonElement>("[data-sky-auto]").addEventListener("click", () => actions.sky(null));
    this.el.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) =>
      b.addEventListener("click", () => {
        const z = b.dataset.zoom;
        actions.zoom(z === "in" ? 1.25 : z === "out" ? 0.8 : "reset");
      }),
    );
    this.q<HTMLButtonElement>("[data-map]").addEventListener("click", () => actions.openMap());
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
  }

  setCity(state: StateInfo, city: CityDef): void {
    // Weather events only where they really happen; money events work everywhere.
    this.el.querySelectorAll<HTMLButtonElement>("[data-ev]").forEach((b) => {
      const hazard = EVENT_HAZARD[b.dataset.ev as CityEvent];
      const ok = !hazard || city.hazards.includes(hazard);
      b.disabled = !ok;
      b.title = ok ? (EVENTS.find((e) => e.id === b.dataset.ev)?.label ?? "") : `Not a ${city.name} hazard`;
    });
    this.q("[data-city]").textContent = `${city.name}, ${state.abbr}`;
    const tier = this.q("[data-tier]");
    tier.textContent = state.tier;
    tier.className = `tier ${state.tier.toLowerCase()}`;
    this.q("[data-sub]").textContent = city.tagline;
  }

  render(clock: Clock, status: SceneStatus | null, homeTier: number | null): void {
    this.q("[data-date]").textContent = formatDate(clock.date);
    if (status) {
      this.q("[data-weather]").textContent = `${WEATHER_ICON[status.weather]} ${WEATHER_NAME[status.weather]} · ${cap(status.season)}`;
      const banner = this.q("[data-event]");
      banner.hidden = !status.event;
      banner.textContent = status.event ? `⚠️ ${status.event}` : "";
      banner.classList.toggle("bad", status.event !== "Boom");
    }
    this.el.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.speed) === clock.speed),
    );
    this.q("[data-home]").textContent = homeTier === null ? "No home lot" : HOME_TIERS[homeTier];
    const skyLabel = this.q("[data-sky-label]");
    skyLabel.textContent = clock.pinnedTimeOfDay === null ? "Auto" : timeLabel(clock.pinnedTimeOfDay);
    const slider = this.q<HTMLInputElement>("[data-sky]");
    // Leave the thumb alone while it is being dragged.
    if (document.activeElement !== slider) slider.value = String(Math.round(clock.timeOfDay * 100));
  }
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function timeLabel(t: number): string {
  const mins = Math.round(t * 24 * 60);
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  const ampm = h < 12 ? "am" : "pm";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
}
