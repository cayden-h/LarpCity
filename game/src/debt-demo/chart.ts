// Robinhood-style charts for the Money desk: one line, no axes, a dotted line
// at the range's starting value, and pointer scrubbing that reports the point
// under the cursor so the page can update its big number. Sparklines are the
// same idea at row size.

export interface ChartPt {
  /** Game day. */
  x: number;
  y: number;
}

/** A comparison line under the main one: its CSS class and an optional direct label. */
export interface ChartLine {
  pts: ChartPt[];
  cls: string;
  label?: string;
}

export interface BigChartOpts {
  pts: ChartPt[];
  /** Extra comparison lines, drawn under the main line and labeled at their right end. */
  lines?: ChartLine[];
  /** Include $0 in the range (money charts start at zero, research/12). */
  zero?: boolean;
  /** Draw the dotted baseline at the first point's value. */
  baseline?: boolean;
  /** Smallest y span to draw, so a 1-point score change doesn't fill the chart. */
  minSpan?: number;
  /** Called with the point under the pointer, or null when the pointer leaves. */
  onScrub: (p: ChartPt | null) => void;
  /** Label above the cursor for a point (usually its date). */
  label: (p: ChartPt) => string;
  /** Direct label for the main line, anchored at its last point, alongside any extra lines' labels. */
  mainLabel?: string;
}

const W = 1000;
const H = 240;
const PAD = 14;

export function mountBigChart(el: HTMLElement, o: BigChartOpts): void {
  const extra = (o.lines ?? []).filter((l) => l.pts.length > 1);
  const all = o.pts.concat(...extra.map((l) => l.pts));
  if (o.pts.length < 2) {
    // A day-0 run has one snapshot; show a flat line instead of an empty box.
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="bc-line" vector-effect="non-scaling-stroke"/></svg><div class="bc-empty">Press play or skip ahead to build your history</div>`;
    el.onpointermove = el.onpointerleave = null;
    return;
  }
  const ys = all.map((p) => p.y);
  const lo = o.zero ? Math.min(0, ...ys) : Math.min(...ys);
  const hi = o.zero ? Math.max(0, ...ys) : Math.max(...ys);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, (o.minSpan ?? 0) / 2, Math.abs(mid) * 1e-4, 1e-6);
  // All lines share one x-domain, so a longer comparison line (minimums only) narrows the main line.
  const x0 = Math.min(...all.map((p) => p.x));
  const x1 = Math.max(...all.map((p) => p.x));
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const Y = (y: number) => PAD + (1 - (y - (mid - half)) / (half * 2)) * (H - PAD * 2);
  const path = (arr: ChartPt[]) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const base = o.baseline === false ? "" : `<line x1="0" x2="${W}" y1="${Y(o.pts[0].y).toFixed(1)}" y2="${Y(o.pts[0].y).toFixed(1)}" class="bc-base" vector-effect="non-scaling-stroke"/>`;
  const extraPaths = extra.map((l) => `<path d="${path(l.pts)}" class="${l.cls}" vector-effect="non-scaling-stroke"/>`).join("");
  const tagLines: ChartLine[] = o.mainLabel ? [...extra, { pts: o.pts, cls: "", label: o.mainLabel }] : extra;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart">
      ${base}${extraPaths}<path d="${path(o.pts)}" class="bc-line" vector-effect="non-scaling-stroke"/>
      <line class="bc-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke" visibility="hidden"/>
    </svg>${tagsHtml(tagLines, Y)}<div class="bc-when" hidden></div><span class="bc-dot" hidden></span>`;
  const svg = el.querySelector("svg")!;
  const cursor = el.querySelector<SVGLineElement>(".bc-cursor")!;
  const when = el.querySelector<HTMLElement>(".bc-when")!;
  const dot = el.querySelector<HTMLElement>(".bc-dot")!;
  el.onpointermove = (ev) => {
    const r = svg.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const target = x0 + fx * (x1 - x0);
    let p = o.pts[0];
    for (const q of o.pts) if (Math.abs(q.x - target) < Math.abs(p.x - target)) p = q;
    const px = (X(p.x) / W) * r.width;
    cursor.setAttribute("x1", X(p.x).toFixed(1));
    cursor.setAttribute("x2", X(p.x).toFixed(1));
    cursor.setAttribute("visibility", "visible");
    when.hidden = false;
    when.textContent = o.label(p);
    when.style.left = `${Math.max(40, Math.min(r.width - 40, px))}px`;
    dot.hidden = false;
    dot.style.left = `${px}px`;
    dot.style.top = `${(Y(p.y) / H) * r.height}px`;
    o.onScrub(p);
  };
  el.onpointerleave = () => {
    cursor.setAttribute("visibility", "hidden");
    when.hidden = true;
    dot.hidden = true;
    o.onScrub(null);
  };
}

const TAG_GAP = 16;
/** A label sits above its line's end (desk.css .bc-tag), so it needs headroom below the top edge. */
const TAG_H = 18;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Where to put direct labels so they never overlap or leave the plot: sorted
 * top to bottom, pushed down to keep `gap` apart, then pulled back up from the
 * bottom edge. Returns the y positions in the input's order.
 */
export function placeTags(ys: number[], top: number, bottom: number, gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 0; k < order.length; k++) order[k].y = Math.max(order[k].y, top, k ? order[k - 1].y + gap : top);
  for (let k = order.length - 1; k >= 0; k--) order[k].y = Math.max(top, Math.min(order[k].y, k < order.length - 1 ? order[k + 1].y - gap : bottom));
  const out: number[] = new Array(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** Direct labels at each extra line's right end, nudged apart so they never overlap. */
function tagsHtml(lines: ChartLine[], Y: (y: number) => number): string {
  const labeled = lines.filter((l): l is ChartLine & { label: string } => !!l.label);
  const ys = placeTags(
    labeled.map((l) => Y(l.pts[l.pts.length - 1].y)),
    PAD + TAG_H,
    H - PAD,
    TAG_GAP,
  );
  return labeled.map((l, i) => `<span class="bc-tag" style="top:${((ys[i] / H) * 100).toFixed(2)}%">${esc(l.label)}</span>`).join("");
}

/** A row-sized line; `tone` picks the color class. */
export function spark(values: number[], tone: "up" | "down" | "flat"): string {
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"><line x1="0" x2="72" y1="14" y2="14" class="sp-${tone}"/></svg>`;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 72).toFixed(1)},${(26 - ((v - lo) / (hi - lo || 1)) * 24).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"><path d="${d}" class="sp-${tone}"/></svg>`;
}

/** Evenly thins a long series to about `max` points so paths stay light. */
export function thin<T>(arr: T[], max = 400): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}
