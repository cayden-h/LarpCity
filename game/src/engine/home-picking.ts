/** An isometric one-tile home's body, excluding its texture padding and cast shadow. */
export function hitsHomeBody(wx: number, wy: number, x: number, y: number, height: number): boolean {
  const dx = Math.abs(wx - (x - y) * 32);
  if (dx > 32) return false;
  const cy = (x + y + 1) * 16;
  const half = 16 - dx / 2;
  return wy >= cy - half - height && wy <= cy + half;
}
