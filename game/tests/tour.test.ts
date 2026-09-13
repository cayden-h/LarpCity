// Sammy's tours: the step machinery (order, advancing, branching on the
// player's state), where Sammy stands, the record in the save, the tour lines
// in the voice pack, and the name: no "Narrator" left anywhere the player reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allLines, cueForEvents, NARRATOR_NAME, stripTags } from "../src/narration/lines.ts";
import { parseTourRecord, placeBox, recordTour, shouldOffer, tourLines, TourRun, type TourDef } from "../src/narration/tour.ts";
import { answerLine, STOCKS_TOUR, TAXES_REFRESHER, TAXES_TOUR, type StocksCtx, type TaxesCtx } from "../src/narration/tours.ts";
import { bracketSlices, federalTax } from "../src/sim/tax/federal.ts";
import { fileReturn } from "../src/sim/tax/filing.ts";
import { answerKind, bottomLine, tutorialOptions } from "../src/sim/tax/tutorial.ts";

interface Ctx {
  debt: boolean;
  picked: string | null;
}
const DEMO: TourDef<Ctx> = {
  id: "stocks",
  steps: [
    { id: "a", line: "One.", anim: "wave", mood: "plain" },
    { id: "debt", line: "Debt.", anim: "think", mood: "dry", when: (c) => c.debt },
    {
      id: "act",
      line: "Your turn.",
      anim: "wave",
      mood: "warm",
      advance: { kind: "action", on: { kind: "click", sel: "[data-pick]" }, timeoutMs: 1000 },
      capture: (c, got) => {
        if (got.kind === "click") c.picked = got.data.pick ?? null;
      },
    },
    { id: "after", line: (c) => `You picked ${c.picked}.`, anim: "cheer", mood: "warm", when: (c) => c.picked !== null },
    { id: "end", line: "Done.", anim: "cheer", mood: "warm" },
  ],
};

test("a tour walks its steps in order, skipping the ones that don't apply", () => {
  const run = new TourRun(DEMO, { debt: false, picked: null });
  assert.equal(run.step?.id, "a");
  assert.equal(run.counter, "1 / 3");
  assert.equal(run.canBack, false);
  assert.ok(run.next());
  // No debt, so the debt step is skipped.
  assert.equal(run.step?.id, "act");
  assert.equal(run.counter, "2 / 3");
  assert.ok(run.canBack);
  assert.ok(run.back());
  assert.equal(run.step?.id, "a");
});

test("branches follow the player's state, including what they did on an action step", () => {
  const run = new TourRun(DEMO, { debt: true, picked: null });
  run.next();
  assert.equal(run.step?.id, "debt");
  run.next();
  assert.equal(run.advance.kind, "action");
  assert.ok(run.act({ kind: "click", data: { pick: "LTM" } }));
  assert.equal(run.step?.id, "after");
  assert.equal(run.line(), "You picked LTM.");
  // Going back to the action step, it's already done, so it shows Next.
  run.back();
  assert.equal(run.step?.id, "act");
  assert.equal(run.advance.kind, "next");
  run.next();
  run.next();
  assert.equal(run.step?.id, "end");
  assert.equal(run.canNext, false);
  assert.equal(run.next(), false);
  assert.ok(run.finished);
});

test("the record keeps finished and skipped tours, and never offers them again", () => {
  let rec = parseTourRecord(undefined);
  assert.deepEqual(rec, {});
  assert.ok(shouldOffer(rec, "stocks"));
  rec = recordTour(rec, "stocks", "skipped");
  rec = recordTour(rec, "taxes", "done");
  assert.equal(shouldOffer(rec, "stocks"), false);
  assert.equal(shouldOffer(rec, "taxes"), false);
  assert.ok(shouldOffer(rec, "taxes-refresher"));
  // A saved record round-trips through JSON; anything unknown is dropped.
  assert.deepEqual(parseTourRecord(JSON.parse(JSON.stringify({ ...rec, bogus: "done", "taxes-refresher": "maybe" }))), rec);
});

