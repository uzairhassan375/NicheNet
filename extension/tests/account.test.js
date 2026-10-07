import test from "node:test";
import assert from "node:assert/strict";
import { clampFiltersToAccount } from "../src/account.js";
import { FILTER_DEFAULTS } from "../src/filters.js";

test("account caps lower the page and result limits and leave the rest", () => {
  const filters = { ...FILTER_DEFAULTS, maxPages: 40, resultsWanted: 10 };
  const capped = clampFiltersToAccount(filters, { max_pages: 3, max_results: 4 });
  assert.equal(capped.maxPages, 3);
  assert.equal(capped.resultsWanted, 4);
  assert.equal(capped.minPrice, 20);
  const open = clampFiltersToAccount(filters, { max_pages: null, max_results: null });
  assert.equal(open.maxPages, 40);
  assert.equal(open.resultsWanted, 10);
  const priced = clampFiltersToAccount(
    { ...FILTER_DEFAULTS, minPrice: 10, maxPrice: 80, minRating: 3, minReviews: 10, shipsFrom: "any", zip: "90210" },
    { price_min: 25, price_max: 40, min_rating: 4.5, min_reviews: 100, ships_from: "fbm", deliver_zip: "10001", target_reviews: 200 },
  );
  assert.equal(priced.minPrice, 25);
  assert.equal(priced.maxPrice, 40);
  assert.equal(priced.minRating, 4.5);
  assert.equal(priced.minReviews, 100);
  assert.equal(priced.shipsFrom, "fbm");
  assert.equal(priced.zip, "10001");
  assert.equal(priced.targetReviews, 200);
});
