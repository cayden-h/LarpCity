// Card Shop: a page of the Credit Desk where the player compares real credit
// cards and applies for them. Card details come from each issuer's page, the
// terms (APR by credit tier, every fee) from the CFPB's card survey, and the
// art is each issuer's official card image (src/data/cards-curated.ts).
//
// Applying runs the money engine (src/sim/money/applications.ts): a soft-pull
// prequalification shows the odds, and a hard-pull application rolls a seeded
// number, so the same run makes the same decision. An approved card opens as a
// real credit_card debt in the player's book, so the rest of the desk (the
// liabilities table, the payoff chart, the credit report) picks it up.

import "./shop.css";
import { SPEND_LABEL, SPEND_ORDER, cardOffer, cardValue } from "./shop-value.ts";
import { CURATED, CURATED_AS_OF, TCCP_AS_OF } from "../data/cards-curated.ts";
import { CARD_PRODUCTS } from "../data/cards.ts";
import type { Clock } from "../engine/clock.ts";
import { effectiveApr, owed } from "../sim/debt/index.ts";
import type { PlayerLife } from "../sim/life/index.ts";
import {
  BLS_MONTHLY_SPEND,
  aprFor,
  applyForCard,
  bonusEligible,
  issuerRule,
  openCard,
  recordApplication,
  tierOf,
  type Applicant,
  type ApplicationResult,
  type CardProduct,
  type CuratedCard,
  type EarnCategory,
  type SpendCategory,
} from "../sim/money/index.ts";

type Tone = "up" | "down" | "flat" | "info";
type CreditFilter = "all" | CuratedCard["creditNeeded"];
type Sort = "match" | "value" | "apr" | "fee" | "bonus";
type View = "featured" | "plans";

export interface ShopHost {
  root: HTMLElement;
  life: () => PlayerLife;
  clock: Clock;
  log: (day: number, tag: string, text: string, tone: Tone) => void;
  /** Called after the shop changes the player's book or accounts. */
  onChange: () => void;
}

export interface Shop {
  /** Cheap update for the numbers that move with time (score, odds, APRs). */
  refresh(): void;
  /** Full rebuild, when the shop becomes visible. */
  render(): void;
  /** Opens a card's details (from search); the next render shows them. */
  select(slug: string): void;
}

/** Category colors, shared by the spending bar and each row's dot (Apple Card's color-coded categories). */
const SPEND_COLORS = ["#30b566", "#ff8a00", "#e5484d", "#3e7bfa", "#a855f7", "#8e8e93", "#14b8a6", "#f59e0b"];
const CARRY_PRESETS = [0, 1_000, 3_000, 5_000];
const DEPOSIT_PRESETS = [200, 300, 500, 1_000];
const typedDollars = (s: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(s.replace(/[^0-9.]/g, "")) || 0)));

// ---- Formatting ----------------------------------------------------------------

