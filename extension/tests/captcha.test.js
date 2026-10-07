import test from "node:test";
import assert from "node:assert/strict";
import "./dom-setup.js";
import { detectBlock } from "../src/captcha.js";
import { createAmazonClient } from "../src/amazonClient.js";
import { createJobControl } from "../src/jobControl.js";
import { createPacer } from "../src/pacer.js";
import { searchResultsPage } from "./fixtures.js";

const searchHtml = searchResultsPage([
  { asin: "B0FBM00001", title: "Shelf", rating: "4.8", reviewsLabel: "180", price: "$25.00" },
]);

function response({ status = 200, body, url, headers = {} }) {
  return {
    status,
    url,
    async text() {
      return body;
    },
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || "";
      },
    },
  };
}

test("a real search page is not treated as a block", () => {
  assert.equal(detectBlock({ html: searchHtml, status: 200, url: "https://www.amazon.com/s?k=a", kind: "search" }).blocked, false);
  const empty = "<html><head><title>Amazon.com : none</title></head><body><div id='search'><p>No results for shelves</p></div></body></html>";
  assert.equal(detectBlock({ html: empty, status: 200, url: "https://www.amazon.com/s?k=a", kind: "search" }).blocked, false);
});

test("captcha, robot check, the error page, HTTP 503, and a bare search response are blocks", () => {
  assert.equal(detectBlock({ html: "<html><body>validateCaptcha</body></html>", status: 200, kind: "home" }).blocked, true);
  assert.equal(detectBlock({ html: "<html><title>Robot Check</title><body></body></html>", status: 200, kind: "home" }).blocked, true);
  assert.equal(
    detectBlock({ html: "<html><title>Sorry! Something went wrong!</title></html>", status: 200, kind: "product" }).blocked,
    true,
  );
  assert.equal(detectBlock({ html: searchHtml, status: 503, kind: "search" }).blocked, true);
  assert.equal(detectBlock({ html: "<html><title>Amazon</title><body>nothing</body></html>", status: 200, kind: "search" }).blocked, true);
});

test("a blocked search pauses, then retries the same URL after a normal search page returns", async () => {
  const control = createJobControl();
  control.start();
  const pacer = createPacer({ minDelay: 1500, maxDelay: 4000, sleepFn: async () => {} });
  const logs = [];
  const opened = [];
  let searchHits = 0;
  const client = createAmazonClient({
    pacer,
    control,
    pollMs: 5,
    resumeNoticeMs: 0,
    log: (_level, message) => logs.push(message),
    openTab: async (url) => opened.push(url),
    fetchImpl: async (url) => {
      if (url.includes("k=probe")) return response({ body: searchHtml, url });
      searchHits += 1;
      if (searchHits <= 3) {
        return response({ status: 503, body: "<html><title>Robot Check</title>validateCaptcha</html>", url });
      }
      return response({ body: searchHtml, url });
    },
  });
  client.setProbeUrl("https://www.amazon.com/s?k=probe");
  const page = await client.fetchHtml("https://www.amazon.com/s?k=shelves&page=1", { kind: "search", paced: false });
  assert.match(page.html, /s-search-result/);
  assert.equal(pacer.multiplier, 2);
  assert.equal(opened.length, 3);
  assert.ok(logs.some((line) => line.includes("3 checks") && line.includes("3–8 seconds")));
});
