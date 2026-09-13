// A tiny software rasterizer for code-drawn pixel art. Everything is drawn at
// 1x into an RGBA buffer with hard edges (a pixel is filled when its center
// is inside the shape), so nothing is ever anti-aliased, then outlined in the
// same ink as the Blender pixel pass (game/art/lib/pixel.py). It has no DOM,
// so the art can be unit-tested in Node.

/** The outline color: the pixel pass's warm near-black. */
export const INK = 0x2b2233;
/** Cast shadows are the ink at this alpha, the only translucent pixels allowed. */
export const SHADOW_ALPHA = 96;

export interface Paint {
  /** Parts are outlined where they meet a different part drawn later; 0 means "no outline edges". */
  part?: number;
  /** Glowing parts (lamps, lit windows) are never turned into ink. */
  glow?: boolean;
}

export class PixelCanvas {
  readonly w: number;
  readonly h: number;
  /** Where the drawing origin (0, 0) sits in the buffer, which is also the sprite's anchor. */
  readonly ox: number;
  readonly oy: number;
  readonly rgba: Uint8ClampedArray;
  private readonly parts: Uint16Array;
  private readonly glow: Uint8Array;

  constructor(w: number, h: number, ox = 0, oy = 0) {
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.parts = new Uint16Array(w * h);
    this.glow = new Uint8Array(w * h);
  }

  /** Sets one buffer pixel (buffer coordinates, not origin-relative). */
  put(x: number, y: number, color: number, paint: Paint = {}, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.rgba[i * 4] = (color >> 16) & 255;
    this.rgba[i * 4 + 1] = (color >> 8) & 255;
    this.rgba[i * 4 + 2] = color & 255;
    this.rgba[i * 4 + 3] = alpha;
    this.parts[i] = paint.part ?? 0;
    this.glow[i] = paint.glow ? 1 : 0;
  }

  /** The color and alpha at a buffer pixel. */
  at(x: number, y: number): { color: number; alpha: number } {
    const i = (y * this.w + x) * 4;
    return { color: (this.rgba[i] << 16) | (this.rgba[i + 1] << 8) | this.rgba[i + 2], alpha: this.rgba[i + 3] };
  }

  /** A filled polygon; points are origin-relative [x0, y0, x1, y1, ...]. */
  poly(pts: number[], color: number, paint: Paint = {}): this {
    this.scan(pts, (x, y) => this.put(x, y, color, paint));
    return this;
  }

  /** A filled rectangle, origin-relative, snapped to whole pixels. */
  rect(x: number, y: number, w: number, h: number, color: number, paint: Paint = {}): this {
    const x0 = Math.round(x + this.ox), y0 = Math.round(y + this.oy);
    const x1 = Math.round(x + w + this.ox), y1 = Math.round(y + h + this.oy);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.put(px, py, color, paint);
    return this;
  }

  /** A filled ellipse, origin-relative. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, paint: Paint = {}): this {
    const x0 = Math.floor(cx - rx + this.ox), x1 = Math.ceil(cx + rx + this.ox);
    const y0 = Math.floor(cy - ry + this.oy), y1 = Math.ceil(cy + ry + this.oy);
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5 - this.ox - cx) / rx, dy = (py + 0.5 - this.oy - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.put(px, py, color, paint);
      }
    return this;
  }

  /** A 1 px line between two origin-relative points (Bresenham on rounded ends). */
  line(xa: number, ya: number, xb: number, yb: number, color: number, paint: Paint = {}): this {
    let x0 = Math.round(xa + this.ox), y0 = Math.round(ya + this.oy);
    const x1 = Math.round(xb + this.ox), y1 = Math.round(yb + this.oy);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.put(x0, y0, color, paint);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** A flat cast shadow (ink at SHADOW_ALPHA) under the art: only fills empty pixels. */
  shadowPoly(pts: number[]): this {
    this.scan(pts, (x, y) => {
      if (this.rgba[(y * this.w + x) * 4 + 3] === 0) this.put(x, y, INK, {}, SHADOW_ALPHA);
    });
    return this;
  }

  shadowEllipse(cx: number, cy: number, rx: number, ry: number): this {
    const pts: number[] = [];
    for (let k = 0; k < 16; k++) pts.push(cx + Math.cos((k / 16) * Math.PI * 2) * rx, cy + Math.sin((k / 16) * Math.PI * 2) * ry);
    return this.shadowPoly(pts);
  }

  /**
   * The ink outline: every solid pixel next to a see-through one (the
   * silhouette), and every solid pixel next to a later-drawn part (the edges
   * between parts), like the pixel pass. Glowing pixels stay lit.
   */
  outline(opts: { outside?: boolean; ink?: number } = {}): this {
    const { w, h, rgba, parts, glow } = this;
    const ink = opts.ink ?? INK;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] === 255;
    const lit = (x: number, y: number) => solid(x, y) && !glow[y * w + x];
    const mark: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const around = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        if (rgba[i * 4 + 3] !== 255) {
          // Outside: the ring of pixels just beyond the silhouette (small art keeps its colors).
          if (opts.outside && around.some(([nx, ny]) => lit(nx, ny))) mark.push(i);
          continue;
        }
        if (glow[i]) continue;
        let edge = false;
        for (const [nx, ny] of around) {
          if (!solid(nx, ny)) {
            if (!opts.outside) edge = true;
            if (edge) break;
            continue;
          }
          const q = parts[ny * w + nx];
          if (parts[i] && q && q > parts[i] && !glow[ny * w + nx]) {
            edge = true;
            break;
          }
        }
        if (edge) mark.push(i);
      }
    for (const i of mark) {
      rgba[i * 4] = (ink >> 16) & 255;
      rgba[i * 4 + 1] = (ink >> 8) & 255;
      rgba[i * 4 + 2] = ink & 255;
      rgba[i * 4 + 3] = 255;
      parts[i] = 0;
    }
    return this;
  }

  /** Solid pixels, as a count (tests and sanity checks). */
  get solidCount(): number {
    let n = 0;
    for (let i = 3; i < this.rgba.length; i += 4) if (this.rgba[i] === 255) n++;
    return n;
  }

  /** Calls `fill` for every buffer pixel whose center is inside the polygon (even-odd). */
  private scan(pts: number[], fill: (x: number, y: number) => void): void {
    const n = pts.length / 2;
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      minY = Math.min(minY, pts[k * 2 + 1] + this.oy);
      maxY = Math.max(maxY, pts[k * 2 + 1] + this.oy);
    }
    for (let py = Math.max(0, Math.floor(minY)); py <= Math.min(this.h - 1, Math.ceil(maxY)); py++) {
      const cy = py + 0.5;
      const xs: number[] = [];
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2] + this.ox, ay = pts[k * 2 + 1] + this.oy;
        const bx = pts[((k + 1) % n) * 2] + this.ox, by = pts[((k + 1) % n) * 2 + 1] + this.oy;
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let px = Math.ceil(xs[k] - 0.5); px + 0.5 <= xs[k + 1]; px++) fill(px, py);
    }
  }
}
