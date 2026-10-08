import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createKeywordList } from "../src/keywordList.js";

function setup(value = "") {
  const dom = new JSDOM(
    `<!doctype html><form><div id="list"></div><button id="add" type="button"></button><textarea name="keywords" hidden></textarea></form>`,
  );
  const { window } = dom;
  const doc = window.document;
  const source = doc.querySelector("textarea");
  source.value = value;
  const list = doc.querySelector("#list");
  const keywords = createKeywordList({ list, source, addButton: doc.querySelector("#add") });
  const fields = () => [...list.querySelectorAll(".kw-input")];
  const values = () => fields().map((input) => input.value);
  const key = (input, name) => {
    const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event;
  };
  const type = (input, text) => {
    input.value = text;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  return { window, doc, source, list, keywords, fields, values, key, type };
}

test("one field per saved keyword, or one empty field", () => {
  assert.deepEqual(setup("shelf\n\n tray \n").values(), ["shelf", "tray"]);
  const empty = setup("");
  assert.deepEqual(empty.values(), [""]);
  assert.equal(empty.list.classList.contains("single"), true);
});

test("typing fills the hidden keywords value and Enter adds the next field without submitting", () => {
  const { fields, values, key, type, source, doc } = setup();
  type(fields()[0], "wooden serving tray");
  assert.equal(source.value, "wooden serving tray");

  const enter = key(fields()[0], "Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(values(), ["wooden serving tray", ""]);
  assert.equal(doc.activeElement, fields()[1]);

  // Enter on an empty field does not add another empty one.
  key(fields()[1], "Enter");
  assert.equal(fields().length, 2);

  type(fields()[1], "wood tray with handles");
  assert.equal(source.value, "wooden serving tray\nwood tray with handles");
  assert.equal(fields()[1].getAttribute("aria-label"), "Product name 2");
});

test("Backspace on an empty field and the remove button take a keyword out", () => {
  const { fields, values, key, type, source } = setup("one\ntwo\nthree");
  type(fields()[1], "");
  key(fields()[1], "Backspace");
  assert.deepEqual(values(), ["one", "three"]);
  assert.equal(source.value, "one\nthree");

  fields()[0].closest(".kw-row").querySelector(".kw-remove").click();
  assert.deepEqual(values(), ["three"]);
  assert.equal(source.value, "three");

  // The last field is cleared, not removed.
  fields()[0].closest(".kw-row").querySelector(".kw-remove").click();
  assert.deepEqual(values(), [""]);
  assert.equal(source.value, "");
});

test("pasting a list fills one field per line", () => {
  const { window, fields, values, source } = setup("first");
  const paste = new window.Event("paste", { bubbles: true, cancelable: true });
  paste.clipboardData = { getData: () => "shelf\r\n\r\ntray\nboard\n" };
  fields()[0].dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, true);
  assert.deepEqual(values(), ["first", "shelf", "tray", "board"]);
  assert.equal(source.value, "first\nshelf\ntray\nboard");
});

test("loading saved filters or a preset rebuilds the fields", () => {
  const { keywords, source, values } = setup("old");
  source.value = "a\nb";
  keywords.render();
  assert.deepEqual(values(), ["a", "b"]);
});

test("fields follow the keywords box when it is locked during a search", () => {
  const { keywords, source, fields } = setup("a");
  source.disabled = true;
  keywords.render();
  assert.equal(fields()[0].disabled, true);
});
