// A small speech-bubble card for the NPC the player clicked. For the 8 named
// roster NPCs (engine/people.ts's residents), it also fetches and shows their
// real Nessie-mirrored bank statement (api/bank.ts) instead of just a thought.

import type { NpcInfo } from "../engine/people";
import type { BankClient } from "../api/bank";
import type { BankView } from "../sim/mirror/types";

const ACCOUNT_LABEL: Record<string, string> = { checking: "Checking", savings: "Savings", credit: "Credit card" };

export class NpcCard {
  private readonly el: HTMLElement;
  private hideTimer = 0;
  private readonly bank: BankClient;
  /** Bumped on every show(); a stale fetch from a previous click checks this before rendering. */
  private generation = 0;

  constructor(root: HTMLElement, bank: BankClient) {
    this.el = root;
    this.bank = bank;
    root.addEventListener("click", () => this.hide());
  }

  show(npc: NpcInfo | null, sx: number, sy: number): void {
    if (!npc) return this.hide();
    const generation = ++this.generation;
    this.el.innerHTML = `
      <div class="npc-name">${npc.name}</div>
      <div class="npc-meta">${npc.age} · ${npc.job}</div>
      <div class="npc-thought">“${npc.thought}”</div>
      ${npc.residentId ? `<div class="npc-bank" id="npc-bank-body">Loading bank statement…</div>` : ""}`;
    this.el.hidden = false;
    this.position(sx, sy);
    window.clearTimeout(this.hideTimer);
    // Residents get a longer window: there's more to read once the statement loads.
    this.hideTimer = window.setTimeout(() => this.hide(), npc.residentId ? 12_000 : 6_000);
    if (npc.residentId) void this.loadStatement(npc.residentId, generation);
  }

  hide(): void {
    this.el.hidden = true;
  }

  private position(sx: number, sy: number): void {
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(10, sx - w / 2))}px`;
    this.el.style.top = `${Math.max(10, sy - h - 34)}px`;
  }

  private async loadStatement(entity: string, generation: number): Promise<void> {
    try {
      const view = await this.bank.statement(entity);
      if (generation !== this.generation) return; // the player clicked someone else while this was in flight
      this.renderStatement(view);
    } catch {
      if (generation !== this.generation) return;
      const body = this.el.querySelector("#npc-bank-body");
      if (body) body.textContent = "Bank statement unavailable right now.";
    }
  }

  private renderStatement(view: BankView): void {
    const body = this.el.querySelector("#npc-bank-body");
    if (!body) return; // the card was hidden or replaced before this resolved
    const rows = view.accounts
      .map((a) => `<div class="npc-bank-row"><span>${ACCOUNT_LABEL[a.account] ?? a.account}</span><span>$${a.balance.toLocaleString()}</span></div>`)
      .join("");
    const recent = view.accounts
      .flatMap((a) => a.transactions.map((t) => ({ ...t, account: a.account })))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3)
      .map((t) => `<div class="npc-bank-txn"><span>${t.memo}</span><span>${t.amount >= 0 ? "+" : "-"}$${Math.abs(t.amount).toLocaleString()}</span></div>`)
      .join("");
    body.innerHTML = `${rows}${recent ? `<div class="npc-bank-recent">${recent}</div>` : ""}`;
  }
}