/** Whole dollars for estimates (year-one value, fees); balances use `cents`, like the rest of the desk. */
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const cents = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (f: number | null | undefined, d = 2) => (f == null ? "—" : `${(f * 100).toFixed(d)}%`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CREDIT_LABEL: Record<CuratedCard["creditNeeded"], string> = { none: "Building credit", fair: "Fair", good: "Good", excellent: "Excellent" };
const TIER_LABEL = ["No score", "619 or less", "620-719", "720+"];

// ---- Deterministic application rolls --------------------------------------------

/** FNV-1a then a mulberry32 step: a stable [0, 1) per (day, card, attempt). */
function roll(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let t = (h += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- Card art --------------------------------------------------------------------

const FALLBACK: Record<string, [string, string]> = {
  CHASE: ["#0b2a5b", "#1c4f9c"],
  AMERICAN_EXPRESS: ["#0e5a8a", "#2a86c1"],
  CAPITAL_ONE: ["#0a2238", "#16426b"],
  CITI: ["#0f3b67", "#2b73b6"],
  WELLS_FARGO: ["#6d0b0b", "#b31b1b"],
  BANK_OF_AMERICA: ["#0b1e45", "#c8102e"],
  DISCOVER: ["#e56b16", "#f39a3d"],
};

export function cardArt(card: CuratedCard, size: "tile" | "hero" | "mini"): string {
  const inner = card.art
    ? `<img src="${card.art.src}" alt="${esc(card.name)} card" width="${card.art.width}" height="${card.art.height}" decoding="async" draggable="false" />`
    : fallbackFace(card.name, card.issuer, card.network, card.terms.issuerKey);
  return `<div class="cc cc-${size}" data-tilt><div class="cc-body">${inner}<span class="cc-sheen"></span></div></div>`;
}

/** A drawn card face for cards without official art (the player's starting card, survey plans). */
export function fallbackFace(name: string, issuer: string, network: string, issuerKey: string | null): string {
  const [a, b] = FALLBACK[issuerKey ?? ""] ?? ["#1b2533", "#34465c"];
  return `<div class="cc-drawn" style="--a:${a};--b:${b}">
    <span class="cc-issuer">${esc(issuer)}</span>
    <svg class="cc-chip" viewBox="0 0 40 30" aria-hidden="true"><rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="#d9b86a" stroke="#a88a44"/><path d="M0 10h13M0 20h13M27 10h13M27 20h13M13 0v30M27 0v30" stroke="#a88a44" stroke-width="1.2" fill="none"/></svg>
    <span class="cc-name">${esc(name)}</span>
    <span class="cc-net">${esc(network)}</span>
  </div>`;
}

// ---- The shop --------------------------------------------------------------------

export function mountShop(host: ShopHost): Shop {
  const { root, clock } = host;
  const state = {
    credit: "all" as CreditFilter,
    sort: "match" as Sort,
    noFee: false,
    view: "featured" as View,
    spend: { ...BLS_MONTHLY_SPEND, travel: 125 } as Record<SpendCategory, number>,
    carry: 0,
    selected: null as string | null,
    result: null as { card: CuratedCard; r: ApplicationResult; prequal: boolean } | null,
    planQuery: "",
    deposit: 300,
  };

  const life = () => host.life();
  // The application history lives on the life, so a save or a rewind carries it.
  const history = () => life().applications;
  const score = () => life().book.profile.score;
  const bySlug = (slug: string) => CURATED.find((c) => c.slug === slug)!;

  function applicant(): Applicant {
    const l = life();
    // Take-home is about 78% of gross for a single filer at this income.
    return { age: l.age, annualIncome: (l.employed ? l.monthlyTakeHome : l.monthlyTakeHome * 0.4) * 12 / 0.78, monthlyDebtPayments: l.minimums(), monthlyHousing: l.rent };
  }

  const yourApr = (terms: CardProduct) => aprFor(terms, score());
  const prequal = (card: CuratedCard) =>
    applyForCard({ product: card.terms, offer: cardOffer(card), applicant: applicant(), book: life().book, history: history(), day: clock.day, deposit: state.deposit });
  const value = (card: CuratedCard) => cardValue(card, state.spend, { firstYear: true, carry: state.carry, apr: yourApr(card.terms) });
  const owns = (card: CuratedCard) => life().book.debts.some((d) => d.id.startsWith(`card-${card.slug}-`) && d.status !== "paid" && d.status !== "discharged");

  function oddsLabel(o: number): [string, Tone] {
    if (o >= 0.8) return ["Excellent odds", "up"];
    if (o >= 0.55) return ["Good odds", "up"];
    if (o >= 0.3) return ["Fair odds", "info"];
    return ["Low odds", "down"];
  }

  function visible(): CuratedCard[] {
    const list = CURATED.filter((c) => (state.credit === "all" || c.creditNeeded === state.credit) && (!state.noFee || c.annualFee === 0));
    const key: Record<Sort, (c: CuratedCard) => number> = {
      // Year-one value weighted by the chance you'd actually get the card.
      match: (c) => -value(c).net * (c.closed ? 0 : prequal(c).odds),
      value: (c) => -value(c).net,
      apr: (c) => yourApr(c.terms),
      fee: (c) => c.annualFee,
      bonus: (c) => -(c.welcomeOffer?.valueUsd ?? 0),
    };
    const k = new Map(list.map((c) => [c, key[state.sort](c)]));
    return list.sort((a, b) => k.get(a)! - k.get(b)!);
  }

  // ---- Pieces ----

  function profileHtml(): string {
    const l = life();
    const h = history();
    const day = clock.day;
    const opened24 = h.filter((r) => r.approved && r.personalCard && day - r.day < 730).length;
    const inquiries = l.book.profile.inquiries.filter((d) => day - d < 365).length;
    const tier = tierOf(score());
    const cards = l.book.debts.filter((d) => d.kind === "credit_card" && d.status !== "paid" && d.status !== "discharged");
    const limit = cards.reduce((s, d) => s + (d.creditLimit ?? 0), 0);
    const bal = cards.reduce((s, d) => s + d.balance + d.accrued, 0);
    const util = limit > 0 ? bal / limit : 0;
    const k = (label: string, v: string, sub: string, tone: Tone = "flat") => `<div class="sp-k"><div class="k-label">${label}</div><div class="sp-v">${v}</div><div class="k-sub ${tone}">${sub}</div></div>`;
    return [
      k("Credit score", String(score()), `CFPB tier: ${TIER_LABEL[tier]}`),
      k("Debt-to-income", pct(l.dti(), 0), l.dti() > 0.5 ? "Over 50%: declines" : "Minimums ÷ pay", l.dti() > 0.5 ? "down" : "flat"),
      k("Card utilization", pct(util, 0), util > 0.3 ? "Over 30% hurts" : "Under 30%", util > 0.3 ? "down" : "up"),
      k("Hard inquiries", String(inquiries), "Last 12 months", inquiries > 2 ? "down" : "flat"),
      k("New cards", `${opened24}/24`, "Chase 5/24 rule", opened24 >= 5 ? "down" : "flat"),
    ].join("");
  }

  function tileHtml(card: CuratedCard): string {
    const v = value(card);
    const p = prequal(card);
    const [ol, ot] = oddsLabel(p.odds);
    const blocked = p.decision === "denied" && p.odds === 0;
    return `<article class="tile ${state.selected === card.slug ? "sel" : ""}" data-card="${card.slug}">
      ${cardArt(card, "tile")}
      <div class="t-head">
        <div><div class="t-name">${esc(card.name)}</div><div class="t-sub">${esc(card.issuer)} · ${esc(card.network)}</div></div>
        ${owns(card) ? `<span class="chip up">In wallet</span>` : `<span class="chip">${CREDIT_LABEL[card.creditNeeded]}</span>`}
      </div>
      <div class="t-stats">
        <div><span>Annual fee</span><b>${card.annualFee ? usd(card.annualFee) : "$0"}</b></div>
        <div><span>Your APR</span><b data-apr="${card.slug}">${pct(yourApr(card.terms))}</b></div>
        <div><span>Year 1 value</span><b class="${v.net >= 0 ? "up" : "down"}" data-val="${card.slug}">${usd(v.net)}</b></div>
      </div>
      <div class="t-offer">${card.welcomeOffer ? esc(card.welcomeOffer.text) : card.secured ? "Refundable deposit sets your limit" : "No welcome offer right now"}</div>
      <div class="t-odds" data-odds="${card.slug}">${card.closed ? closedMeter() : oddsMeter(p.odds, blocked ? ["Not eligible", "down"] : [ol, ot])}</div>
      <button class="btn block" data-shop-open="${card.slug}">View card</button>
    </article>`;
  }

  function closedMeter(): string {
    return `<div class="om-top"><span class="flat">Closed to new applicants</span><span class="dim">—</span></div><div class="om-bar"></div>`;
  }

  function oddsMeter(odds: number, [label, tone]: [string, Tone]): string {
    return `<div class="om-top"><span class="${tone}">${label}</span><span class="dim">${Math.round(odds * 100)}%</span></div><div class="om-bar"><span class="${tone}" style="width:${Math.max(3, odds * 100)}%"></span></div>`;
  }

  /** Copilot-style budget: one bar split by category, then rows whose amounts you click to edit. */
  function spendHtml(): string {
    const total = SPEND_ORDER.reduce((s, c) => s + state.spend[c], 0);
    const color = (i: number) => SPEND_COLORS[i % SPEND_COLORS.length];
    return `<div class="panel-head"><h2>Your card spending</h2><span class="muted" data-spend-total>${usd(total)}/mo</span></div>
      <div class="sp-bar" aria-hidden="true">${SPEND_ORDER.map((c, i) => `<span data-seg="${c}" style="--c:${color(i)};width:${total ? (state.spend[c] / total) * 100 : 0}%"></span>`).join("")}</div>
      ${SPEND_ORDER.map((c, i) => `<label class="sp-row"><i style="--c:${color(i)}"></i><span>${SPEND_LABEL[c]}</span><span class="amt-edit"><input inputmode="numeric" value="${usd(state.spend[c])}" data-spend="${c}" aria-label="${SPEND_LABEL[c]} a month"></span></label>`).join("")}
      <p class="note">Click an amount to change it. Defaults are the average US household (BLS Consumer Expenditure Survey 2024), plus $125 a month of travel.</p>
      <div class="field">
        <div class="field-head"><b>Balance you carry</b><label class="amt-edit"><input inputmode="numeric" value="${usd(state.carry)}" data-carry aria-label="Balance you carry"></label></div>
        <div class="chips" role="group" aria-label="Balance presets">${CARRY_PRESETS.map((v) => `<button data-carry-set="${v}" class="${state.carry === v ? "on" : ""}" aria-label="${v ? usd(v) : "None"}">${v ? `$${v / 1_000}K` : "None"}</button>`).join("")}</div>
      </div>
      <p class="note">Carrying a balance costs your APR every year. At about 23%, $3,000 costs $690, more than a 2% card earns on average spending.</p>`;
  }

  function walletHtml(): string {
    const cards = life().book.debts.filter((d) => d.kind === "credit_card");
    if (!cards.length) return `<p class="muted">No cards yet.</p>`;
    return cards
      .map((d) => {
        const c = CURATED.find((x) => d.id.startsWith(`card-${x.slug}-`));
        const art = c ? cardArt(c, "mini") : `<div class="cc cc-mini"><div class="cc-body">${fallbackFace(d.name, "Brickstone Bank", "VISA", null)}</div></div>`;
        const closed = d.status === "paid" || d.status === "discharged";
        return `<div class="w-row ${closed ? "closed" : ""}">${art}<div><div class="pos-name">${esc(d.name)}</div><div class="pos-sub">${cents(owed(d))} of ${cents(d.creditLimit ?? 0)} · ${pct(effectiveApr(d, clock.day))}${d.promoUntil !== undefined && clock.day < d.promoUntil ? ` · ${pct(d.promoApr ?? 0, 0)} intro` : ""}</div></div></div>`;
      })
      .join("");
  }

  function termsRows(t: CardProduct): string {
    const row = (k: string, v: string) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
    const fee = (p: number | null, min: number | null) => (p == null ? "None" : `${pct(p, 0)}${min ? ` (min ${usd(min)})` : ""}`);
    return [
      row("Purchase APR, 720+", pct(t.aprGreat)),
      row("Purchase APR, 620-719", pct(t.aprGood)),
      row("Purchase APR, 619 or less", pct(t.aprPoor)),
      row("Purchase APR, no score", pct(t.aprNoScore)),
      row("Intro APR", t.introApr != null && t.introMonths ? `${pct(t.introApr, 0)} for ${t.introMonths} months` : "None"),
      row("Balance transfer fee", fee(t.btFeePct, t.btFeeMin)),
      row("Cash advance", `${fee(t.cashFeePct, t.cashFeeMin)}${t.cashApr ? ` · ${pct(t.cashApr)} APR` : ""}`),
      row("Foreign transaction fee", t.foreignFeePct ? pct(t.foreignFeePct, 0) : "None"),
      row("Late fee", t.lateFee ? `Up to ${usd(t.lateFee)}` : "None"),
      row("Grace period", t.graceDays ? `${t.graceDays} days` : "None"),
    ].join("");
  }

  function drawerHtml(): string {
    if (!state.selected) return "";
    const card = bySlug(state.selected);
    const v = value(card);
    const apr = yourApr(card.terms);
    const p = prequal(card);
    const [ol, ot] = oddsLabel(p.odds);
    const rule = card.secured ? null : issuerRule(card.terms.issuerKey, history(), clock.day);
    const offer = cardOffer(card);
    const bonusOk = offer ? bonusEligible(offer, history(), clock.day) : true;
    const checking = life().ledger.get("checking").balance;
    return `<div class="drawer-back" data-shop-close></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(card.name)}">
      <button class="x" data-shop-close aria-label="Close">×</button>
      <div class="d-hero">${cardArt(card, "hero")}</div>
      <div class="d-title"><h3>${esc(card.name)}</h3><div class="t-sub">${esc(card.issuer)} · ${esc(card.network)} · ${card.creditNeeded === "none" ? "No credit needed" : `${CREDIT_LABEL[card.creditNeeded]} credit`}${card.student ? " · Student" : ""}</div></div>
      <div class="d-kpis">
        <div><span>Annual fee</span><b>${card.annualFee ? usd(card.annualFee) : "$0"}${card.firstYearFeeWaived && card.annualFee ? `<em>waived year one</em>` : ""}</b></div>
        <div><span>Your APR</span><b>${pct(apr)}</b><em>${esc(card.regularApr)}</em></div>
        <div><span>Odds (soft pull)</span><b class="${ot}">${Math.round(p.odds * 100)}%</b><em>${ol}</em></div>
      </div>
      ${card.welcomeOffer ? `<div class="d-offer"><b>Welcome offer</b><span>${esc(card.welcomeOffer.text)}</span>${owns(card) ? `<span>This card is open: meet the spend within ${card.welcomeOffer.months} months of opening to earn it.</span>` : bonusOk ? "" : `<span class="down">You already received this bonus; the issuer won't pay it again.</span>`}</div>` : ""}
      <h4>Earn rates</h4>
      <ul class="earn">${card.earn.map((e) => `<li><b>${e.unit === "percent" ? `${e.rate}%` : `${e.rate}x`}</b><span>${esc(labelFor(e.category))}${e.cap ? ` <em>${esc(e.cap)}</em>` : ""}${e.note ? ` <em>${esc(e.note)}</em>` : ""}</span></li>`).join("")}</ul>
      ${card.rewardsCurrency !== "cash" ? `<p class="note">Points valued at ${card.centsPerPoint}¢ each (${esc(card.rewardsCurrency)}, cash-out value).</p>` : ""}
      <h4>Year one on your spending</h4>
      <table class="val"><tbody>
        ${v.lines.map((l) => `<tr><td>${l.label} <span class="dim">${usd(l.spend)} × ${l.rate}</span></td><td class="num up">+${usd(l.earned)}</td></tr>`).join("")}
        ${v.bonus ? `<tr><td>Welcome offer</td><td class="num up">+${usd(v.bonus)}</td></tr>` : ""}
        ${v.fee ? `<tr><td>Annual fee</td><td class="num down">−${usd(v.fee)}</td></tr>` : ""}
        ${v.interest ? `<tr><td>Interest on ${usd(state.carry)} at ${pct(apr)}</td><td class="num down">−${usd(v.interest)}</td></tr>` : ""}
        <tr class="tot"><td>Net</td><td class="num ${v.net >= 0 ? "up" : "down"}">${usd(v.net)}</td></tr>
      </tbody></table>
      <h4>Perks</h4>
      <ul class="perks">${card.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h4>Terms <span class="dim">CFPB survey, ${TCCP_AS_OF}</span></h4>
      <table class="terms"><tbody>${termsRows(card.terms)}</tbody></table>
      ${card.secured ? `<div class="field">
        <div class="field-head"><b>Security deposit</b><label class="amt-edit"><input inputmode="numeric" value="${usd(state.deposit)}" data-deposit aria-label="Security deposit, $200 to $2,000"></label></div>
        <div class="chips" role="group" aria-label="Deposit presets">${DEPOSIT_PRESETS.map((v) => `<button data-deposit-set="${v}" class="${state.deposit === v ? "on" : ""}">${usd(v)}</button>`).join("")}</div>
        <p class="note">Your deposit becomes your credit limit ($200 to $2,000), and you get it back when you close the card or move up to an unsecured one.</p>
      </div>` : ""}
      ${card.closed ? `<p class="d-warn">${esc(card.issuer)} has ${esc(card.closed)}. Existing cardholders keep it, but you can't apply.</p>` : ""}
      ${rule ? `<p class="d-warn">${esc(rule)}</p>` : ""}
      ${owns(card) ? `<p class="d-ok">This card is in your wallet.</p>` : ""}
      <div class="d-actions">
        <button class="btn" data-shop-prequal="${card.slug}" ${card.closed ? "disabled" : ""}>Check odds (soft pull)</button>
        <button class="btn primary" data-shop-apply="${card.slug}" ${card.closed || owns(card) || (card.secured && checking < state.deposit) ? "disabled" : ""}>${card.closed ? "Closed to new applicants" : card.secured ? `Apply with ${usd(state.deposit)} deposit` : "Apply (hard pull)"}</button>
      </div>
      <p class="src">Issuer details checked ${esc(card.checked)} from <a href="${esc(card.sourceUrl)}" target="_blank" rel="noopener">${esc(new URL(card.sourceUrl).hostname)}</a>${card.unverified ? ` (not confirmed on the issuer page: ${esc((card.unverifiedFields ?? []).join(", ") || "some details")})` : ""}.${card.art ? ` Card art © ${esc(card.issuer)}.` : ""}</p>
    </aside>`;
  }

  function resultHtml(): string {
    const res = state.result;
    if (!res) return "";
    const { card, r, prequal: soft } = res;
    const tone = r.decision === "approved" ? "up" : r.decision === "pending" ? "warn" : "down";
    const title = soft
      ? `${Math.round(r.odds * 100)}% odds of approval`
      : r.decision === "approved"
        ? `Approved: ${card.name}`
        : r.decision === "pending"
          ? "Pending review"
          : "Not approved";
    const lines = soft
      ? [`This was a soft pull, so your score didn't change.`, ...r.reasons]
      : r.decision === "approved"
        ? [
            `Credit limit ${usd(r.creditLimit ?? 0)} at ${pct(r.apr)} APR.`,
            card.welcomeOffer && r.bonusEligible !== false ? `Spend ${usd(card.welcomeOffer.spend)} in ${card.welcomeOffer.months} months to earn the welcome offer.` : "",
            "The hard inquiry and the new account show up at your next monthly score update.",
            ...r.reasons,
          ]
        : [...r.reasons, "The hard inquiry still counts against your score for 12 months."];
    return `<div class="modal-back"><div class="modal shop-result" role="dialog" aria-modal="true">
      <div class="modal-tag ${tone}">${soft ? "Prequalification" : "Application"}</div>
      <div class="r-row">${cardArt(card, "mini")}<h3>${esc(title)}</h3></div>
      <ul class="r-lines">${lines.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="options"><button class="btn primary" data-shop-dismiss>${r.decision === "approved" && !soft ? "Add to wallet" : "Close"}</button></div>
    </div></div>`;
  }

  function plansHtml(): string {
    const s = score();
    const q = state.planQuery.trim().toLowerCase();
    const rows = CARD_PRODUCTS.filter((p) => !q || `${p.institution} ${p.productName}`.toLowerCase().includes(q))
      .map((p) => ({ p, apr: aprFor(p, s) }))
      .sort((a, b) => a.apr - b.apr);
    return `<div class="panel plans">
      <div class="panel-head"><h2>Every national plan in the CFPB survey</h2>
        <input class="search" type="search" placeholder="Search ${CARD_PRODUCTS.length} plans" value="${esc(state.planQuery)}" data-plan-q /></div>
      <p class="note">Sorted by the APR your ${s} score would get. Credit unions often beat the big banks by 10 points.</p>
      <div class="table-wrap"><table><thead><tr><th>Plan</th><th>Issuer</th><th class="num">Your APR</th><th class="num">Annual fee</th><th class="num">Intro</th><th class="num">BT fee</th><th>Rewards</th></tr></thead>
      <tbody>${rows
        .slice(0, 150)
        .map(({ p, apr }) => `<tr><td class="pos-name">${esc(p.productName)}${p.secured ? ` <span class="chip info">Secured</span>` : ""}</td><td class="muted">${esc(p.institution)}</td><td class="num">${pct(apr)}</td><td class="num">${p.annualFee ? usd(p.annualFee) : "$0"}</td><td class="num">${p.introMonths ? `${p.introMonths} mo` : "—"}</td><td class="num">${p.btFeePct != null ? pct(p.btFeePct, 0) : "—"}</td><td class="muted">${esc(p.rewards.join(", ") || "None")}</td></tr>`)
        .join("")}</tbody></table></div>
      ${rows.length > 150 ? `<p class="note">Showing the 150 lowest APRs of ${rows.length}.</p>` : ""}
    </div>`;
  }

  // ---- Render ----

  function render(): void {
    const list = visible();
    root.innerHTML = `
      <div class="section shop-title"><h2>Card Shop</h2><span>Real cards, real terms. Check your odds with a soft pull before a hard pull costs you points.</span></div>
      <div class="shop-profile" data-s-profile>${profileHtml()}</div>
      <div class="shop-bar">
        <div class="tabs" role="tablist">
          <button data-shop-view="featured" class="${state.view === "featured" ? "on" : ""}">Featured cards</button>
          <button data-shop-view="plans" class="${state.view === "plans" ? "on" : ""}">All ${CARD_PRODUCTS.length} plans</button>
        </div>
        ${
          state.view === "featured"
            ? `<div class="seg" role="group" aria-label="Credit needed"><span class="seg-lbl" aria-hidden="true">Credit</span>${(["all", "none", "fair", "good", "excellent"] as CreditFilter[]).map((c) => `<button data-shop-credit="${c}" class="${state.credit === c ? "on" : ""}">${c === "all" ? "All" : CREDIT_LABEL[c]}</button>`).join("")}
            <button data-shop-nofee class="${state.noFee ? "on" : ""}" aria-pressed="${state.noFee}">${state.noFee ? "✓ " : ""}No annual fee</button></div>
          <div class="seg" role="group" aria-label="Sort"><span class="seg-lbl" aria-hidden="true">Sort</span>${(
            [
              ["match", "Best match"],
              ["value", "Best value"],
              ["apr", "Lowest APR"],
              ["bonus", "Biggest offer"],
              ["fee", "Lowest fee"],
            ] as [Sort, string][]
          )
            .map(([k, l]) => `<button data-shop-sort="${k}" class="${state.sort === k ? "on" : ""}">${l}</button>`)
            .join("")}</div>`
            : ""
        }
      </div>
      ${
        state.view === "plans"
          ? plansHtml()
          : `<div class="shop-grid">
        <aside class="shop-side">
          <section class="panel">${spendHtml()}</section>
          <section class="panel"><div class="panel-head"><h2>Your wallet</h2></div><div data-s-wallet>${walletHtml()}</div></section>
        </aside>
        <div class="tiles">${list.map(tileHtml).join("") || `<div class="chart-empty">No cards match these filters.</div>`}</div>
      </div>`
      }
      <p class="foot">Card details from each issuer's site, checked ${CURATED_AS_OF}. Terms from the CFPB Terms of Credit Card Plans survey (${TCCP_AS_OF}). Card art and names belong to their issuers and appear for education only. Approval odds are Larp City's model, not a prediction for any real application.</p>
      <div data-s-drawer>${drawerHtml()}</div>
      <div data-s-result>${resultHtml()}</div>`;
  }

  /** Updates the numbers that move with the spending sliders, without rebuilding the tiles. */
  function updateNumbers(): void {
    for (const card of CURATED) {
      const v = value(card);
      const el = root.querySelector(`[data-val="${card.slug}"]`);
      if (el) {
        el.textContent = usd(v.net);
        el.className = v.net >= 0 ? "up" : "down";
      }
      const a = root.querySelector(`[data-apr="${card.slug}"]`);
      if (a) a.textContent = pct(yourApr(card.terms));
      const o = root.querySelector(`[data-odds="${card.slug}"]`);
      if (o && !card.closed) {
        const p = prequal(card);
        o.innerHTML = oddsMeter(p.odds, p.decision === "denied" && p.odds === 0 ? ["Not eligible", "down"] : oddsLabel(p.odds));
      }
    }
    const total = SPEND_ORDER.reduce((s, c) => s + state.spend[c], 0);
    const t = root.querySelector("[data-spend-total]");
    if (t) t.textContent = `${usd(total)}/mo`;
    for (const c of SPEND_ORDER) {
      const seg = root.querySelector<HTMLElement>(`[data-seg="${c}"]`);
      if (seg) seg.style.width = `${total ? (state.spend[c] / total) * 100 : 0}%`;
    }
    root.querySelectorAll<HTMLButtonElement>("[data-carry-set]").forEach((b) => b.classList.toggle("on", Number(b.dataset.carrySet) === state.carry));
    const drawer = root.querySelector<HTMLElement>("[data-s-drawer]");
    if (drawer && state.selected) {
      const scroll = drawer.querySelector(".drawer")?.scrollTop ?? 0;
      drawer.innerHTML = drawerHtml();
      const d = drawer.querySelector(".drawer");
      if (d) d.scrollTop = scroll;
    }
  }

  function refresh(): void {
    if (root.hidden) return;
    const p = root.querySelector("[data-s-profile]");
    if (p) p.innerHTML = profileHtml();
    const w = root.querySelector("[data-s-wallet]");
    if (w) w.innerHTML = walletHtml();
    if (!state.selected && !state.result) updateNumbers();
  }

  // ---- Actions ----

  function apply(card: CuratedCard): void {
    const l = life();
    const day = clock.day;
    const attempt = history().filter((r) => r.productId === card.tccpId).length;
    const r = applyForCard({ product: card.terms, offer: cardOffer(card), applicant: applicant(), book: l.book, history: history(), day, roll: roll("apply", day, card.slug, attempt), deposit: state.deposit });
    recordApplication(l.book, history(), r, day, { issuerKey: card.terms.issuerKey, productId: card.tccpId, bonusCardId: card.slug });
    if (r.decision === "approved") {
      if (card.secured) {
        const checking = l.ledger.get("checking");
        checking.balance = Math.round((checking.balance - state.deposit) * 100) / 100;
        host.log(day, "CARD", `Paid a ${usd(state.deposit)} refundable deposit for the ${card.name}`, "info");
      }
      const debt = openCard(l.book, card.terms, r, day, `card-${card.slug}-${day}`);
      debt.name = card.name;
      host.log(day, "CARD", `Approved for the ${card.name}: ${usd(r.creditLimit ?? 0)} limit at ${pct(r.apr)}`, "up");
    } else if (r.decision === "pending") {
      host.log(day, "CARD", `${card.name} application is pending review`, "info");
    } else {
      host.log(day, "CARD", `${card.name} application declined${r.hardInquiry ? " (hard inquiry recorded)" : ""}`, "down");
    }
    state.result = { card, r, prequal: false };
    host.onChange();
  }

  root.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-shop-open],[data-shop-close],[data-shop-view],[data-shop-credit],[data-shop-sort],[data-shop-nofee],[data-shop-prequal],[data-shop-apply],[data-shop-dismiss],[data-carry-set],[data-deposit-set],[data-card]");
    if (!el) return;
    const d = el.dataset;
    if (d.carrySet !== undefined) state.carry = Number(d.carrySet);
    else if (d.depositSet !== undefined) state.deposit = Number(d.depositSet);
    else if (d.shopDismiss !== undefined) state.result = null;
    else if (d.shopClose !== undefined) state.selected = null;
    else if (d.shopOpen) state.selected = d.shopOpen;
    else if (d.card && !(ev.target as HTMLElement).closest("button")) state.selected = d.card;
    else if (d.shopView) state.view = d.shopView as View;
    else if (d.shopCredit) state.credit = d.shopCredit as CreditFilter;
    else if (d.shopSort) state.sort = d.shopSort as Sort;
    else if (d.shopNofee !== undefined) state.noFee = !state.noFee;
    else if (d.shopPrequal) {
      const card = bySlug(d.shopPrequal);
      state.result = { card, r: prequal(card), prequal: true };
    } else if (d.shopApply) {
      apply(bySlug(d.shopApply));
    } else return;
    render();
  });

  root.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    const d = el.dataset;
    // Typed amounts update the tiles as you type; the deposit waits for Enter or blur (see "change"),
    // because it lives in the drawer, which rebuilds when the numbers change.
    if (d.spend) {
      state.spend[d.spend as SpendCategory] = typedDollars(el.value, 0, 20_000);
      updateNumbers();
    } else if (d.carry !== undefined) {
      state.carry = typedDollars(el.value, 0, 100_000);
      updateNumbers();
    } else if (d.planQ !== undefined) {
      state.planQuery = el.value;
      const pos = el.selectionStart;
      render();
      const again = root.querySelector<HTMLInputElement>("[data-plan-q]");
      if (again) {
        again.focus();
        again.setSelectionRange(pos, pos);
      }
    }
  });

  // Re-sort tiles once a spending slider is released, not while dragging.
  root.addEventListener("change", (ev) => {
    const el = ev.target as HTMLInputElement;
    const d = el.dataset;
    if (d.deposit !== undefined) {
      state.deposit = typedDollars(el.value, 200, 2_000);
      render();
    } else if (d.spend || d.carry !== undefined) {
      // Show the cleaned-up amount, and re-sort once the typing is done.
      el.value = usd(d.spend ? state.spend[d.spend as SpendCategory] : state.carry);
      if (state.sort === "value" || state.sort === "match") render();
    }
  });

  root.addEventListener("keydown", (ev) => {
    const el = ev.target as HTMLElement;
    if (ev.key === "Enter" && el.matches("input[data-spend], input[data-carry], input[data-deposit]")) (el as HTMLInputElement).blur();
  });

  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (state.result) state.result = null;
    else if (state.selected) state.selected = null;
    else return;
    render();
  });

  // Card tilt and light sheen follow the pointer.
  root.addEventListener("pointermove", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-tilt]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  });
  root.addEventListener("pointerout", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-tilt]");
    if (el && !el.contains(ev.relatedTarget as Node)) {
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    }
  });

  function select(slug: string): void {
    state.selected = slug;
    state.result = null;
    state.view = "featured";
  }

  return { refresh, render, select };
}

function labelFor(c: EarnCategory): string {
  return (
    {
      dining: "Dining",
      groceries: "Groceries",
      gas: "Gas",
      travel: "Travel",
      travel_portal: "Travel booked through the issuer",
      streaming: "Streaming",
      transit: "Transit",
      drugstores: "Drugstores",
      entertainment: "Entertainment",
      rotating: "Rotating quarterly categories",
      top_category: "Your top eligible category each month",
      everything: "Everything else",
    } as Record<EarnCategory, string>
  )[c];
}
