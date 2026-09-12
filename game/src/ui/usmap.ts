// The states map: every state shaded by its cost-of-living tier (BEA RPP).
// Rendered in retro pixel-art style with stepped orthogonal geometry,
// pixel pins, floating continental shadow, and instant skyline previews.

import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import us from "us-atlas/states-10m.json";
import { isHandmade, PINS, stateForPin } from "../cities";
import type { StateInfo } from "../engine/types";
import { pixelIcon } from "./pixel-icons";

/** Per-pin pixel nudges, for pins whose true lon/lat lands a label on top of
 * something else (Austin's sits right under the Texas state-abbreviation
 * label). Purely cosmetic — doesn't touch the underlying geography. */
const PIN_NUDGE: Record<string, [number, number]> = {
  austin: [0, 16],
};

const TIER_FILL = { LCOL: "#4fb25c", MCOL: "#f5b027", HCOL: "#e84e47" } as const;
const TIER_TEXT = { LCOL: "Low cost of living", MCOL: "Medium cost of living", HCOL: "High cost of living" } as const;
const LABELED_STATES = new Set([
  "WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "AZ", "NM", "CO", "ND", "SD", "NE", "KS", "OK", "TX",
  "MN", "IA", "MO", "AR", "LA", "WI", "IL", "MI", "IN", "OH", "KY", "TN", "MS", "AL", "GA", "FL", "SC",
  "NC", "VA", "WV", "PA", "NY", "ME", "AK", "HI",
]);

const GRID_STEP = 4;

function snap(v: number): number {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

/** Generate orthogonal Manhattan stair-steps between two snapped points. */
function pixelLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [[x0, y0]];
  let cx = x0;
  let cy = y0;
  const sx = x0 < x1 ? GRID_STEP : -GRID_STEP;
  const sy = y0 < y1 ? GRID_STEP : -GRID_STEP;
  const stepsX = Math.round(Math.abs(x1 - x0) / GRID_STEP);
  const stepsY = Math.round(Math.abs(y1 - y0) / GRID_STEP);
  let err = stepsX - stepsY;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -stepsY) {
      err -= stepsY;
      cx += sx;
    }
    if (e2 < stepsX) {
      err += stepsX;
      cy += sy;
    }
    pts.push([cx, cy]);
  }
  return pts;
}

export class UsMap {
  private readonly el: HTMLElement;
  private selected: StateInfo | null = null;
  private readonly onVisit: (s: StateInfo) => void;
  private readonly stateCenters = new Map<string, [number, number]>();
  private readonly cityLocations = new Map<string, [number, number]>();
  /** Real screenshots of the live PixiJS render, captured while playing in that city. */
  private readonly cityPreviews = new Map<string, string>();
  /** Off-screen renders of every city (see engine/thumbnails.ts), so a state doesn't need a visit to show a real render. */
  private readonly cityPrerenders = new Map<string, string>();
  /** Every state's pixel-stepped outline, keyed by abbr, reused by the outline overlays. */
  private readonly stateOutlines = new Map<string, string>();

