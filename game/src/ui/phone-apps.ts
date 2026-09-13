// The phone's Mail, News, and Bank apps (ui/phone.ts places them). Mail is the
// life's letters (sim/mail); News is the Larp City Ledger for a game month,
// written by the server from the run's stored data (POST /api/news); Bank is
// the player's Capital One Nessie mirror (GET /api/bank/player). The markup is
// plain functions of data, and NewsApp and BankApp take their fetches and
// their render target as deps, so all of it tests in Node.

import type { MailItem } from "../sim/mail/inbox";

/** One Ledger story (server/src/ai/facts.ts Story). */
export interface Story {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export type NewsView = { status: "loading" } | { status: "off" } | { status: "ready"; label: string; stories: Story[] };

/** Multi-word phrases: unambiguous, so plain substring matching is fine. */
const MARKET_PHRASES = ["stock", "share", "market", "bear market", "bull market", "larp markets"];
/** Short ticker-style keywords: plain substring matching false-positives inside ordinary words
 *  ("cof" inside "coffee"), so these match on a word boundary instead. */
const MARKET_TICKERS = ["ltm", "bond", "nnst", "cof", "goog", "gddy", "elvn", "tgdt", "vltr", "bkbd", "prsn"];
const MARKET_TICKER_RE = new RegExp(`\\b(?:${MARKET_TICKERS.join("|")})\\b`, "i");

/** True if any of a story's text fields mention the market or one of the game's tradeable instruments — the closest client-side proxy available, since the client Story type carries no category field. */
export function isStockMarketStory(s: Story): boolean {
  const text = `${s.title} ${s.where} ${s.blurb} ${s.impact}`.toLowerCase();
  return MARKET_PHRASES.some((k) => text.includes(k)) || MARKET_TICKER_RE.test(text);
}

/** A "ready" view with only stock-market stories; other statuses pass through unchanged. */
function marketOnly(v: NewsView): NewsView {
  return v.status === "ready" ? { ...v, stories: v.stories.filter(isStockMarketStory) } : v;
}

/** The player's mirrored bank statement (server/src/mirror.ts Statement). */
export interface BankStatement {
  entity: string;
  name: string;
  run: string;
  accounts: {
    account: "checking" | "savings" | "credit";
    nessieId: string;
    accountNumber: string;
    opening: number;
    /** On the credit card, what's owed. */
    balance: number;
    /** Signed: positive adds to the balance (on the credit card, a charge that adds to what's owed). */
    transactions: { date: string; amount: number; memo: string; key: string }[];
  }[];
}

/** The event kinds Mail shows: bills, debt trouble, and their resolutions. Mail from before `kind`
 *  existed (`kind === undefined`, from an old save) is treated as billing too, so old read mail isn't hidden. */
const BILLING_MAIL_KINDS: ReadonlySet<NonNullable<MailItem["kind"]>> = new Set([
  "bill",
  "missed",
  "late_mark",
  "penalty_apr",
  "collections",
  "repossessed",
  "default",
  "paid_off",
  "cannot_cover",
  "bankruptcy_eligible",
]);

export function isBillingMail(item: MailItem): boolean {
  return item.kind === undefined || item.decision || BILLING_MAIL_KINDS.has(item.kind);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Whole dollars, with the Money desk's minus sign before the dollar sign. */
const usd = (n: number) => `${Math.round(n) < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const ACCOUNT_NAME = { checking: "Checking", savings: "Savings", credit: "Credit card" } as const;
/** Latest transactions shown per account. */
const BANK_ROWS = 5;

export function mailHtml(items: MailItem[], openId: string | null, dateOf: (day: number) => Date): string {
  if (!items.length) return `<li class="app-empty">No mail yet. Letters arrive when something big happens to your money.</li>`;
  return items
    .map((m) => {
      const date = dateOf(m.day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const open = m.id === openId;
      // The id and tone come back from saves, so they're escaped like the text.
      return `<li class="mail-item${open ? " open" : ""}"><button class="mail-row ${esc(m.tone)}${m.read ? "" : " mail-unread"}" data-mail-id="${esc(m.id)}" aria-expanded="${open}">
          <span class="mail-from"><b>${esc(m.from)}</b><em>${date}</em></span>
          <span class="mail-subject">${esc(m.subject)}</span>
        </button>${
          open
            ? `<div class="mail-body"><p>${esc(m.body)}</p>${m.decision ? `<button class="mail-open" data-desk>Open Money <span aria-hidden="true">↗</span></button>` : ""}</div>`
            : ""
        }</li>`;
    })
    .join("");
}

/**
 * The game days the Ledger covers on game day `day` (calendar date `date`):
 * the last whole game month, or in the game's first month the days played so
 * far. Day 0 is mid-month, so the first whole month can start partway through.
 */
export function ledgerRange(day: number, date: Date): { from: number; to: number; label: string } {
  const firstOfMonth = day - (date.getDate() - 1);
  const whole = firstOfMonth > 0;
  const daysLastMonth = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
  const from = whole ? Math.max(0, firstOfMonth - daysLastMonth) : 0;
  const to = whole ? firstOfMonth - 1 : day;
  const month = whole ? new Date(date.getFullYear(), date.getMonth() - 1, 1) : date;
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric" }) + (whole ? "" : ", so far");
  return { from, to, label };
}

export function newsHtml(v: NewsView): string {
  if (v.status === "loading") return `<p class="app-empty">Printing the Ledger…</p>`;
  if (v.status === "off")
    return `<p class="app-empty">The newsroom is closed: the Ledger needs the game's server and a recorded run.</p><button class="app-retry" data-news-retry>Try again</button>`;
  if (!v.stories.length) return `<p class="news-date">${esc(v.label)}</p><p class="app-empty">A quiet month. Nothing made the paper.</p>`;
  return `<p class="news-date">${esc(v.label)}</p>${v.stories
    .map((s) => `<article class="news-story"><span class="news-where">${esc(s.where)}</span><h3>${esc(s.title)}</h3><p>${esc(s.blurb)}</p><p class="news-impact">${esc(s.impact)}</p></article>`)
    .join("")}`;
}

export function bankHtml(s: BankStatement | "off" | "loading"): string {
  if (s === "loading") return `<p class="app-empty">Calling the bank…</p>`;
  if (s === "off" || !s.accounts.length) return `<p class="app-empty">Your bank isn't connected yet. Statements post here once a game month ends.</p>`;
  return s.accounts
    .map((a) => {
      const credit = a.account === "credit";
      // The card's balance is what's owed, so a charge (which adds to it) is money going out.
      const shown = (n: number) => (credit ? -n : n);
      const balance = credit
        ? a.balance > 0
          ? `<strong class="down">${usd(a.balance)} owed</strong>`
          : a.balance < 0
            ? `<strong class="up">${usd(-a.balance)} credit</strong>`
            : `<strong>$0 owed</strong>`
        : `<strong>${usd(a.balance)}</strong>`;
      const rows = a.transactions.slice(-BANK_ROWS).reverse();
      return `<section class="bank-acct">
        <header><b>${ACCOUNT_NAME[a.account]}</b><span>•••• ${esc(a.accountNumber.slice(-4))}</span>${balance}</header>
        <ul>${
          rows.length
            ? rows
                .map((t) => {
                  const v = shown(t.amount);
                  return `<li><span class="bank-memo">${esc(t.memo)}<em>${esc(t.date)}</em></span><span class="bank-amt ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${usd(v)}</span></li>`;
                })
                .join("")
            : `<li class="bank-none">No activity yet</li>`
        }</ul>
      </section>`;
    })
    .join("");
}

/** Where an app draws: the phone's view element, or a stand-in in tests. */
export interface Target {
  innerHTML: string;
}

export interface NewsDeps {
  target: Target;
  /** The game day and its calendar date. */
  day: () => number;
  date: () => Date;
  /** The city's run recorder; the Ledger prints from the run it recorded. */
  recorder?: { idle(): Promise<void>; tick(force?: boolean): Promise<unknown>; readonly runId: string | null };
  fetchNews: (body: { runId: string; from: number; to: number }) => Promise<{ stories: Story[] }>;
}

/**
 * The Ledger. It covers ledgerRange's days; the run's unsent days go to the
 * server first, and a rewind's fork has to answer before there is a run to
 * print from. Answers are cached by run and range, one fetch per range is in
 * flight at a time, and an answer that arrives after a rewind or after the
 * player left News is not drawn (nor, after a rewind, cached).
 */
export class NewsApp {
  private readonly d: NewsDeps;
  /** Bumped by each load, leave(), and rewound(): an answer is drawn only if nothing bumped it since its load. */
  private gen = 0;
  /** Bumped by rewound(): an answer from before the rewind is never cached. */
  private epoch = 0;
  private readonly cache = new Map<string, NewsView>();
  private readonly inflight = new Map<string, Promise<NewsView>>();

  constructor(d: NewsDeps) {
    this.d = d;
  }

  async load(): Promise<void> {
    const gen = ++this.gen;
    const { from, to, label } = ledgerRange(this.d.day(), this.d.date());
    const runId = this.d.recorder?.runId;
    const cached = runId ? this.cache.get(`${runId}|${from}-${to}`) : undefined;
    if (cached) return void (this.d.target.innerHTML = newsHtml(marketOnly(cached)));
    this.d.target.innerHTML = newsHtml({ status: "loading" });
    const key = `${this.epoch}|${from}-${to}`;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.fetch(from, to, label).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const view = await p;
    if (gen === this.gen) this.d.target.innerHTML = newsHtml(marketOnly(view));
  }

  /** The player left News: an answer still on its way isn't drawn. */
  leave(): void {
    this.gen++;
  }

  /** The city went back in time: the Ledger's days changed, so nothing from before counts. */
  rewound(): void {
    this.gen++;
    this.epoch++;
    this.cache.clear();
  }

  private async fetch(from: number, to: number, label: string): Promise<NewsView> {
    const { recorder } = this.d;
    if (!recorder) return { status: "off" };
    const epoch = this.epoch;
    try {
      await recorder.idle();
      await recorder.tick(true);
      const runId = recorder.runId;
      if (!runId) return { status: "off" };
      const r = await this.d.fetchNews({ runId, from, to });
      const view: NewsView = { status: "ready", label, stories: r.stories };
      if (epoch === this.epoch) this.cache.set(`${runId}|${from}-${to}`, view);
      return view;
    } catch {
      // "Off"; "Try again" (or the next open) asks again.
      return { status: "off" };
    }
  }
}

export interface BankDeps {
  target: Target;
  fetchStatement: () => Promise<BankStatement>;
}

/** The Nessie statement, asked for fresh on each open; an answer that arrives after the player left (or a rewind) isn't drawn. */
export class BankApp {
  private readonly d: BankDeps;
  private gen = 0;

  constructor(d: BankDeps) {
    this.d = d;
  }

  async load(): Promise<void> {
    const gen = ++this.gen;
    this.d.target.innerHTML = bankHtml("loading");
    let s: BankStatement | "off";
    try {
      s = await this.d.fetchStatement();
    } catch {
      s = "off";
    }
    if (gen === this.gen) this.d.target.innerHTML = bankHtml(s);
  }

  leave(): void {
    this.gen++;
  }
}
