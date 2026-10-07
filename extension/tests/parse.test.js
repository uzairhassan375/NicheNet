import test from "node:test";
import assert from "node:assert/strict";
import "./dom-setup.js";
import { buildSearchUrl } from "../src/amazonConfig.js";
import {
  classifyFulfillment,
  extractSellerName,
  isDuplicateVariant,
  parseFirstNumber,
  parsePrice,
  parseProductDocument,
  parseReviewCount,
  parseSearchPage,
  textContainsZip,
} from "../src/parse.js";
import { parseHtml } from "../src/parse.js";
import { productResultPage, searchResultsPage } from "./fixtures.js";
import { NOTE_PRICE, NOTE_REVIEWS, buildMatch } from "../src/productChecker.js";

test("rating keeps only the first number", () => {
  assert.equal(parseFirstNumber("4.8 out of 5 stars"), 4.8);
  assert.notEqual(parseFirstNumber("4.8 out of 5 stars"), 4.85);
  assert.equal(parseFirstNumber("5 out of 5 stars"), 5);
});

test("review counts understand K and commas", () => {
  assert.equal(parseReviewCount("(1.2K)"), 1200);
  assert.equal(parseReviewCount("(219)"), 219);
  assert.equal(parseReviewCount("(1,234)"), 1234);
  assert.equal(parseReviewCount("12K"), 12000);
  assert.equal(parseReviewCount("no reviews"), null);
});

test("prices ignore commas and currency symbols", () => {
  assert.equal(parsePrice("$24.99"), 24.99);
  assert.equal(parsePrice("$1,299.00"), 1299);
});

test("seller names collapse Amazon's duplicated label", () => {
  assert.equal(extractSellerName("Tayfus Tayfus Sold by Tayfus"), "Tayfus");
  assert.equal(extractSellerName("Shipper / Seller Tayfus"), "Tayfus");
  assert.equal(extractSellerName("Shipper / Seller Tayfus Tayfus Sold by Tayfus"), "Tayfus");
  assert.equal(extractSellerName("Acme Store Acme Store"), "Acme Store");
  assert.equal(extractSellerName("Sold by Tayfus"), "Tayfus");
  assert.equal(extractSellerName("Amazon.com"), "Amazon.com");
});

test("fulfillment: seller ships when Ships from is missing and the label is Shipper / Seller", () => {
  const result = classifyFulfillment({
    shipsFromPresent: false,
    shipsFrom: "",
    soldByText: "Shipper / Seller Tayfus Tayfus Sold by Tayfus",
    merchantInfo: "",
  });
  assert.equal(result.fulfillment, "fbm");
  assert.equal(result.sellerName, "Tayfus");
  assert.equal(result.sellerColumn || "", "");
});

test("fulfillment: a separate non-Amazon Ships from value is seller fulfilled", () => {
  const result = classifyFulfillment({
    shipsFromPresent: true,
    shipsFrom: "Warehouse Direct Warehouse Direct",
    soldByText: "Sold by Warehouse Direct",
    merchantInfo: "",
  });
  assert.equal(result.fulfillment, "fbm");
  assert.equal(result.sellerName, "Warehouse Direct");
});

test("fulfillment: Amazon in Ships from is FBA even if a third party sells it", () => {
  const result = classifyFulfillment({
    shipsFromPresent: true,
    shipsFrom: "Amazon",
    soldByText: "Sold by Acme Co",
    merchantInfo: "",
  });
  assert.equal(result.fulfillment, "fba");
  assert.equal(result.sellerName, "Acme Co");
});

test("fulfillment: Fulfilled by Amazon and Amazon-named sellers count as Amazon", () => {
  const legacy = classifyFulfillment({
    shipsFromPresent: false,
    shipsFrom: "",
    soldByText: "",
    merchantInfo: "Sold by Acme and Fulfilled by Amazon.",
  });
  assert.equal(legacy.fulfillment, "fba");
  const resale = classifyFulfillment({
    shipsFromPresent: false,
    shipsFrom: "",
    soldByText: "Shipper / Seller Amazon Resale",
    merchantInfo: "",
  });
  assert.equal(resale.fulfillment, "fba");
});

test("search cards skip a naive rating parse and ignore sponsored markup only when labeled", () => {
  const doc = parseHtml(
    searchResultsPage([
      {
        asin: "B0GOOD0001",
        title: "Wooden floating shelves",
        rating: "4.8",
        reviewsLabel: "1.2K",
        price: "$24.00",
      },
    ]),
  );
  const [card] = parseSearchPage(doc);
  assert.equal(card.rating, 4.8);
  assert.equal(card.reviews, 1200);
  assert.equal(card.searchPrice, 24);
  assert.equal(card.sponsored, false);
});

test("product page reads the seller-shipped merchant box", () => {
  const doc = parseHtml(
    productResultPage({
      price: "$32.50",
      rating: "4.9",
      reviews: "219",
      merchant: "<span>Shipper / Seller</span> <span>Tayfus Tayfus Sold by Tayfus</span>",
    }),
  );
  const product = parseProductDocument(doc);
  assert.equal(product.price, 32.5);
  assert.equal(product.rating, 4.9);
  assert.equal(product.reviews, 219);
  assert.equal(product.fulfillment, "fbm");
  assert.equal(product.sellerName, "Tayfus");
  assert.equal(product.sellerColumn, "Seller ships it · Tayfus");
});

test("notes flag reviews far from the target and a changed product-page price", () => {
  const filters = {
    minPrice: 20,
    maxPrice: 40,
    minRating: 4.5,
    minReviews: 100,
    targetReviews: 200,
    shipsFrom: "fbm",
  };
  const card = { asin: "B0GOOD0001", title: "Shelf", rating: 4.8, reviews: 400, searchPrice: 22 };
  const product = {
    price: 28,
    rating: 4.8,
    reviews: 400,
    fulfillment: "fbm",
    sellerName: "Tayfus",
    sellerColumn: "Seller ships it · Tayfus",
  };
  const decision = buildMatch(card, product, filters);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.match.notes, [NOTE_REVIEWS, NOTE_PRICE]);
});

test("similar titles from the same seller with the same review count are one product", () => {
  const existing = [{ title: "Wooden Floating Shelves Walnut", sellerName: "Tayfus", reviews: 180 }];
  assert.equal(
    isDuplicateVariant(existing, {
      title: "Wooden Floating Shelves Walnut Large",
      sellerName: "Tayfus",
      reviews: 180,
    }),
    true,
  );
  assert.equal(
    isDuplicateVariant(existing, {
      title: "Wooden jewelry box",
      sellerName: "Tayfus",
      reviews: 180,
    }),
    false,
  );
});

test("search url uses the price filter in cents", () => {
  const url = new URL(buildSearchUrl("wooden floating shelves", 2, 20, 40));
  assert.equal(url.origin + url.pathname, "https://www.amazon.com/s");
  assert.equal(url.searchParams.get("k"), "wooden floating shelves");
  assert.equal(url.searchParams.get("rh"), "p_36:2000-4000");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("i"), null);
  const handmade = new URL(buildSearchUrl("wooden serving tray", 1, 20, 100, undefined, true));
  assert.equal(handmade.searchParams.get("i"), "handmade");
  assert.equal(handmade.searchParams.get("rh"), "p_36:2000-10000");
});

test("delivery text matches the ZIP with or without a city", () => {
  assert.equal(textContainsZip("New York 10001", "10001"), true);
  assert.equal(textContainsZip("Deliver to Pakistan", "10001"), false);
});
