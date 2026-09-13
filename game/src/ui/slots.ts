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

/** Reloads the page into `slot`: its saved life, a demo life when `demo` is given, or a new life over it when `fresh`. */
function go(slot: SlotId, o: { demo?: string; fresh?: boolean } = {}): void {
  const url = new URL(location.href);
  url.searchParams.set("slot", String(slot));
  url.searchParams.delete("slots");
  if (o.fresh) url.searchParams.set("intake", "1");
  else url.searchParams.delete("intake");
  if (o.demo) url.searchParams.set("demo", o.demo);
  else url.searchParams.delete("demo");
  location.href = url.toString();
}

/**
 * The slot picker. In the game it's a dialog over the city (`current` is the
 * slot playing). Right after the title screen (`boot`) it's the whole screen
 * over a blurred city, with no close: the player picks a slot to go on, and
 * the page reloads into it, so the returned promise never settles.
 */
export async function openSlots(o: { current: SlotId | null; start: Date; boot?: { backdrop: string } }): Promise<void> {
  if (document.querySelector(".slots-back")) return;
  const back = document.createElement("div");
  back.className = o.boot ? "slots-back slots-boot" : "slots-back";
  if (o.boot) back.style.setProperty("--backdrop", `url("${o.boot.backdrop}")`);
  back.innerHTML = `<div class="slots" role="dialog" aria-modal="true" aria-label="Save slots"><p class="slots-wait">Loading your slots…</p></div>`;
  document.body.appendChild(back);
  const panel = back.querySelector<HTMLElement>(".slots")!;
  const close = () => back.remove();

  let slots: (SlotSummary | null)[] = SLOT_IDS.map(() => null);
  let offline = false;
  try {
    slots = (await saveApi(undefined, o.current ?? 0).me()).slots ?? slots;
  } catch {
    offline = true;
  }
  /** The button armed for its second tap: "demo:slot" for a demo, "new:slot" for a new life over a save. */
  let armed: string | null = null;

  const render = () => {
    const slotRows = SLOT_IDS.map((id) => {
      const s = slots[id];
      const here = id === o.current;
      const fresh = `new:${id}`;
      const buttons = here
        ? ""
        : s
          ? `<button class="slots-btn" data-play="${id}">Play</button>${
              o.boot ? `<button class="slots-btn small${armed === fresh ? " armed" : ""}" data-fresh="${id}">${armed === fresh ? "Tap again to erase" : "New life"}</button>` : ""
            }`
          : `<button class="slots-btn" data-play="${id}">${offline ? "Open" : "Start a life"}</button>`;
      return `<li class="slot${here ? " here" : ""}">
          <div><b>Slot ${id + 1}${here ? " · playing" : ""}</b><span>${s ? esc(describe(s, o.start)) : offline ? "Can't check right now" : "Empty"}</span></div>
          <div class="slot-btns">${buttons}</div>
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
      ${o.boot ? "" : `<button class="slots-close" data-close aria-label="Close">✕</button>`}
      <h2>${o.boot ? "Pick a save slot" : "Save slots"}</h2>
      ${
        offline
          ? `<p class="slots-note">Can't reach the server, so slots can't be listed right now.${o.boot ? " Open one to try again." : ""}</p>`
          : o.boot
            ? `<p class="slots-note">Carry on with a saved life, or start a new one in an empty slot.</p>`
            : ""
      }
      <ul class="slot-list">${slotRows}</ul>
      ${
        offline
          ? ""
          : `<h2>Demo lives</h2>
      <p class="slots-note">Pre-built lives that jump straight to the good parts. Each starts a new run in the slot you pick.</p>
      <ul class="demo-list">${demoCards}</ul>`
      }`;
  };
  render();
  if (o.boot) panel.querySelector<HTMLElement>(".slots-btn")?.focus();

  back.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("button, .slots-back");
    if (!el) return;
    if (el === back || el.dataset.close !== undefined) return o.boot ? undefined : close();
    if (el.dataset.play !== undefined) return go(Number(el.dataset.play) as SlotId);
    if (offline) return;
    if (el.dataset.fresh !== undefined) {
      const slot = Number(el.dataset.fresh) as SlotId;
      // Erasing a saved life asks twice.
      if (armed === `new:${slot}`) return go(slot, { fresh: true });
      armed = `new:${slot}`;
      return render();
    }
    if (el.dataset.demo !== undefined) {
      const slot = Number(el.dataset.slot) as SlotId;
      const key = `${el.dataset.demo}:${slot}`;
      // An empty slot loads on the first tap; replacing a life asks twice.
      if (slots[slot] === null || armed === key) return go(slot, { demo: el.dataset.demo });
      armed = key;
      render();
    }
  });
  if (o.boot) return new Promise<void>(() => undefined);
  document.addEventListener("keydown", function onKey(ev) {
    if (ev.key !== "Escape") return;
    document.removeEventListener("keydown", onKey);
    close();
  });
}
