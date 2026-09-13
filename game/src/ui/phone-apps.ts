// Markup for the phone's Mail, News, and Bank apps (ui/phone.ts draws them).
// Mail is the life's letters (sim/mail); News is the Larp City Ledger for a
// game month, written by the server from the run's stored data
// (POST /api/news); Bank is the player's Capital One Nessie mirror
// (GET /api/bank/player). Plain functions of data, so they test in Node.

import type { MailItem } from "../sim/mail/inbox";

/** One Ledger story (server/src/ai/facts.ts Story). */
export interface Story {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export type NewsView = { status: "loading" } | { status: "off" } | { status: "ready"; label: string; stories: Story[] };

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
    balance: number;
    transactions: { date: string; amount: number; memo: string; key: string }[];
  }[];
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
      return `<li class="mail-item${open ? " open" : ""}"><button class="mail-row ${m.tone}${m.read ? "" : " mail-unread"}" data-mail-id="${m.id}" aria-expanded="${open}">
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
      const rows = a.transactions.slice(-BANK_ROWS).reverse();
      return `<section class="bank-acct">
        <header><b>${ACCOUNT_NAME[a.account]}</b><span>•••• ${esc(a.accountNumber.slice(-4))}</span><strong>${usd(a.balance)}</strong></header>
        <ul>${
          rows.length
            ? rows
                .map((t) => `<li><span class="bank-memo">${esc(t.memo)}<em>${esc(t.date)}</em></span><span class="bank-amt ${t.amount >= 0 ? "up" : "down"}">${t.amount >= 0 ? "+" : ""}${usd(t.amount)}</span></li>`)
                .join("")
            : `<li class="bank-none">No activity yet</li>`
        }</ul>
      </section>`;
    })
    .join("");
}
