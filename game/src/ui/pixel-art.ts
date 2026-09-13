// Grid-drawn pixel art: each string is one row, each character one pixel, looked up in a
// palette (characters missing from it, like ".", stay transparent). Runs of a color merge into
// one rectangle, so the SVG stays small and every pixel edge is crisp.

export function pixelArt(rows: readonly string[], palette: Readonly<Record<string, string>>, className = ""): string {
  const width = Math.max(...rows.map((row) => row.length));
  const paths = new Map<string, string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      const fill = palette[row[x]];
      if (fill) paths.set(fill, `${paths.get(fill) ?? ""}M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  const body = [...paths].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join("");
  return `<svg class="pixel-art ${className}" viewBox="0 0 ${width} ${rows.length}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${body}</svg>`;
}

const BUST_PALETTE = { k: "#101a23", s: "#f2c29a", S: "#d49a70", e: "#101a23", m: "#9a3b3b" };

/** The player's head and shoulders, 12 × 12, for the Player card and the intake's avatar picker. */
const BUSTS = {
  male: {
    rows: [
      "...kkkkkk...",
      "..khhhhhhk..",
      ".khhhhhhhhk.",
      ".khsssssshk.",
      ".kssessessk.",
      ".kssssssssk.",
      ".kSssmmssSk.",
      "..kSssssSk..",
      "...kkSSkk...",
      ".kkttttttkk.",
      "kttttttttttk",
      "kTttttttttTk",
    ],
    palette: { ...BUST_PALETTE, h: "#5a3a22", t: "#2d7fd6", T: "#1b5ea8" },
  },
  female: {
    rows: [
      "...kkkkkk...",
      "..khhhhhhk..",
      ".khhhhhhhhk.",
      ".khhsssshhk.",
      ".khsesseshk.",
      ".khsssssshk.",
      ".khSsmmsShk.",
      ".khhSssShhk.",
      ".khhkSSkhhk.",
      ".kkttttttkk.",
      "kttttttttttk",
      "kTttttttttTk",
    ],
    palette: { ...BUST_PALETTE, h: "#a8552a", t: "#e0508a", T: "#b13566" },
  },
} as const;

export function playerBust(avatar: "male" | "female", className = ""): string {
  const { rows, palette } = BUSTS[avatar];
  return pixelArt(rows, palette, className);
}
