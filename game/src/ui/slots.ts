// The save slot picker (meeting 2026-09-13): the player's three lives, and
// the pre-built demo lives judges can drop into any slot. Opened from the
// Calendar's year view, or on load with ?slots=1. Picking a slot reloads the
// page into it; loading a demo into a slot replaces that slot's life, so it
// asks twice, like "Start a new life".

import "./slots.css";
import { saveApi, type SlotSummary } from "../sim/save/client";
import { DEMOS, SLOT_IDS, type SlotId } from "../sim/save/slot";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

function describe(s: SlotSummary, start: Date): string {
  const date = new Date(start);
  date.setDate(date.getDate() + s.gameDay);
  const parts = [
    s.age === null ? null : `Age ${Math.floor(s.age)}`,
    s.state,
    date.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    s.netWorth === null ? null : `${money(s.netWorth)} net worth`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Reloads the page into `slot`, loading a demo life into it when `demo` is given. */
function go(slot: SlotId, demo?: string): void {
  const url = new URL(location.href);
  url.searchParams.set("slot", String(slot));
  url.searchParams.delete("slots");
  url.searchParams.delete("intake");
  if (demo) url.searchParams.set("demo", demo);
  else url.searchParams.delete("demo");
  location.href = url.toString();
}

export async function openSlots(o: { current: SlotId; start: Date }): Promise<void> {
  if (document.querySelector(".slots-back")) return;
  const back = document.createElement("div");
  back.className = "slots-back";
  back.innerHTML = `<div class="slots" role="dialog" aria-modal="true" aria-label="Save slots"><p class="slots-wait">Loading your slots…</p></div>`;
  document.body.appendChild(back);
  const panel = back.querySelector<HTMLElement>(".slots")!;
  const close = () => back.remove();

  let slots: (SlotSummary | null)[] = SLOT_IDS.map(() => null);
  let offline = false;
  try {
    slots = (await saveApi(undefined, o.current).me()).slots ?? slots;
  } catch {
    offline = true;
  }
  /** The demo button armed for its second tap, as "demo:slot". */
  let armed: string | null = null;

  const render = () => {
    const slotRows = SLOT_IDS.map((id) => {
      const s = slots[id];
      const here = id === o.current;
      return `<li class="slot${here ? " here" : ""}">
          <div><b>Slot ${id + 1}${here ? " · playing" : ""}</b><span>${s ? esc(describe(s, o.start)) : "Empty"}</span></div>
          ${here ? "" : `<button class="slots-btn" data-play="${id}">${s ? "Play" : "Start a life"}</button>`}
        </li>`;
    }).join("");
    const demoCards = DEMOS.map(
      (d) => `<li class="demo">
          <b>${esc(d.title)}</b><span>${esc(d.pitch)}</span>
          <div class="demo-slots">${SLOT_IDS.map((id) => {
            const key = `${d.id}:${id}`;
            const taken = slots[id] !== null;
            const label = armed === key ? "Tap again to replace" : `${taken ? "Replace" : "Into"} slot ${id + 1}`;
            return `<button class="slots-btn small${armed === key ? " armed" : ""}" data-demo="${esc(d.id)}" data-slot="${id}">${label}</button>`;
          }).join("")}</div>
        </li>`,
    ).join("");
    panel.innerHTML = `
      <button class="slots-close" data-close aria-label="Close">✕</button>
      <h2>Save slots</h2>
      ${offline ? `<p class="slots-note">Can't reach the server, so slots can't be listed or loaded right now.</p>` : ""}
      <ul class="slot-list">${slotRows}</ul>
      <h2>Demo lives</h2>
      <p class="slots-note">Pre-built lives that jump straight to the good parts. Each starts a new run in the slot you pick.</p>
      <ul class="demo-list">${demoCards}</ul>`;
  };
  render();

  back.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("button, .slots-back");
    if (!el) return;
    if (el === back || el.dataset.close !== undefined) return close();
    if (offline) return;
    if (el.dataset.play !== undefined) return go(Number(el.dataset.play) as SlotId);
    if (el.dataset.demo !== undefined) {
      const slot = Number(el.dataset.slot) as SlotId;
      const key = `${el.dataset.demo}:${slot}`;
      // An empty slot loads on the first tap; replacing a life asks twice.
      if (slots[slot] === null || armed === key) return go(slot, el.dataset.demo);
      armed = key;
      render();
    }
  });
  document.addEventListener("keydown", function onKey(ev) {
    if (ev.key !== "Escape") return;
    document.removeEventListener("keydown", onKey);
    close();
  });
}