test("Sammy stands beside the target on the side with room, inside the screen, never over it", () => {
  const view = { w: 1440, h: 900 };
  const box = { w: 500, h: 180 };
  const overlaps = (p: { x: number; y: number }, t: { x: number; y: number; w: number; h: number }) =>
    p.x < t.x + t.w && p.x + box.w > t.x && p.y < t.y + t.h && p.y + box.h > t.y;
  for (const t of [
    { x: 40, y: 300, w: 300, h: 200 },
    { x: 1100, y: 300, w: 300, h: 200 },
    { x: 400, y: 40, w: 600, h: 120 },
    { x: 400, y: 720, w: 600, h: 150 },
  ]) {
    const p = placeBox(t, box, view);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + box.w <= view.w && p.y + box.h <= view.h, `inside the screen for ${JSON.stringify(t)}`);
    assert.ok(!overlaps(p, t), `clear of ${JSON.stringify(t)} (${p.side})`);
  }
  assert.equal(placeBox({ x: 40, y: 300, w: 300, h: 200 }, box, view).side, "right");
  assert.equal(placeBox({ x: 1100, y: 300, w: 300, h: 200 }, box, view).side, "left");
  // On a phone, beside is too narrow: below or above.
  const phone = placeBox({ x: 20, y: 120, w: 350, h: 160 }, { w: 370, h: 200 }, { w: 390, h: 844 });
  assert.equal(phone.side, "below");
  assert.equal(placeBox(null, box, view).side, "center");
});

test("every fixed tour line is pre-voiced; lines with numbers are voiced on the fly", () => {
  const voiced = new Set(allLines());
  for (const def of [STOCKS_TOUR, TAXES_TOUR, TAXES_REFRESHER]) {
    const fixed = tourLines(def as TourDef<unknown>);
    assert.ok(fixed.length > 2, def.id);
    for (const line of fixed) assert.ok(voiced.has(line), `${def.id}: not in allLines(): ${line}`);
  }
  assert.ok(voiced.has(STOCKS_TOUR.offer!));
});

test("tour lines fit the bubble, use only the voice's tags, and have no em dash, with real numbers filled in", () => {
  const stocks: StocksCtx = {
    buyingPower: 1234.5,
    holdings: [{ id: "LTM", value: 5210.4, gain: 310.2 }],
    fund: { id: "LTM", expenseRatio: 0.0003 },
    stock: { id: "NNST", name: "NeuralNest", beta: 1.8 },
    concentration: { name: "NeuralNest", share: 0.62 },
    topDebt: { name: "Credit card", apr: 0.2396 },
    bought: { units: 0.0812, amount: 25 },
  };
  const ret = fileReturn({ year: 2026, state: "CA", wagesYtd: 52_000, federalWithheldYtd: 4_300, stateWithheldYtd: 1_200 });
  const taxes: TaxesCtx = { ret, stateName: "California", noIncomeTax: false, paycheck: true, answer: bottomLine(ret) };
  const check = (def: TourDef<never>, ctx: unknown) => {
    for (const s of def.steps) {
      const line = typeof s.line === "string" ? s.line : (s.line as (c: unknown) => string)(ctx);
      assert.ok(stripTags(line).length <= 200, `${def.id}/${s.id} too long: ${line}`);
      assert.ok(!line.includes("—"), `${def.id}/${s.id}: em dash`);
      assert.ok(!/NaN|undefined|Infinity/.test(line), `${def.id}/${s.id}: ${line}`);
      for (const [, tag] of line.matchAll(/\[([^\]]*)\]/g)) assert.ok(["sighs", "slow", "whispers", "laughs"].includes(tag), `${s.id}: [${tag}]`);
    }
  };
  check(STOCKS_TOUR as TourDef<never>, stocks);
  check(TAXES_TOUR as TourDef<never>, taxes);
  check(TAXES_REFRESHER as TourDef<never>, taxes);
  // The fee line uses the fund's real expense ratio: 0.03% is 30 cents per $1,000.
  const fee = STOCKS_TOUR.steps.find((s) => s.id === "fee")!.line as (c: StocksCtx) => string;
  assert.match(fee(stocks), /0\.03% a year, about \$0\.30 for every \$1,000/);
  const beta = STOCKS_TOUR.steps.find((s) => s.id === "beta")!.line as (c: StocksCtx) => string;
  assert.match(beta(stocks), /1\.8 times .* about 18%/);
});

