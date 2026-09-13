import './home-picker.css';
import type { Clock } from '../engine/clock';
import type { HomeLot } from '../engine/home-lots';
import type { PlayerLife } from '../sim/life';
import { isOpen } from '../sim/debt/engine.ts';
import { HOME_OPTIONS, type HomeDownPayment, type HomeQuote, type HomeState } from '../sim/life/homes.ts';

export interface HomePickerActions {
  life(): PlayerLife;
  clock(): Clock;
  lots(): HomeLot[];
  onChosen(tier: number): void;
}

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const row = (label: string, value: number, total = false) => `<div${total ? ' class="hp-total"' : ''}><dt>${label}</dt><dd>${money(value)}</dd></div>`;
let nextId = 0;

/** Lot occupancy is a badge; the simulation quote owns transaction eligibility. */
export function homePickerEligibility(home: Pick<HomeState, 'tier' | 'tenure'>, rent: number, quote: HomeQuote, hasLot: boolean) {
  const occupiesLot = home.tier === quote.tier;
  const current = occupiesLot && !quote.ok && home.tenure === quote.tenure
    && (home.tenure !== 'rent' || rent === quote.rent);
  return { occupiesLot, current, canMove: quote.tier !== 0 && quote.ok && hasLot };
}


/** Read callbacks at every quote and confirmation so a replaced scene never leaves stale lots. */
export class HomePicker {
  private readonly actions: HomePickerActions;
  private readonly dialog = document.createElement('dialog');
  private readonly id = `home-picker-${++nextId}`;
  private selected = 1;
  private downPct: HomeDownPayment = 0.2;
  private session: { life: PlayerLife; clock: Clock; speed: number; logLength: number; focus: HTMLElement | null } | null = null;
  private reviewedQuote = '';

