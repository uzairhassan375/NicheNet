// keywordList: one single-line field per keyword. Enter adds the next field.
// The hidden <textarea name="keywords"> stays the real form value (one keyword
// per line), so reading, saving and presets work exactly as before.

const SVG_NS = "http://www.w3.org/2000/svg";

function closeIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-close");
  svg.append(use);
  return svg;
}

export function createKeywordList({ list, source, addButton }) {
  const doc = list.ownerDocument;

  const rows = () => [...list.querySelectorAll(".kw-row")];
  const inputs = () => [...list.querySelectorAll(".kw-input")];

  // Write the fields back to the textarea. The input event lets the form save
  // filters and refresh the keyword count, as typing in the textarea did.
  function sync() {
    source.value = inputs()
      .map((input) => input.value.trim())
      .filter(Boolean)
      .join("\n");
    const { Event: PageEvent } = doc.defaultView || globalThis;
    list.dispatchEvent(new PageEvent("input", { bubbles: true }));
  }

  function renumber() {
    const all = rows();
    all.forEach((row, index) => {
      row.querySelector(".kw-num").textContent = String(index + 1);
      const input = row.querySelector(".kw-input");
      input.setAttribute("aria-label", `Product name ${index + 1}`);
      input.placeholder = index === 0 ? "e.g. wooden serving tray" : "Next product name";
      row.querySelector(".kw-remove").setAttribute("aria-label", `Remove product name ${index + 1}`);
    });
    list.classList.toggle("single", all.length === 1);
  }

  function makeRow(value = "") {
    const row = doc.createElement("div");
    row.className = "kw-row";
    const number = doc.createElement("span");
    number.className = "kw-num";
    number.setAttribute("aria-hidden", "true");
    const input = doc.createElement("input");
    input.type = "text";
    input.className = "kw-input";
    input.maxLength = 200;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = value;
    input.disabled = source.disabled;
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "ghost icon sm kw-remove";
    remove.title = "Remove product name";
    remove.disabled = source.disabled;
    remove.append(closeIcon(doc));
    row.append(number, input, remove);
    return row;
  }

  function insertAfter(row, value = "") {
    const next = makeRow(value);
    if (row) row.after(next);
    else list.append(next);
    renumber();
    return next.querySelector(".kw-input");
  }

  function removeRow(row, focusNeighbour) {
    const all = rows();
    const index = all.indexOf(row);
    if (all.length === 1) {
      row.querySelector(".kw-input").value = "";
    } else if (row.isConnected) {
      row.remove();
      renumber();
    }
    if (focusNeighbour) {
      const left = inputs();
      const target = left[Math.max(0, Math.min(index - 1, left.length - 1))];
      target?.focus();
      target?.setSelectionRange(target.value.length, target.value.length);
    }
    sync();
  }

  // Rebuild the fields from the textarea (filters loaded, preset applied, ...).
  function render() {
    const words = String(source.value || "")
      .split(/\r?\n/)
      .map((word) => word.trim())
      .filter(Boolean);
    list.replaceChildren(...(words.length ? words : [""]).map((word) => makeRow(word)));
    renumber();
  }

  list.addEventListener("keydown", (event) => {
    const input = event.target.closest(".kw-input");
    if (!input) return;
    const row = input.closest(".kw-row");
    if (event.key === "Enter") {
      // Enter adds a keyword instead of submitting the form.
      event.preventDefault();
      if (!input.value.trim()) return;
      const nextInput = row.nextElementSibling?.querySelector(".kw-input");
      (nextInput && !nextInput.value.trim() ? nextInput : insertAfter(row)).focus();
    } else if (event.key === "Backspace" && input.value === "" && rows().length > 1) {
      event.preventDefault();
      removeRow(row, true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const all = inputs();
      const target = all[all.indexOf(input) + (event.key === "ArrowDown" ? 1 : -1)];
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  });

  list.addEventListener("input", (event) => {
    if (event.target.closest(".kw-input")) sync();
  });

  // Pasting a list (one keyword per line) fills one field per keyword.
  list.addEventListener("paste", (event) => {
    const input = event.target.closest(".kw-input");
    const text = event.clipboardData?.getData("text") || "";
    if (!input || !/\r?\n/.test(text.trim())) return;
    event.preventDefault();
    const words = text.split(/\r?\n/).map((word) => word.trim()).filter(Boolean);
    let row = input.closest(".kw-row");
    if (!input.value.trim()) input.value = words.shift() || "";
    let last = input;
    for (const word of words) {
      last = insertAfter(row, word);
      row = last.closest(".kw-row");
    }
    last.focus();
    sync();
  });

  list.addEventListener("click", (event) => {
    const remove = event.target.closest(".kw-remove");
    if (remove) removeRow(remove.closest(".kw-row"), true);
  });

  // An empty extra field disappears when you leave it. This waits until focus
  // has moved, because removing a focused field fires focusout again.
  list.addEventListener("focusout", (event) => {
    const row = event.target.closest(".kw-row");
    if (!row || row.contains(event.relatedTarget)) return;
    setTimeout(() => {
      const input = row.querySelector(".kw-input");
      if (!row.isConnected || input.value.trim() || rows().length < 2 || row.contains(doc.activeElement)) return;
      row.remove();
      renumber();
    });
  });

  addButton?.addEventListener("click", () => {
    const all = inputs();
    const empty = all.find((input) => !input.value.trim());
    (empty || insertAfter(all.at(-1)?.closest(".kw-row"))).focus();
  });

  render();
  return { render };
}