test("the stocks tour branches on buying power, debt, and concentration", () => {
  const base: StocksCtx = {
    buyingPower: 0,
    holdings: [],
    fund: { id: "LTM", expenseRatio: 0.0003 },
    stock: { id: "NNST", name: "NeuralNest", beta: 1.8 },
    concentration: null,
    topDebt: null,
    bought: null,
  };
  const ids = (c: StocksCtx) => {
    const run = new TourRun(STOCKS_TOUR, c);
    const seen = [run.step!.id];
    while (run.next()) seen.push(run.step!.id);
    return seen;
  };
  const broke = ids(base);
  assert.ok(broke.includes("buy-none") && !broke.includes("buy") && broke.includes("no-debt") && broke.includes("diversify"));
  assert.ok(!broke.includes("holdings"));
  const rich = ids({ ...base, buyingPower: 900, holdings: [{ id: "LTM", value: 100, gain: 1 }], topDebt: { name: "Card", apr: 0.24 }, concentration: { name: "NeuralNest", share: 0.7 } });
  assert.ok(rich.includes("buy") && rich.includes("debt-or-invest") && rich.includes("concentration") && rich.includes("holdings"));
  assert.equal(rich[rich.length - 1], "wrap");
});

test("Sammy's quiz reaction names the exact mistake, with the right math from the player's return", () => {
  const ret = fileReturn({ year: 2026, state: "CA", wagesYtd: 52_000, federalWithheldYtd: 4_300, stateWithheldYtd: 1_200 });
  const opts = tutorialOptions(ret);
  const kinds = opts.map((o) => answerKind(ret, o.amount)).sort();
  assert.deepEqual(kinds, ["forgot-tax", "forgot-withholding", "right"]);
  for (const o of opts) {
    const line = answerLine(ret, o.amount);
    if (answerKind(ret, o.amount) === "right") assert.match(line, /^Correct!/);
    else {
      assert.match(line, /We'll try again next year\.$/);
      // The correct bottom line, in words.
      const n = Math.round(Math.abs(bottomLine(ret))).toLocaleString("en-US");
      assert.ok(line.includes(`$${n}`), line);
    }
  }
});

test("the bracket bar's slices add up to the federal tax, and only the top slice pays the top rate", () => {
  const b = bracketSlices(60_000);
  assert.deepEqual(
    b.slices.map((s) => s.rate),
    [0.1, 0.12, 0.22],
  );
  assert.equal(b.slices.reduce((s, x) => s + x.amount, 0), 60_000);
  assert.ok(Math.abs(b.slices.reduce((s, x) => s + x.tax, 0) - federalTax(60_000)) < 0.02);
  assert.equal(b.marginal, 0.22);
  assert.ok(b.effective > 0.1 && b.effective < 0.22);
  assert.deepEqual(bracketSlices(0).slices, []);
});

test("a ready tax return raises Sammy's reminder, unless it filed itself that day", () => {
  const ready = { type: "tax_ready", day: 216, year: 2026 } as const;
  const auto = { type: "tax_filed", day: 216, year: 2026, refundOrOwed: 300, auto: true } as const;
  assert.equal(cueForEvents([ready]), "tax_ready");
  assert.equal(cueForEvents([ready, auto]), null);
  // A missed payment still outranks it.
  assert.equal(cueForEvents([ready, { type: "missed", day: 216, debtId: "c", due: 50, fee: 29 }]), "missed");
});

test('Sammy is the name everywhere the player reads it: no "Narrator" in lines or UI strings', () => {
  assert.equal(NARRATOR_NAME, "Sammy");
  for (const line of allLines()) assert.ok(!/narrator/i.test(line), `a line still says Narrator: ${line}`);
  const root = new URL("../", import.meta.url);
  const files = [
    "src/narration/lines.ts",
    "src/narration/tours.ts",
    "src/debt-demo/main.ts",
    "index.html",
    "debt.html",
    ...readdirSync(fileURLToPath(new URL("src/ui/", root)))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `src/ui/${f}`),
  ];
  // Displayed text: inside quotes, template literals, or between tags. Code names (the Narrator class, its file) aren't.
  const shown = /["'`>][^"'`<]*\bNarrator\b[^"'`<]*["'`<]/;
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(f, root)), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l) && !/\bimport\b|new Narrator\(|class Narrator|: Narrator\b|type Narrator/.test(l));
    for (const l of src) assert.ok(!shown.test(l), `${f}: ${l.trim()}`);
  }
});
