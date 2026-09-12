// The states map: every state shaded by its cost-of-living tier (BEA RPP).
// Browsing is free; "Visit" opens that state's city. Moving (which costs
// money) belongs to the simulation and is shown here as a preview.

import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import us from "us-atlas/states-10m.json";
import { isHandmade, PINS, stateForPin } from "../cities";
import type { StateInfo } from "../engine/types";

const TIER_FILL = { LCOL: "#5dbb63", MCOL: "#f6b73c", HCOL: "#e8554e" } as const;
const TIER_TEXT = { LCOL: "Low cost of living", MCOL: "Medium cost of living", HCOL: "High cost of living" } as const;

export class UsMap {
  private readonly el: HTMLElement;
  private selected: StateInfo | null = null;
  private readonly onVisit: (s: StateInfo) => void;

  constructor(root: HTMLElement, states: StateInfo[], onVisit: (s: StateInfo) => void) {
    this.el = root;
    this.onVisit = onVisit;
    const byFips = new Map(states.map((s) => [s.fips, s]));
    const topo = us as unknown as Topology<{ states: GeometryCollection }>;
    const geo = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>;
    const W = 960, H = 600;
    const projection = geoAlbersUsa().fitSize([W, H - 20], geo);
    const path = geoPath(projection);

    const paths = geo.features
      .map((f) => {
        const s = byFips.get(String(f.id).padStart(2, "0"));
        if (!s) return "";
        return `<path class="state" d="${path(f)}" fill="${TIER_FILL[s.tier]}" data-abbr="${s.abbr}"><title>${s.name}</title></path>`;
      })
      .join("");
    const pins = PINS.map((p) => {
      const xy = projection([p.lon, p.lat]);
      if (!xy) return "";
      return `<g class="pin ${isHandmade(p.id) ? "handmade" : ""}" data-pin="${p.id}" transform="translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)})"><circle r="8"/><text y="-13">${p.name}</text><title>${p.name}</title></g>`;
    }).join("");

    root.innerHTML = `
      <div class="map-card">
        <header>
          <h2>Pick a state</h2>
          <p>Browse any state for free. Moving costs money: movers, a deposit, first month's rent, and time off.</p>
          <button class="round close" data-close title="Close">✕</button>
        </header>
        <div class="map-body">
          <svg viewBox="0 0 ${W} ${H}" class="map-svg">${paths}${pins}</svg>
          <aside class="state-panel" data-panel>
            <div class="empty">Hover or tap a state</div>
          </aside>
        </div>
        <footer class="legend">
          ${(["LCOL", "MCOL", "HCOL"] as const).map((t) => `<span><i style="background:${TIER_FILL[t]}"></i>${t} · ${TIER_TEXT[t]}</span>`).join("")}
          <span class="src">BEA Regional Price Parities, 2024</span>
        </footer>
      </div>`;

    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
    root.querySelector("[data-close]")!.addEventListener("click", () => this.close());
    root.querySelectorAll<SVGPathElement>(".state").forEach((p) => {
      const s = states.find((st) => st.abbr === p.dataset.abbr)!;
      p.addEventListener("mouseenter", () => this.show(s));
      p.addEventListener("click", () => {
        this.show(s);
        this.selected = s;
        root.querySelectorAll(".state.sel").forEach((n) => n.classList.remove("sel"));
        p.classList.add("sel");
      });
    });
    // Pins open the specialized cities (Dallas and Austin share Texas with Houston).
    root.querySelectorAll<SVGGElement>(".pin").forEach((g) => {
      const s = stateForPin(g.dataset.pin!, states);
      if (!s) return;
      g.addEventListener("mouseenter", () => this.show(s));
      g.addEventListener("click", () => {
        this.show(s);
        this.selected = s;
      });
    });
    root.querySelector(".map-svg")!.addEventListener("mouseleave", () => this.selected && this.show(this.selected));
  }

  open(current: StateInfo): void {
    this.el.hidden = false;
    this.selected = current;
    this.show(current);
  }

  close(): void {
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  private show(s: StateInfo): void {
    const panel = this.el.querySelector("[data-panel]") as HTMLElement;
    const plate = `${import.meta.env.BASE_URL}cities/${s.cityId}/plates/day.jpg`;
    panel.innerHTML = `
      <img class="thumb" src="${plate}" alt="" onerror="this.style.visibility='hidden'" />
      <h3>${s.city}, ${s.abbr}</h3>
      <div class="tier ${s.tier.toLowerCase()}">${s.tier}</div>
      <dl>
        <dt>Overall prices</dt><dd>${s.rpp.all.toFixed(1)} <small>(US = 100)</small></dd>
        <dt>Housing</dt><dd>${s.rpp.housing.toFixed(1)}</dd>
        <dt>Goods</dt><dd>${s.rpp.goods.toFixed(1)}</dd>
        <dt>Utilities</dt><dd>${s.rpp.utilities.toFixed(1)}</dd>
      </dl>
      <button class="btn" data-visit>Visit ${s.city} (free)</button>
      <button class="btn ghost" disabled title="Moving is part of the simulation">Move here · about $4,500 + deposit</button>`;
    panel.querySelector("[data-visit]")!.addEventListener("click", () => {
      this.close();
      this.onVisit(s);
    });
  }
}
