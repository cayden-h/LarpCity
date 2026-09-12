// A small speech-bubble card for the NPC the player clicked.

import type { NpcInfo } from "../engine/people";

export class NpcCard {
  private readonly el: HTMLElement;
  private hideTimer = 0;

  constructor(root: HTMLElement) {
    this.el = root;
    root.addEventListener("click", () => this.hide());
  }

  show(npc: NpcInfo | null, sx: number, sy: number): void {
    if (!npc) return this.hide();
    this.el.innerHTML = `
      <div class="npc-name">${npc.name}</div>
      <div class="npc-meta">${npc.age} · ${npc.job}</div>
      <div class="npc-thought">“${npc.thought}”</div>`;
    this.el.hidden = false;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(10, sx - w / 2))}px`;
    this.el.style.top = `${Math.max(10, sy - h - 34)}px`;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 6000);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
