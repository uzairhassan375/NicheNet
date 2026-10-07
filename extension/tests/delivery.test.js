import test from "node:test";
import assert from "node:assert/strict";
import "./dom-setup.js";
import { parseHtml } from "../src/parse.js";
import { manualZipMessage, prepareDelivery } from "../src/delivery.js";
import { homePage } from "./fixtures.js";

function page(html, { status = 200, headerToken = "" } = {}) {
  return {
    status,
    html,
    url: "https://www.amazon.com/",
    doc: parseHtml(html),
    headers: { get: (name) => (name.toLowerCase() === "anti-csrftoken-a2z" ? headerToken : "") },
  };
}

function cookiesFor(jar) {
  return {
    set(details, callback) {
      jar.push(details);
      callback({ name: details.name, value: details.value });
    },
  };
}

test("delivery sets USD and confirms the ZIP from the homepage", async () => {
  const jar = [];
  const posts = [];
  let manual = 0;
  const client = {
    async fetchHtml(url, options = {}) {
      if (url.includes("get-rendered-address-selections")) {
        return page("<html><input id='glowValidationToken' value='from-html'></html>", { headerToken: "header-token" });
      }
      if (options.method === "POST") {
        posts.push({ url, body: options.body, token: options.headers["anti-csrftoken-a2z"] });
        return page('{"isValidAddress":true}');
      }
      return page(homePage("New York 10001"));
    },
  };
  const verified = await prepareDelivery({
    zip: "10001",
    client,
    cookies: cookiesFor(jar),
    confirmManually: async () => {
      manual += 1;
    },
    log() {},
  });
  assert.equal(verified.text, "New York 10001");
  assert.equal(manual, 0);
  assert.equal(jar.find((cookie) => cookie.name === "i18n-prefs").value, "USD");
  assert.equal(jar.find((cookie) => cookie.name === "lc-main").value, "en_US");
  assert.equal(jar[0].domain, ".amazon.com");
  assert.equal(posts[0].token, "header-token");
  assert.match(posts[0].body, /10001/);
  assert.match(posts[0].url, /address-change/);
});

test("a failed ZIP request asks the person to use Deliver to, then checks again", async () => {
  const messages = [];
  let homes = 0;
  let manuals = 0;
  const client = {
    async fetchHtml(url, options = {}) {
      if (url.includes("get-rendered-address-selections")) return page("<html></html>");
      if (options.method === "POST") return page('{"successful":0}', { status: 400 });
      homes += 1;
      return page(homePage(homes >= 2 ? "New York 10001" : "Pakistan"));
    },
  };
  const verified = await prepareDelivery({
    zip: "10001",
    client,
    cookies: cookiesFor([]),
    confirmManually: async () => {
      manuals += 1;
    },
    log() {},
    onStatus: (text) => messages.push(text),
  });
  assert.equal(verified.ok, true);
  assert.equal(manuals, 1);
  assert.ok(messages.includes(manualZipMessage("10001")));
});

test("search does not proceed when the ZIP is still wrong after Continue", async () => {
  const client = {
    async fetchHtml(url, options = {}) {
      if (url.includes("get-rendered-address-selections")) return page("<html></html>");
      if (options.method === "POST") return page("{}", { status: 500 });
      return page(homePage("Lahore"));
    },
  };
  await assert.rejects(
    () =>
      prepareDelivery({
        zip: "10001",
        client,
        cookies: cookiesFor([]),
        confirmManually: async () => {},
        log() {},
      }),
    /Still not delivering to 10001/,
  );
});
