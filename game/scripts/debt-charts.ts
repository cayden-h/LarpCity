// Draws the payoff-strategy chart for the pitch deck from the real engine.
// Run from game/: `node scripts/debt-charts.ts` (writes ../docs/diagrams/debt/05-payoff-strategies.svg).

import { writeFileSync } from "node:fs";
import { compareStrategies, sampleHousehold, type Projection } from "../src/sim/debt/index.ts";

const EXTRA = 300;
const book = sampleHousehold(0);
const cmp = compareStrategies(book.debts, EXTRA);

const W = 1600;
const H = 900;
const plot = { x: 140, y: 190, w: 1000, h: 560 };
const maxMonths = Math.ceil(Math.max(cmp.minimums.months, cmp.snowball.months, cmp.avalanche.months) / 12) * 12;
const maxBal = Math.ceil(cmp.minimums.series[0] / 10_000) * 10_000;
const X = (m: number) => plot.x + (m / maxMonths) * plot.w;
const Y = (b: number) => plot.y + plot.h - (b / maxBal) * plot.h;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const COLORS = { minimums: "#8A99A4", snowball: "#0A5EB0", avalanche: "#D01012" } as const;
const LABEL = { minimums: "Minimums only", snowball: "Snowball + $300", avalanche: "Avalanche + $300" } as const;

// Snowball and avalanche nearly overlap, so avalanche is drawn wide underneath and snowball thin on top.
const WIDTH = { minimums: 4, avalanche: 10, snowball: 4 } as const;
const line = (p: Projection, dash = "") =>
  `<polyline fill="none" stroke="${COLORS[p.strategy]}" stroke-width="${WIDTH[p.strategy]}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ""} points="${p.series.map((b, m) => `${X(m).toFixed(1)},${Y(b).toFixed(1)}`).join(" ")}"/>`;

const grid: string[] = [];
for (let b = 0; b <= maxBal; b += 10_000) {
  grid.push(`<line x1="${plot.x}" y1="${Y(b)}" x2="${plot.x + plot.w}" y2="${Y(b)}" stroke="#E3E8EC" stroke-width="1.5"/>`);
  grid.push(`<text x="${plot.x - 16}" y="${Y(b) + 6}" font-size="18" fill="#5B6B76" text-anchor="end">${b === 0 ? "$0" : `$${b / 1000}k`}</text>`);
}
for (let m = 0; m <= maxMonths; m += 12) {
  grid.push(`<text x="${X(m)}" y="${plot.y + plot.h + 34}" font-size="18" fill="#5B6B76" text-anchor="middle">${m / 12}</text>`);
}

// First-win markers: the month each strategy closes its first account.
const marker = (p: Projection, dy: number) => {
  const first = p.payoffs[0];
  const x = X(first.month);
  const y = Y(p.series[first.month]);
  return `<circle cx="${x}" cy="${y}" r="9" fill="#FFFFFF" stroke="${COLORS[p.strategy]}" stroke-width="4"/>
  <text x="${x + 22}" y="${y + dy}" font-size="18" font-weight="700" fill="${COLORS[p.strategy]}">First debt gone: month ${first.month} (${first.name})</text>`;
};

const card = (p: Projection, i: number) => {
  const y = 200 + i * 176;
  const years = (p.months / 12).toFixed(1);
  return `<rect x="1190" y="${y}" width="350" height="152" rx="18" fill="#FFFFFF" stroke="${COLORS[p.strategy]}" stroke-width="${p.strategy === "minimums" ? 2 : 3}"/>  <text x="1222" y="${y + 40}" font-size="22" font-weight="700">${LABEL[p.strategy]}</text>
  <text x="1222" y="${y + 84}" font-size="34" font-weight="800">${years} yrs</text>
  <text x="1222" y="${y + 120}" font-size="19" fill="#5B6B76">${money(p.interest)} interest · first win month ${p.payoffs[0].month}</text>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Payoff strategies from the Larp City engine for a household with $44,500 of debt: minimum payments take ${(cmp.minimums.months / 12).toFixed(1)} years and ${money(cmp.minimums.interest)} of interest; adding $300 a month cuts that to about ${(cmp.avalanche.months / 12).toFixed(1)} years with either order, and snowball wins its first account far sooner than avalanche.">
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
<g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#1B2A34">
<text x="60" y="78" font-size="40" font-weight="700">The extra $300 matters more than the order</text>
<text x="60" y="116" font-size="22" fill="#5B6B76">Sample household: $1.5k furniture loan, $7k card, $14k car, $22k student loans. Computed by the game engine.</text>
${grid.join("\n")}
<line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" stroke="#1B2A34" stroke-width="2"/>
<text x="${plot.x + plot.w / 2}" y="${plot.y + plot.h + 72}" font-size="19" fill="#5B6B76" text-anchor="middle">years from today</text>
<text x="${plot.x}" y="${plot.y - 20}" font-size="19" fill="#5B6B76">total owed</text>
${line(cmp.minimums, "10 8")}
${line(cmp.avalanche)}
${line(cmp.snowball)}
${marker(cmp.snowball, -14)}
${marker(cmp.avalanche, 30)}
${card(cmp.minimums, 0)}
${card(cmp.snowball, 1)}
${card(cmp.avalanche, 2)}
</g>
</svg>
`;

const out = new URL("../../docs/diagrams/debt/05-payoff-strategies.svg", import.meta.url);
writeFileSync(out, svg);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(cmp).map(([k, p]) => [k, { months: p.months, interest: Math.round(p.interest), first: p.payoffs[0], stuck: p.stuck }]),
    ),
  ),
);
