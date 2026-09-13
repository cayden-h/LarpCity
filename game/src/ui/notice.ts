// A blocking card over the city for the rare moments the game can't go on by
// itself: a save this version can't load, the server being unreachable, or this
// life being played in another tab. It offers one or two actions and resolves
// with the index of the one pressed. (No window.confirm: it blocks the page and
// browser automation.) While it's open, Tab stays inside the card and no key
// reaches the city's shortcuts.

export function showNotice(o: { title: string; body: string; actions: [string] | [string, string] }): Promise<number> {
  const el = document.createElement("div");
  el.className = "notice-overlay";
  el.innerHTML = `<div class="notice-card" role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-body">
      <h2 id="notice-title"></h2>
      <p id="notice-body"></p>
      <div class="notice-actions"></div>
    </div>`;
  el.querySelector("h2")!.textContent = o.title;
  el.querySelector("p")!.textContent = o.body;
  const row = el.querySelector(".notice-actions")!;
  const buttons = o.actions.map((label, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = i === 0 ? "btn" : "btn ghost";
    b.textContent = label;
    row.appendChild(b);
    return b;
  });
  const card = el.querySelector<HTMLElement>(".notice-card")!;

  // Keys aimed outside the card (focus can land on the page body) are stopped before anything sees them.
  const outside = (ev: KeyboardEvent) => {
    if (card.contains(ev.target as Node)) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if (ev.type === "keydown" && ev.key === "Tab") buttons[0].focus();
  };
  // Keys inside the card work on its buttons, and stop at the overlay so window listeners never hear them.
  const inside = (ev: KeyboardEvent) => {
    if (ev.type === "keydown" && ev.key === "Tab") {
      ev.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    ev.stopPropagation();
  };
  const kinds = ["keydown", "keyup", "keypress"] as const;
  for (const k of kinds) {
    window.addEventListener(k, outside, true);
    el.addEventListener(k, inside);
  }

  document.body.appendChild(el);
  buttons[0].focus();
  return new Promise((done) =>
    buttons.forEach((b, i) =>
      b.addEventListener("click", () => {
        for (const k of kinds) window.removeEventListener(k, outside, true);
        el.remove();
        done(i);
      }),
    ),
  );
}
