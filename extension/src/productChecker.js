import { amazonConfig, buildProductUrl } from "./amazonConfig.js";
import {
  isDuplicateVariant,
  parseProductDocument,
  passesShipsFilter,
} from "./parse.js";

export const NOTE_REVIEWS = "Reviews far from target";
export const NOTE_PRICE = "Price re-checked on product page";

export function searchFiltersPass(item, filters) {
  if (item.rating == null || item.reviews == null) return false;
  if (item.rating < filters.minRating) return false;
  if (item.reviews < filters.minReviews) return false;
  return true;
}

export function buildMatch(card, product, filters) {
  const rating = product.rating ?? card.rating;
  const reviews = product.reviews ?? card.reviews;
  if (product.price == null) return { ok: false, reason: "no price on the product page" };
  if (product.price < filters.minPrice || product.price > filters.maxPrice) {
    return { ok: false, reason: `price $${product.price.toFixed(2)} is outside the range` };
  }
  if (rating == null || rating < filters.minRating) return { ok: false, reason: "rating is below the minimum" };
  if (reviews == null || reviews < filters.minReviews) {
    return { ok: false, reason: "review count is below the minimum" };
  }
  if (!passesShipsFilter(product.fulfillment, filters.shipsFrom)) {
    return { ok: false, reason: `ships filter excluded ${product.sellerColumn}` };
  }
  const notes = [];
  if (filters.targetReviews > 0) {
    const low = filters.targetReviews * 0.5;
    const high = filters.targetReviews * 1.5;
    if (reviews < low || reviews > high) notes.push(NOTE_REVIEWS);
  }
  if (card.searchPrice != null && Math.round(card.searchPrice * 100) !== Math.round(product.price * 100)) {
    notes.push(NOTE_PRICE);
  }
  return {
    ok: true,
    match: {
      asin: card.asin,
      title: card.title || product.title || card.asin,
      url: buildProductUrl(card.asin),
      price: product.price,
      searchPrice: card.searchPrice ?? null,
      rating,
      reviews,
      fulfillment: product.fulfillment,
      sellerName: product.sellerName,
      sellerColumn: product.sellerColumn,
      notes,
    },
  };
}

export function sortMatches(matches, targetReviews) {
  matches.sort((a, b) => {
    const left = Math.abs(a.reviews - targetReviews);
    const right = Math.abs(b.reviews - targetReviews);
    if (left !== right) return left - right;
    return b.rating - a.rating || a.title.localeCompare(b.title);
  });
  return matches;
}

export async function checkProduct(card, client, log) {
  const url = buildProductUrl(card.asin);
  let page;
  try {
    page = await client.fetchHtml(url, { kind: "product", paced: true });
  } catch (error) {
    throw error;
  }
  if (page.status >= 400) {
    const error = new Error(`HTTP ${page.status}`);
    error.skip = true;
    throw error;
  }
  const product = parseProductDocument(page.doc, amazonConfig);
  if (!product.sellerColumn) log("info", `"${card.title || "untitled"}" had no seller text.`);
  return product;
}

export { isDuplicateVariant };
