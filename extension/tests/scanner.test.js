import test from "node:test";
import assert from "node:assert/strict";
import "./dom-setup.js";
import { parseHtml } from "../src/parse.js";
import { createJobControl } from "../src/jobControl.js";
import { formatProgressLine, runSearch } from "../src/scanner.js";
import { FILTER_DEFAULTS } from "../src/filters.js";
import { productResultPage, searchResultsPage, SAMPLE_SEARCH } from "./fixtures.js";

function filters(overrides = {}) {
  return { ...FILTER_DEFAULTS, keywords: "wooden floating shelves", ...overrides };
}

function clientFor(urls) {
  return {
    setProbeUrl() {},
    async fetchHtml(url) {
      urls.push(url);
      const html = htmlFor(url);
      return { status: 200, url, html, doc: parseHtml(html), headers: { get() { return ""; } } };
    },
  };
}

function htmlFor(url) {
  if (url.includes("/dp/B0FBA00001")) {
    return productResultPage({
      shipsFrom: "Amazon",
      merchant: "Sold by Acme Co",
      price: "$30.00",
      reviews: "200",
      rating: "4.9",
    });
  }
  if (url.includes("/dp/B0FBM00002")) {
    return productResultPage({
      merchant: "Shipper / Seller OtherShop",
      price: "$28.00",
      reviews: "400",
      rating: "4.7",
    });
  }
  if (url.includes("/dp/B0FBM00003")) {
    return productResultPage({
      merchant: "Shipper / Seller Tayfus",
      price: "$26.00",
      reviews: "180",
      rating: "4.8",
    });
  }
  if (url.includes("/dp/")) {
    return productResultPage({ price: "$25.00", reviews: "180", rating: "4.8" });
  }
  return searchResultsPage(SAMPLE_SEARCH);
}

test("progress line matches the live status sentence", () => {
  assert.equal(
    formatProgressLine({ keywordIndex: 2, keywordCount: 3, page: 4, checked: 87, matches: 6 }),
    "Keyword 2/3, page 4, checked 87 products, 6 matches found",
  );
});

test("scanner keeps seller-shipped matches, including sponsored ones, and drops FBA and duplicate variants", async () => {
  const urls = [];
  const control = createJobControl();
  control.start();
  const groups = [];
  await runSearch({
    filters: filters({ resultsWanted: 10, maxPages: 1 }),
    keywords: ["wooden floating shelves"],
    client: clientFor(urls),
    control,
    log() {},
    onProgress() {},
    onGroup(next) {
      groups.splice(0, groups.length, ...next);
    },
  });
  const group = groups[0];
  assert.equal(group.status, "done");
  assert.deepEqual(
    group.matches.map((match) => match.asin),
    ["B0SPONSOR1", "B0FBM00001", "B0FBM00002"],
  );
  assert.equal(group.matches[0].sellerColumn, "Seller ships it · Tayfus");
  assert.equal(group.matches[2].sellerColumn, "Seller ships it · OtherShop");
  assert.ok(group.matches[2].notes.includes("Reviews far from target"));
  assert.ok(group.matches[2].notes.includes("Price re-checked on product page"));
  assert.equal(group.matches[0].notes.length, 0);
  assert.equal(`${group.matches.length} found from ${group.checked} products checked`, "3 found from 6 products checked");
  assert.equal(urls.some((url) => url.includes("B0SPONSOR1")), true);
});

test("stop keeps the matches already found", async () => {
  const control = createJobControl();
  control.start();
  let groups = [];
  const client = {
    setProbeUrl() {},
    async fetchHtml(url) {
      if (url.includes("/dp/")) control.stop();
      const html = url.includes("/dp/")
        ? productResultPage()
        : searchResultsPage([SAMPLE_SEARCH[2]]);
      return { status: 200, url, html, doc: parseHtml(html), headers: { get() { return ""; } } };
    },
  };
  await assert.rejects(
    () =>
      runSearch({
        filters: filters(),
        keywords: ["wooden floating shelves"],
        client,
        control,
        log() {},
        onProgress() {},
        onGroup(next) {
          groups = next;
        },
      }),
    { name: "StoppedError" },
  );
  assert.equal(groups[0].status, "stopped");
});