  constructor(actions: HomePickerActions) {
    this.actions = actions;
    this.dialog.className = 'home-picker';
    this.dialog.setAttribute('aria-labelledby', `${this.id}-title`);
    this.dialog.setAttribute('aria-describedby', `${this.id}-intro`);
    this.dialog.innerHTML = `
      <header class="hp-header"><div><span class="hp-eyebrow">LARP CITY / HOMES</span><h2 id="${this.id}-title">Find your next chapter</h2></div><button type="button" class="hp-close" aria-label="Close home picker">×</button></header>
      <p class="hp-intro" id="${this.id}-intro">Compare your neighborhood, monthly housing costs, and cash needed to move. <span>Time is paused.</span></p>
      <div class="hp-layout"><section class="hp-options" aria-label="Compare all six homes"></section><section class="hp-detail" aria-label="Selected home expenses"></section></div>
      <footer class="hp-footer">Quotes use your current finances. Living costs, other debts, and investment contributions are separate.</footer>`;
    this.dialog.querySelector('.hp-close')!.addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.session && !this.dialog.open) this.close(); });
    this.dialog.addEventListener('keydown', event => {
      // Keep Escape and game shortcuts inside the modal; native dialog traps focus.
      event.stopPropagation();
    });
    this.dialog.addEventListener('keyup', event => event.stopPropagation());
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const bounds = this.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
    });
  }

  show(preferredTier?: number): void {
    if (!this.session) {
      const life = this.actions.life(), clock = this.actions.clock();
      this.session = { life, clock, speed: clock.speed, logLength: life.log.length, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      this.downPct = life.home.downPct;
      clock.speed = 0;
    }
    this.selected = HOME_OPTIONS.some(home => home.tier === preferredTier) ? preferredTier! : this.actions.life().home.tier;
    this.render();
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector<HTMLButtonElement>(`[data-home-tier="${this.selected}"]`)?.focus();
  }

  close(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.dialog.close();
    this.dialog.remove();
    const sameLife = this.actions.life() === session.life;
    const decision = session.life.needsDecision(session.life.log.slice(session.logLength));
    if (sameLife && this.actions.clock() === session.clock && session.clock.speed === 0 && !decision) session.clock.speed = session.speed;
    if (session.focus?.isConnected) session.focus.focus({ preventScroll: true });
  }

  private render(): void {
    const life = this.actions.life(), clock = this.actions.clock(), lots = this.actions.lots();
    const quotes = HOME_OPTIONS.map(home => life.quoteHome(home.tier, clock.day, { downPct: this.downPct }));
    const options = this.dialog.querySelector<HTMLElement>('.hp-options')!;
    options.innerHTML = quotes.map(q => {
      const lot = lots.find(l => l.tier === q.tier);
      const { occupiesLot, current } = homePickerEligibility(life.home, life.rent, q, !!lot);
      const badge = occupiesLot ? 'Your current home' : q.tier === 0 ? 'Emergency shelter' : !lot ? 'No available lot' : q.ok ? 'Available to move' : 'Not available yet';
      return `<button type="button" class="hp-option${occupiesLot ? ' hp-current' : ''}" data-home-tier="${q.tier}" aria-pressed="${q.tier === this.selected}" aria-controls="${this.id}-expenses">
        <span class="hp-badge">${badge}</span><span class="hp-preview"><img src="${import.meta.env.BASE_URL}sprites/common/home/home-${q.tier}-s.png" alt="" width="160" height="128"></span>
        <strong>${escape(q.name)}</strong><span class="hp-neighborhood">${escape(lot?.where ?? 'No lot in this city')}</span>
        <span class="hp-card-price">${q.tier === 0 ? 'Forced moves only' : `${money(current ? this.currentMonthly(life) : q.monthlyPayment)} <small>/ month</small>`}</span>
        <span class="hp-card-tenure">${current ? (life.home.tenure === 'own' ? 'Owned' : life.home.tenure === 'rent' ? 'Rented' : 'Temporary shelter') : q.tenure === 'own' ? `${money(q.price)} purchase` : q.tenure === 'rent' ? 'Rental' : 'Not a housing choice'}</span></button>`;
    }).join('');
    options.querySelectorAll<HTMLButtonElement>('[data-home-tier]').forEach(button => {
      button.addEventListener('click', () => {
        this.selected = Number(button.dataset.homeTier);
        this.render();
        this.dialog.querySelector<HTMLButtonElement>(`[data-home-tier="${this.selected}"]`)?.focus();
      });
    });
    this.renderDetail(quotes[this.selected], life, lots);
  }

  private currentMonthly(life: PlayerLife): number {
    if (life.home.tenure === 'rent') return life.rent;
    const bills = life.housingBills();
    const mortgage = life.book.debts.find(debt => debt.id === life.home.mortgageId);
    return (mortgage && isOpen(mortgage) ? mortgage.scheduledPayment ?? 0 : 0) + bills.taxAndInsurance + bills.pmi;
  }

  private renderDetail(q: HomeQuote, life: PlayerLife, lots: HomeLot[]): void {
    const lot = lots.find(l => l.tier === q.tier);
    const { current, canMove } = homePickerEligibility(life.home, life.rent, q, !!lot);
    const own = current ? life.home.tenure === 'own' : q.tenure === 'own';
    const bills = current ? life.housingBills() : { taxAndInsurance: q.taxAndInsurance, pmi: q.pmi };
    const mortgage = current ? this.currentMonthly(life) - bills.taxAndInsurance - bills.pmi : q.mortgagePayment;
    const monthly = current ? this.currentMonthly(life) : q.monthlyPayment;
    const reasons = current ? [] : [...q.reasons, ...(!lot ? ['No home lot is available in this city.'] : [])];
    this.reviewedQuote = JSON.stringify(q);
    const detail = this.dialog.querySelector<HTMLElement>('.hp-detail')!;
    detail.id = `${this.id}-expenses`;
    detail.innerHTML = `<span class="hp-eyebrow">${current ? 'HOME SWEET HOME' : 'YOUR MOVE, YOUR NUMBERS'}</span>
      <h3>${escape(q.name)}</h3><p class="hp-location">${escape(lot?.where ?? 'No available neighborhood')}</p>
      ${lot?.rationale ? `<details class="hp-lot-note"><summary>About this location</summary><p>${escape(lot.rationale)}</p></details>` : ''}
      <div class="hp-monthly"><strong>${money(monthly)}</strong><span>/ month in housing costs</span></div>
      ${q.tier === 0 ? '<p class="hp-notice">The tent is temporary shelter after a loss of housing. You cannot choose it voluntarily. Select another home to plan your recovery.</p>' : `
      ${own && !current ? `<fieldset class="hp-down"><legend>Down payment</legend>${([0.035, 0.1, 0.2] as const).map(pct => `<label><input type="radio" name="${this.id}-down" value="${pct}" ${pct === this.downPct ? 'checked' : ''}><span>${percent(pct)}</span></label>`).join('')}</fieldset>` : ''}
      <h4>Monthly housing breakdown</h4><dl class="hp-costs">${own ? row('Mortgage principal + interest', mortgage) + row('Property tax + home insurance', bills.taxAndInsurance) + row('Private mortgage insurance (PMI)', bills.pmi) : row('Rent', current ? life.rent : q.rent)}${row('Total housing / month', monthly, true)}</dl>
      ${own ? '<p class="hp-note">Property tax and home insurance are estimated together. PMI applies below 20% down until enough equity is built.</p>' : ''}
      ${current ? '<p class="hp-notice">You live here. These are your current housing payments. Choose another home to compare a move.</p>' : `
      <h4>Cash needed to move</h4><dl class="hp-costs">${own ? row('Purchase price', q.price) + row(`Down payment (${percent(q.downPct)})`, q.down) : ''}${row('Closing costs', q.closing)}${row('Moving costs', q.moving)}${row('Total cash needed', q.cashNeeded, true)}</dl>
      <h4>How you would pay</h4><dl class="hp-costs">${row('Checking + savings', q.cashAvailable - q.saleProceeds)}${row(q.saleProceeds < 0 ? 'Current home sale shortfall' : 'Net proceeds from current home sale', q.saleProceeds)}${row('Cash available after sale', q.cashAvailable, true)}${row(q.cashAvailable >= q.cashNeeded ? 'Cash remaining after move' : 'Additional cash needed', Math.abs(q.cashAvailable - q.cashNeeded))}</dl>
      <p class="hp-note">Net sale proceeds include selling costs and mortgage payoff. Investments are not sold to fund this move.</p>
      ${q.application ? `<section class="hp-qualification"><h4>Mortgage prequalification</h4><div class="hp-odds"><strong>${percent(q.application.odds)} estimated approval odds</strong><span>${escape(q.application.decision)}</span></div><dl class="hp-costs">${row('Amount borrowed', q.application.amount ?? q.price - q.down)}<div><dt>APR / term</dt><dd>${percent(q.application.apr)} / ${(q.application.termMonths ?? 360) / 12} years</dd></div><div><dt>Debt-to-income ratio</dt><dd>${percent(q.application.dti)}</dd></div></dl><p class="hp-note">Previewing does not apply for a loan. Confirming a purchase opens the mortgage and records a credit inquiry.</p></section>` : '<p class="hp-note">No mortgage application is needed for this rental.</p>'}`}`}
      ${reasons.length ? `<section class="hp-locks" aria-label="Why this home is unavailable"><h4>Before you can move</h4><ul>${reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul></section>` : ''}
      <div class="hp-status" role="status" aria-live="polite"></div>
      ${canMove ? `<label class="hp-confirm"><input type="checkbox"><span>I confirm the ${money(q.cashNeeded)} cash cost and ${money(q.monthlyPayment)} monthly housing payment.${life.home.tenure === 'own' ? ' My current home will be sold.' : ''}</span></label>` : ''}
      <button type="button" class="hp-move" disabled>${current ? 'Your current home' : q.tier === 0 ? 'Forced moves only' : canMove ? 'Confirm move' : 'Not available yet'}</button>`;
    detail.querySelectorAll<HTMLInputElement>('.hp-down input').forEach(input => input.addEventListener('change', () => {
      this.downPct = Number(input.value) as HomeDownPayment;
      this.render();
      detail.querySelector<HTMLInputElement>(`.hp-down input[value="${this.downPct}"]`)?.focus();
    }));
    const move = detail.querySelector<HTMLButtonElement>('.hp-move')!;
    detail.querySelector<HTMLInputElement>('.hp-confirm input')?.addEventListener('change', event => {
      move.disabled = !(event.target as HTMLInputElement).checked;
    });
    move.addEventListener('click', () => this.confirmMove());
  }

  private confirmMove(): void {
    const checkbox = this.dialog.querySelector<HTMLInputElement>('.hp-confirm input');
    if (!checkbox?.checked) return;
    const life = this.actions.life(), clock = this.actions.clock();
    const quote = life.quoteHome(this.selected, clock.day, { downPct: this.downPct });
    if (!quote.ok || !this.actions.lots().some(lot => lot.tier === this.selected) || this.reviewedQuote !== JSON.stringify(quote)) {
      this.render();
      this.announce('Your quote changed. Review the updated costs before confirming.');
      return;
    }
    const result = life.chooseHome(this.selected, clock.day, { downPct: this.downPct });
    if (!result.ok) {
      this.render();
      this.announce(result.error);
      return;
    }
    const tier = this.selected;
    // Restore our pause before the parent syncs; a parent decision pause then wins.
    this.close();
    this.actions.onChosen(tier);
  }

  private announce(message: string): void {
    const status = this.dialog.querySelector<HTMLElement>('.hp-status')!;
    status.textContent = message;
    status.tabIndex = -1;
    status.focus();
  }
}