  constructor(root: HTMLElement, states: StateInfo[], onVisit: (s: StateInfo) => void) {
    this.el = root;
    this.onVisit = onVisit;
    const byFips = new Map(states.map((s) => [s.fips, s]));
    const topo = us as unknown as Topology<{ states: GeometryCollection }>;
    const geo = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>;
    const W = 960, H = 600;
    const projection = geoAlbersUsa().fitSize([W, H - 20], geo);
    const path = geoPath(projection);

    // Decode TopoJSON transform
    const transform = topo.transform;
    const scale = transform ? transform.scale : [1, 1];
    const translate = transform ? transform.translate : [0, 0];

    const decodeArc = (arc: number[][]): [number, number][] => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => {
        x += dx;
        y += dy;
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
      });
    };

    // Pre-calculate pixel-quantized stair-stepped arcs to guarantee 100% seamless shared borders
    const pixelArcs: [number, number][][] = topo.arcs.map((rawArc) => {
      const coords = decodeArc(rawArc);
      const projected = coords.map((c) => projection(c) as [number, number] | null).filter((p): p is [number, number] => p !== null);
      if (projected.length === 0) return [];
      const snapped = projected.map(([x, y]) => [snap(x), snap(y)] as [number, number]);

      const deduped: [number, number][] = [snapped[0]];
      for (let i = 1; i < snapped.length; i++) {
        if (snapped[i][0] !== deduped[deduped.length - 1][0] || snapped[i][1] !== deduped[deduped.length - 1][1]) {
          deduped.push(snapped[i]);
        }
      }

      const stepped: [number, number][] = [deduped[0]];
      for (let i = 1; i < deduped.length; i++) {
        const seg = pixelLine(deduped[i - 1][0], deduped[i - 1][1], deduped[i][0], deduped[i][1]);
        for (let j = 1; j < seg.length; j++) {
          stepped.push(seg[j]);
        }
      }
      return stepped;
    });

    const getArc = (idx: number): [number, number][] => {
      if (idx >= 0) return pixelArcs[idx] ?? [];
      return [...(pixelArcs[~idx] ?? [])].reverse();
    };

    const ringToPath = (ring: number[]): string => {
      const pts: [number, number][] = [];
      for (const arcIdx of ring) {
        const arc = getArc(arcIdx);
        for (const p of arc) {
          if (pts.length === 0 || pts[pts.length - 1][0] !== p[0] || pts[pts.length - 1][1] !== p[1]) {
            pts.push(p);
          }
        }
      }
      if (pts.length < 3) return "";
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        d += `L${pts[i][0]},${pts[i][1]}`;
      }
      return d + "Z";
    };

    const geomToPixelPath = (geom: any): string => {
      if (geom.type === "Polygon") {
        return geom.arcs.map(ringToPath).join("");
      } else if (geom.type === "MultiPolygon") {
        return geom.arcs.flatMap((poly: number[][]) => poly.map(ringToPath)).join("");
      }
      return "";
    };

    // Calculate state centers and paths
    const statePathList: { state: StateInfo; d: string }[] = [];
    geo.features.forEach((f) => {
      const s = byFips.get(String(f.id).padStart(2, "0"));
      if (!s) return;
      const center = path.centroid(f);
      if (Number.isFinite(center[0]) && Number.isFinite(center[1])) {
        this.stateCenters.set(s.abbr, [snap(center[0]), snap(center[1])]);
      }
      const rawGeom = topo.objects.states.geometries.find((g: any) => String(g.id) === String(f.id) || String(g.id).padStart(2, "0") === s.fips);
      const d = rawGeom ? geomToPixelPath(rawGeom) : path(f) || "";
      if (d) {
        statePathList.push({ state: s, d });
        this.stateOutlines.set(s.abbr, d);
      }
    });

    const shadowPaths = statePathList
      .map(({ d }) => `<path class="state-shadow" d="${d}" />`)
      .join("");

    const paths = statePathList
      .map(({ state: s, d }) => `<path class="state" d="${d}" fill="${TIER_FILL[s.tier]}" data-abbr="${s.abbr}"><title>${s.name} (${s.tier})</title></path>`)
      .join("");

    const labels = states
      .filter((s) => LABELED_STATES.has(s.abbr))
      .map((s) => {
        const xy = this.stateCenters.get(s.abbr);
        return xy ? `<text class="state-label" x="${xy[0]}" y="${xy[1]}">${s.abbr}</text>` : "";
      })
      .join("");

    const pins = PINS.map((p) => {
      const xy = projection([p.lon, p.lat]);
      if (!xy) return "";
      const [nx, ny] = PIN_NUDGE[p.id] ?? [0, 0];
      const px = snap(xy[0]) + nx;
      const py = snap(xy[1]) + ny;
      this.cityLocations.set(p.id, [px, py]);
      const labelW = p.name.length * 8 + 14;
      return `
        <g class="pin ${isHandmade(p.id) ? "handmade" : ""}" data-pin="${p.id}" style="--px:${px}px;--py:${py}px">
          <!-- Pixel Pin Graphic -->
          <rect class="pin-shadow" x="-8" y="2" width="16" height="4" />
          <path class="pin-base" d="M-7,-19 h14 v10 h-2 v2 h-2 v4 h-4 v-4 h-2 v-2 h-4 z" />
          <path class="pin-fill" d="M-5,-17 h10 v7 h-2 v2 h-2 v4 h-0 v-4 h-2 v-2 h-4 z" />
          <rect class="pin-highlight" x="-4" y="-16" width="3" height="3" />
          <rect class="pin-core" x="-1" y="-12" width="3" height="3" />
          <!-- Pixel Label Badge -->
          <g class="pin-badge" transform="translate(0, -27)">
            <rect class="pin-bg" x="${-labelW / 2}" y="-8" width="${labelW}" height="16" />
            <rect class="pin-border" x="${-labelW / 2 + 2}" y="-6" width="${labelW - 4}" height="12" />
            <text class="pin-text" x="0" y="1">${p.name}</text>
          </g>
          <title>${p.name}</title>
        </g>`;
    }).join("");

    root.innerHTML = `
      <div class="map-card pixel-map-card">
        <header class="map-header">
          <div class="map-title">${pixelIcon("map")}<div><h2>U.S. MAP</h2><p>Select any state or city to inspect costs & view skyline</p></div></div>
          <button class="round close" data-close title="Close">✕</button>
        </header>
        <div class="map-body">
          <div class="map-viewport">
            <svg viewBox="0 0 ${W} ${H}" class="map-svg" shape-rendering="crispEdges">
              <defs>
                <pattern id="map-water-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M0 31.5H32M31.5 0V32" class="water-grid-line"/>
                  <rect x="4" y="4" width="2" height="2" class="water-spark"/>
                  <rect x="20" y="20" width="2" height="2" class="water-spark"/>
                </pattern>
              </defs>
              <rect class="map-ocean" width="${W}" height="${H}"/>
              <rect class="map-water-grid" width="${W}" height="${H}"/>
              
              <!-- Retro ocean wave details -->
              <g class="ocean-waves" fill="none" stroke="#48a6bf" stroke-width="2">
                <path d="M 60,180 h8 v-2 h8 v2 h8 M 200,90 h8 v-2 h8 v2 h8 M 760,120 h8 v-2 h8 v2 h8 M 840,240 h8 v-2 h8 v2 h8 M 520,530 h8 v-2 h8 v2 h8 M 720,520 h8 v-2 h8 v2 h8 M 120,440 h8 v-2 h8 v2 h8" />
              </g>

              <!-- Retro Compass Rose -->
              <g class="pixel-compass" transform="translate(${W - 42}, ${H - 42})">
                <circle cx="0" cy="0" r="30" class="compass-ring" />
                <rect x="-20" y="-20" width="40" height="40" class="compass-box" transform="rotate(45)" />
                <polygon points="0,-26 5,-6 -5,-6" class="compass-needle-n" />
                <polygon points="0,-26 0,-6 5,-6" class="compass-needle-n-hi" />
                <polygon points="0,26 5,6 -5,6" class="compass-needle-s" />
                <polygon points="26,0 6,5 6,-5" class="compass-needle-e" />
                <polygon points="-26,0 -6,5 -6,-5" class="compass-needle-w" />
                <text x="0" y="-30" class="compass-text compass-n">N</text>
                <text x="34" y="4" class="compass-text">E</text>
                <text x="0" y="38" class="compass-text">S</text>
                <text x="-34" y="4" class="compass-text">W</text>
                <rect x="-3" y="-3" width="6" height="6" fill="#101a23" />
                <rect x="-1" y="-1" width="2" height="2" fill="#ffe249" />
              </g>

              <!-- Continental 3D pixel shadow -->
              <g class="states-shadow-layer" transform="translate(4, 4)">
                ${shadowPaths}
              </g>

              <!-- State Polygons, Labels & Pins -->
              <g class="states-layer">
                ${paths}
              </g>

              <!-- Highlight outlines: separate top layer so a state's full border always
                   draws over every neighbor's border, regardless of paint order. -->
              <g class="outline-layer" pointer-events="none">
                <path class="state-outline outline-current" data-outline-current fill="none" />
                <path class="state-outline outline-sel" data-outline-sel fill="none" />
                <path class="state-outline outline-hover" data-outline-hover fill="none" />
              </g>
              <g class="labels-layer">
                ${labels}
              </g>
              <g class="pins-layer">
                ${pins}
              </g>

              <!-- Current Location Player Beacon: a planted flag, with the
                   city name on a plaque underneath. -->
              <g class="current-marker" data-current-marker>
                <ellipse class="flag-shadow" cx="0" cy="1.5" rx="6" ry="2" />
                <rect class="flag-pole" x="-1.2" y="-24" width="2.4" height="25.5" />
                <rect class="flag-ball" x="-2.5" y="-27.5" width="5" height="4" />
                <!-- A wide, short banner (not a tall pennant): 28 wide by 13 tall. -->
                <polygon class="flag-fabric-outline" points="0,-24 28,-24 28,-20 23,-17.5 28,-15 28,-11 0,-11" />
                <polygon class="flag-fabric" points="1.3,-22.6 25.7,-22.6 25.7,-19.6 21.2,-17.5 25.7,-15.4 25.7,-12.4 1.3,-12.4" />
                <polygon class="flag-fabric-hi" points="1.3,-22.6 14.5,-22.6 14.5,-17.5 1.3,-17.5" />
                <g class="current-location-plaque" transform="translate(0, 12)">
                  <rect class="current-plaque-bg" data-current-plaque-bg x="-30" y="-8" width="60" height="16" />
                  <rect class="current-plaque-border" data-current-plaque-border x="-27" y="-6" width="54" height="12" />
                  <text class="current-location-label" x="0" y="1" data-current-location></text>
                </g>
                <title>Your current location</title>
              </g>
            </svg>
          </div>
          <aside class="state-panel pixel-state-panel" data-panel>
            <div class="empty">Hover or tap a state</div>
          </aside>
        </div>
        <footer class="legend">
          <div class="legend-tiers">
            ${(["LCOL", "MCOL", "HCOL"] as const).map((t) => `<span><i style="background:${TIER_FILL[t]}"></i>${t} · ${TIER_TEXT[t]}</span>`).join("")}
          </div>
          <span class="src">BEA Regional Price Parities (2024) · 100 = U.S. Baseline</span>
        </footer>
      </div>`;

    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
    root.querySelector("[data-close]")!.addEventListener("click", () => this.close());
    root.querySelectorAll<SVGPathElement>(".state").forEach((p) => {
      const s = states.find((st) => st.abbr === p.dataset.abbr)!;
      p.addEventListener("mouseenter", () => {
        this.setOutline("hover", s.abbr);
        this.show(s);
      });
      p.addEventListener("click", () => {
        this.show(s);
        this.selected = s;
        root.querySelectorAll(".state.sel").forEach((n) => n.classList.remove("sel"));
        p.classList.add("sel");
        this.setOutline("sel", s.abbr);
      });
    });
    // Pins open the specialized cities (Dallas and Austin share Texas with Houston).
    root.querySelectorAll<SVGGElement>(".pin").forEach((g) => {
      const s = stateForPin(g.dataset.pin!, states);
      if (!s) return;
      g.addEventListener("mouseenter", () => {
        this.setOutline("hover", s.abbr);
        this.show(s);
      });
      g.addEventListener("click", () => {
        this.show(s);
        this.selected = s;
        root.querySelectorAll(".state.sel").forEach((n) => n.classList.remove("sel"));
        root.querySelector<SVGPathElement>(`.state[data-abbr="${s.abbr}"]`)?.classList.add("sel");
        this.setOutline("sel", s.abbr);
      });
    });
    root.querySelector(".map-svg")!.addEventListener("mouseleave", () => {
      this.setOutline("hover", null);
      if (this.selected) this.show(this.selected);
    });
  }

  /** Points one of the three overlay outlines (current/sel/hover) at a state's border,
   * or clears it. A dedicated top layer, so the highlighted border always draws over
   * every neighboring state's border instead of losing a paint-order race to it. */
  private setOutline(which: "hover" | "sel" | "current", abbr: string | null): void {
    const el = this.el.querySelector<SVGPathElement>(`[data-outline-${which}]`);
    el?.setAttribute("d", abbr ? this.stateOutlines.get(abbr) ?? "" : "");
  }

  open(current: StateInfo, preview?: string | null): void {
    if (preview) this.cityPreviews.set(current.cityId, preview);
    this.el.hidden = false;
    this.selected = current;
    this.el.querySelectorAll(".state.current, .pin.current, .state.sel").forEach((node) => node.classList.remove("current", "sel"));
    this.el.querySelector<SVGPathElement>(`.state[data-abbr="${current.abbr}"]`)?.classList.add("current", "sel");
    this.el.querySelector<SVGGElement>(`.pin[data-pin="${current.cityId}"]`)?.classList.add("current");
    this.setOutline("current", current.abbr);
    this.setOutline("sel", current.abbr);
    this.setOutline("hover", null);
    const point = this.cityLocations.get(current.cityId) ?? this.stateCenters.get(current.abbr);
    const marker = this.el.querySelector<SVGGElement>("[data-current-marker]");
    if (point && marker) marker.setAttribute("transform", `translate(${point[0].toFixed(1)},${point[1].toFixed(1)})`);
    const locationLabel = this.el.querySelector("[data-current-location]");
    if (locationLabel) locationLabel.textContent = current.city;
    // Size the plaque to the name, the same way a pin's own label does.
    const plaqueW = current.city.length * 8 + 14;
    this.el.querySelector("[data-current-plaque-bg]")?.setAttribute("x", (-plaqueW / 2).toString());
    this.el.querySelector("[data-current-plaque-bg]")?.setAttribute("width", plaqueW.toString());
    this.el.querySelector("[data-current-plaque-border]")?.setAttribute("x", (-plaqueW / 2 + 2).toString());
    this.el.querySelector("[data-current-plaque-border]")?.setAttribute("width", (plaqueW - 4).toString());
    this.show(current);
  }

  close(): void {
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** A background-rendered thumbnail for a city that hasn't been visited (a real
   * capture from `open()` always wins, so this never overwrites one). */
  setPreview(cityId: string, dataUrl: string): void {
    if (this.cityPreviews.has(cityId) || this.cityPrerenders.has(cityId)) return;
    this.cityPrerenders.set(cityId, dataUrl);
    if (this.selected?.cityId === cityId) this.show(this.selected);
  }

  hasPreview(cityId: string): boolean {
    return this.cityPreviews.has(cityId) || this.cityPrerenders.has(cityId);
  }

  private gaugeBar(val: number): string {
    const pct = Math.min(100, Math.max(10, Math.round(((val - 50) / 110) * 100)));
    const colorClass = val < 90 ? "bar-low" : val <= 110 ? "bar-med" : "bar-high";
    return `<div class="rpp-meter"><div class="rpp-fill ${colorClass}" style="width: ${pct}%"></div></div>`;
  }

  private show(s: StateInfo): void {
    const panel = this.el.querySelector("[data-panel]") as HTMLElement;
    // Real screenshots of the live PixiJS render, captured while playing in a
    // city, always win; every city also gets an off-screen render the moment
    // the game boots (engine/thumbnails.ts) so a state doesn't need a visit
    // to show a real render — a static AI-plate photo clashed with the game's
    // flat pixel-art look, so this never falls back to one of those.
    const live = this.cityPreviews.get(s.cityId);
    const rendered = live ?? this.cityPrerenders.get(s.cityId);

    const cityPreview = rendered
      ? `
      <div class="city-preview pixel-frame">
        <img class="thumb" src="${rendered}" alt="${live ? "Live in-game" : "In-game render"} view of ${s.city}" />
        <span class="preview-badge">${live ? "LIVE IN-GAME" : "IN-GAME RENDER"}</span>
        <div class="preview-scanlines"></div>
      </div>`
      : `
      <div class="city-preview pixel-frame unvisited">
        ${pixelIcon("home", "preview-placeholder-icon")}
        <span class="preview-placeholder-text">Rendering ${s.city}…</span>
        <div class="preview-scanlines"></div>
      </div>`;

    panel.innerHTML = `
      ${cityPreview}
      <div class="state-panel-heading">
        <div class="state-name-wrap">
          <h3>${s.city}, ${s.abbr}</h3>
          <span class="state-fullname">${s.name}</span>
        </div>
        <div class="tier ${s.tier.toLowerCase()}">${s.tier}</div>
      </div>
      <dl class="pixel-stats">
        <dt>Overall Cost</dt>
        <dd>
          <span>${s.rpp.all.toFixed(1)} <small>(US=100)</small></span>
          ${this.gaugeBar(s.rpp.all)}
        </dd>
        <dt>Housing</dt>
        <dd>
          <span>${s.rpp.housing.toFixed(1)}</span>
          ${this.gaugeBar(s.rpp.housing)}
        </dd>
        <dt>Goods</dt>
        <dd>
          <span>${s.rpp.goods.toFixed(1)}</span>
          ${this.gaugeBar(s.rpp.goods)}
        </dd>
        <dt>Utilities</dt>
        <dd>
          <span>${s.rpp.utilities.toFixed(1)}</span>
          ${this.gaugeBar(s.rpp.utilities)}
        </dd>
      </dl>
      <div class="panel-actions">
        <button class="btn btn-visit" data-visit>Visit ${s.city} (free)</button>
        <button class="btn ghost btn-move" disabled title="Moving is part of the simulation">Move here · ~$4,500 + deposit</button>
      </div>`;

    panel.querySelector("[data-visit]")!.addEventListener("click", () => {
      this.close();
      this.onVisit(s);
    });
  }
}

