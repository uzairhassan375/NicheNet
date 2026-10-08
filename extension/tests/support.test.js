import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSupportChat } from "../src/support.js";

// The real chat markup from finder.html, so the test breaks if an id is renamed.
const html = readFileSync(new URL("../finder.html", import.meta.url), "utf8");
const markup = html.slice(html.indexOf('<button id="chat-fab"'), html.indexOf('<div id="toast"'));

function setup({ account = null, responses = {}, stored = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const calls = [];
  const saved = { ...stored };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const reply = responses[name];
    return typeof reply === "function" ? reply(args) : reply || { ok: true };
  };
  const storage = {
    get: async (key) => ({ [key]: saved[key] }),
    set: async (items) => Object.assign(saved, items),
  };
  const chat = createSupportChat({ doc, rpc, storage, getAccount: () => account, pollOpenMs: 60000, pollClosedMs: 60000 });
  const $ = (id) => doc.getElementById(id);
  const submit = (form) => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  const bubbles = () => [...doc.querySelectorAll(".chat-msg:not(.welcome) p")].map((p) => p.textContent);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { dom, doc, chat, calls, saved, $, submit, bubbles, tick };
}

test("someone who is not signed in gives a name and email, then sends a message", async () => {
  const { chat, calls, saved, $, submit, bubbles, tick } = setup({
    responses: {
      support_send: (args) => ({ ok: true, message: { id: 7, sender: "user", body: args.p_body, created_at: "2026-10-08T10:00:00Z" } }),
    },
  });
  await chat.start();
  $("chat-fab").click();
  await tick();
  assert.equal($("chat-panel").hidden, false);
  assert.equal($("chat-intro").hidden, false);
  assert.equal($("chat-form").hidden, true);

  $("chat-name").value = "Zara";
  $("chat-email").value = "zara@example.com";
  submit($("chat-intro"));
  await tick();
  assert.equal(saved.supportGuest.name, "Zara");
  assert.match(saved.supportGuest.key, /^[0-9a-f]{64}$/);
  assert.equal($("chat-intro").hidden, true);
  assert.equal($("chat-sub").textContent, "Chatting as Zara");

  $("chat-input").value = "  I cannot sign in  ";
  submit($("chat-form"));
  await tick();
  const sent = calls.find((call) => call.name === "support_send");
  assert.deepEqual(sent.args, {
    p_token: "",
    p_guest_key: saved.supportGuest.key,
    p_name: "Zara",
    p_email: "zara@example.com",
    p_body: "I cannot sign in",
  });
  assert.deepEqual(bubbles(), ["I cannot sign in"]);
  assert.equal($("chat-input").value, "");
  chat.stop();
});

test("a signed-in user sees the conversation, including the admin's reply", async () => {
  const { chat, calls, $, doc, bubbles, tick } = setup({
    account: { token: "tok", name: "Ali", email: "ali@example.com" },
    responses: {
      support_unread: { ok: true, unread: 2 },
      support_list_messages: {
        ok: true,
        messages: [
          { id: 1, sender: "user", body: "Where is my export?", created_at: "2026-10-08T10:00:00Z" },
          { id: 2, sender: "admin", body: "Click Download Excel.", created_at: "2026-10-08T10:05:00Z" },
        ],
      },
    },
  });
  await chat.start();
  assert.equal($("chat-badge").hidden, false);
  assert.equal($("chat-badge").textContent, "2");

  $("chat-fab").click();
  await tick();
  await tick();
  assert.equal($("chat-form").hidden, false);
  assert.equal($("chat-sub").textContent, "Signed in as Ali");
  const list = calls.find((call) => call.name === "support_list_messages");
  assert.deepEqual(list.args, { p_token: "tok", p_guest_key: null, p_after: 0 });
  assert.deepEqual(bubbles(), ["Where is my export?", "Click Download Excel."]);
  assert.equal(doc.querySelectorAll(".chat-msg.from-support:not(.welcome)").length, 1);
  assert.equal($("chat-badge").hidden, true);
  chat.stop();
});

test("a message that fails to send goes back into the box with the error", async () => {
  const { chat, $, submit, bubbles, tick } = setup({
    account: { token: "tok", name: "Ali" },
    responses: { support_send: { ok: false, error: "Too many messages in the last hour." } },
  });
  await chat.start();
  $("chat-fab").click();
  await tick();
  $("chat-input").value = "hello";
  submit($("chat-form"));
  await tick();
  assert.deepEqual(bubbles(), []);
  assert.equal($("chat-input").value, "hello");
  assert.equal($("chat-error").hidden, false);
  assert.match($("chat-error").textContent, /Too many/);
  chat.stop();
});

test("Escape and the close button hide the chat", async () => {
  const { chat, $, dom, tick } = setup({ account: { token: "tok" } });
  await chat.start();
  $("chat-fab").click();
  await tick();
  $("chat-panel").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal($("chat-panel").hidden, true);
  $("chat-fab").click();
  await tick();
  $("chat-close").click();
  assert.equal($("chat-panel").hidden, true);
  assert.equal($("chat-fab").getAttribute("aria-expanded"), "false");
  chat.stop();
});
