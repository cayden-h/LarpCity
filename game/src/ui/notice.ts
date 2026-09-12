// A blocking card over the city for the rare moments the game can't go on by
// itself: a save this version can't load, or this life being played in another
// tab. Resolves when the player presses the button. (No window.confirm: it
// blocks the page and browser automation.)

export function showNotice(o: { title: string; body: string; action: string }): Promise<void> {
  const el = document.createElement("div");
  el.className = "notice-overlay";
  el.innerHTML = `<div class="notice-card" role="alertdialog" aria-modal="true" aria-labelledby="notice-title">
      <h2 id="notice-title"></h2>
      <p></p>
      <button type="button" class="btn"></button>
    </div>`;
  el.querySelector("h2")!.textContent = o.title;
  el.querySelector("p")!.textContent = o.body;
  const button = el.querySelector("button")!;
  button.textContent = o.action;
  document.body.appendChild(el);
  button.focus();
  return new Promise((done) =>
    button.addEventListener("click", () => {
      el.remove();
      done();
    }),
  );
}
