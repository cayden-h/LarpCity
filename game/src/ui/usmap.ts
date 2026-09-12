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
import { pixelIcon } from "./pixel-icons";

const TIER_FILL = { LCOL: "#5dbb63", MCOL: "#f6b73c", HCOL: "#e8554e" } as const;
const TIER_TEXT = { LCOL: "Low cost of living", MCOL: "Medium cost of living", HCOL: "High cost of living" } as const;
const LABELED_STATES = new Set([
  "WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "AZ", "NM", "CO", "ND", "SD", "NE", "KS", "OK", "TX",
  "MN", "IA", "MO", "AR", "LA", "WI", "IL", "MI", "IN", "OH", "KY", "TN", "MS", "AL", "GA", "FL", "SC",
  "NC", "VA", "WV", "PA", "NY", "ME", "AK", "HI",
]);

export class UsMap {
  private readonly el: HTMLElement;
  private selected: StateInfo | null = null;
  private readonly onVisit: (s: StateInfo) => void;
  private readonly stateCenters = new Map<string, [number, number]>();
  private readonly cityLocations = new Map<string, [number, number]>();
  private readonly cityPreviews = new Map<string, string>();

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
        const center = path.centroid(f);
        if (Number.isFinite(center[0]) && Number.isFinite(center[1])) this.stateCenters.set(s.abbr, center);
        return `<path class="state" d="${path(f)}" fill="${TIER_FILL[s.tier]}" data-abbr="${s.abbr}"><title>${s.name}</title></path>`;
      })
      .join("");
    const labels = states
      .filter((s) => LABELED_STATES.has(s.abbr))
      .map((s) => {
        const xy = this.stateCenters.get(s.abbr);
        return xy ? `<text class="state-label" x="${xy[0].toFixed(1)}" y="${xy[1].toFixed(1)}">${s.abbr}</text>` : "";
      })
      .join("");
    const pins = PINS.map((p) => {
      const xy = projection([p.lon, p.lat]);
      if (!xy) return "";
      this.cityLocations.set(p.id, xy);
      return `<g class="pin ${isHandmade(p.id) ? "handmade" : ""}" data-pin="${p.id}" transform="translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)})"><circle r="8"/><text y="-13">${p.name}</text><title>${p.name}</title></g>`;
    }).join("");

    root.innerHTML = `
      <div class="map-card">
        <header>
          <div class="map-title">${pixelIcon("map")}<div><h2>U.S. Map</h2><p>Pick a state or city to visit</p></div></div>
          <button class="round close" data-close title="Close">✕</button>
        </header>
        <div class="map-body">
          <svg viewBox="0 0 ${W} ${H}" class="map-svg">
            <defs>
              <pattern id="map-water-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M0 23.5H24M23.5 0V24" class="water-grid-line"/>
                <rect x="3" y="3" width="3" height="3" class="water-spark"/>
              </pattern>
            </defs>
            <rect class="map-ocean" width="${W}" height="${H}"/>
            <rect class="map-water-grid" width="${W}" height="${H}"/>
            ${paths}${labels}${pins}
            <g class="current-marker" data-current-marker><circle class="current-pulse" r="23"/><circle class="current-ring" r="16"/><circle class="current-core" r="7"/><title>Your current location</title></g>
          </svg>
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

  open(current: StateInfo, preview?: string | null): void {
    if (preview) this.cityPreviews.set(current.cityId, preview);
    this.el.hidden = false;
    this.selected = current;
    this.el.querySelectorAll(".state.current, .pin.current, .state.sel").forEach((node) => node.classList.remove("current", "sel"));
    this.el.querySelector<SVGPathElement>(`.state[data-abbr="${current.abbr}"]`)?.classList.add("current", "sel");
    this.el.querySelector<SVGGElement>(`.pin[data-pin="${current.cityId}"]`)?.classList.add("current");
    const point = this.cityLocations.get(current.cityId) ?? this.stateCenters.get(current.abbr);
    const marker = this.el.querySelector<SVGGElement>("[data-current-marker]");
    if (point && marker) marker.setAttribute("transform", `translate(${point[0].toFixed(1)},${point[1].toFixed(1)})`);
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
    const preview = this.cityPreviews.get(s.cityId);
    const cityPreview = preview
      ? `<div class="city-preview"><img class="thumb" src="${preview}" alt="Live view of ${s.city}" /><span class="preview-badge">CITY VIEW</span></div>`
      : `<div class="city-preview city-preview-empty">${pixelIcon("map")}<strong>City view not visited yet</strong><span>Visit ${s.city} to reveal its real skyline.</span></div>`;
    panel.innerHTML = `
      ${cityPreview}
      <div class="state-panel-heading"><h3>${s.city}, ${s.abbr}</h3><div class="tier ${s.tier.toLowerCase()}">${s.tier}</div></div>
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
