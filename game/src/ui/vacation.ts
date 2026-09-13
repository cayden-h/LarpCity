// A tiny, self-contained "go on vacation" UI moment: a pixel-art plane flies
// across the whole screen for a few seconds while the vacation happiness pulse
// fires. Mounted on demand (no persistent DOM); the pop-up is appended to
// `document.body`, not the phone, so it's visible even though the phone panel
// clips its own contents.
import { PULSE_TABLE, triggerPulse } from "../sim/wellbeing/index.ts";

const STYLE_ID = "vacation-popup-style";
const POPUP_MS = 3600;
/** A vacation can't be retriggered to hold happiness at its cap; this is roughly how long the
 *  pulse's own decay (14-day half-life) takes to become negligible, with room to spare. */
export const VACATION_COOLDOWN_DAYS = 90;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .vacation-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      pointer-events: none;
      overflow: hidden;
    }
    .vacation-plane {
      position: absolute;
      top: 22%;
      left: -140px;
      width: 120px;
      height: 60px;
      animation: vacation-fly ${POPUP_MS}ms linear forwards;
    }
    @keyframes vacation-fly {
      0% { transform: translate(0, 0); opacity: 0; }
      8% { opacity: 1; }
      92% { opacity: 1; }
      100% { transform: translate(calc(100vw + 200px), -18vh); opacity: 0; }
    }
    .vacation-banner {
      position: absolute;
      top: 12%;
      left: 50%;
      transform: translateX(-50%);
      border: 3px solid var(--edge, #101a23);
      background: linear-gradient(#ffe778, #ffcf2f);
      color: #16212b;
      font-family: "Pixelify Sans", monospace;
      font-size: 18px;
      font-weight: 700;
      padding: 10px 18px;
      box-shadow: inset 3px 3px #fff5ac, inset -3px -3px #c58b13, 0 3px #11283a;
      animation: vacation-banner ${POPUP_MS}ms ease-out forwards;
    }
    @keyframes vacation-banner {
      0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      10% { opacity: 1; transform: translateX(-50%) translateY(0); }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

/** A flat-color, pixel-art-style plane: a fuselage, tail fin, and two wings, no gradients or blur. */
const PLANE_SVG = `
<svg viewBox="0 0 60 30" width="120" height="60" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
  <rect x="10" y="12" width="34" height="8" fill="#ffdb39" stroke="#101a23" stroke-width="1"/>
  <rect x="40" y="8" width="8" height="16" fill="#edae17" stroke="#101a23" stroke-width="1"/>
  <polygon points="8,16 0,12 0,20" fill="#0966ae" stroke="#101a23" stroke-width="1"/>
  <polygon points="20,12 26,2 32,12" fill="#0966ae" stroke="#101a23" stroke-width="1"/>
  <polygon points="20,20 26,28 32,20" fill="#0966ae" stroke="#101a23" stroke-width="1"/>
  <rect x="30" y="14" width="6" height="4" fill="#b6ecff" stroke="#101a23" stroke-width="1"/>
</svg>`;

function showPopup(): void {
  ensureStyles();
  const overlay = document.createElement("div");
  overlay.className = "vacation-overlay";
  overlay.innerHTML = `
    <div class="vacation-plane">${PLANE_SVG}</div>
    <div class="vacation-banner">Off on vacation! ✈️</div>
  `;
  document.body.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), POPUP_MS);
}

interface VacationLife {
  addPulse(p0: number, halfLifeDays: number, day: number): void;
  pulses: readonly { p0: number; halfLifeDays: number; startDay: number }[];
}

/** True if a `vacation` pulse fired within the cooldown window, identified by its shape (pulses don't carry a name).
 *  Exported so the cooldown logic tests without a DOM (`goOnVacation` itself pops up a plane onto `document.body`). */
export function onVacationCooldown(life: VacationLife, today: number): boolean {
  const { p0, halfLifeDays } = PULSE_TABLE.vacation;
  return life.pulses.some(
    (p) => p.p0 === p0 && p.halfLifeDays === halfLifeDays && today - p.startDay < VACATION_COOLDOWN_DAYS,
  );
}

/**
 * Sends the player on vacation: shows the plane pop-up and fires the
 * `vacation` wellbeing pulse via the shared `triggerPulse` helper. No-ops
 * (and returns false) within `VACATION_COOLDOWN_DAYS` of the last vacation,
 * so spamming the button can't hold happiness at its cap.
 */
export function goOnVacation(life: VacationLife, today: number): boolean {
  if (onVacationCooldown(life, today)) return false;
  showPopup();
  triggerPulse(life, "vacation", today);
  return true;
}
