import { amazonConfig } from "./amazonConfig.js";

export function parseHtml(html) {
  return new DOMParser().parseFromString(String(html || ""), "text/html");
}

export function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function firstElement(root, selectors) {
  if (!root) return null;
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

export function firstText(root, selectors) {
  const element = firstElement(root, selectors);
  return normalizeSpace(element?.textContent || "");
}

/** First number only. "4.8 out of 5 stars" is 4.8, never 4.85 or 485. */
export function parseFirstNumber(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseReviewCount(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/[()]/g, "").replace(/,/g, "").trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!match) return null;
  let value = Number(match[1]);
  if (match[2]) value *= 1000;
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function parsePrice(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/,/g, "");
  const currency = text.match(/(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)/i);
  const match = currency || text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function isAsin(value) {
  return /^[A-Z0-9]{10}$/.test(value || "");
}

export function isAmazonName(name) {
  const value = normalizeSpace(name).toLowerCase();
  return value.startsWith("amazon");
}

export function collapseRepeatedPhrase(value) {
  let text = normalizeSpace(value);
  for (let guard = 0; text && guard < 6; guard += 1) {
    const parts = text.split(" ");
    let collapsed = "";
    for (let size = Math.floor(parts.length / 2); size >= 1; size -= 1) {
      if (parts.length % size !== 0) continue;
      const unit = parts.slice(0, size).join(" ");
      const times = parts.length / size;
      if (times < 2) continue;
      const same = Array.from({ length: times }, (_, index) => parts.slice(index * size, index * size + size).join(" "))
        .every((chunk) => chunk.toLowerCase() === unit.toLowerCase());
      if (same) {
        collapsed = unit;
        break;
      }
    }
    if (!collapsed) break;
    text = collapsed;
  }
  return text;
}

/** "Tayfus Tayfus Sold by Tayfus" and "Shipper / Seller Tayfus" both become "Tayfus". */
export function extractSellerName(raw) {
  let text = normalizeSpace(raw);
  if (!text) return "";
  text = text.replace(/shipper\s*\/\s*seller/gi, " ");
  text = normalizeSpace(text).replace(/\.$/, "");
  const soldBy = text.match(/^(.*?)\s*sold by\s+(.+)$/i);
  if (soldBy) {
    const left = collapseRepeatedPhrase(soldBy[1]);
    let right = collapseRepeatedPhrase(soldBy[2].replace(/\.$/, ""));
    right = right.split(/\s+and\s+/i)[0];
    right = collapseRepeatedPhrase(right);
    if (!left) return right;
    if (!right) return left;
    if (left.toLowerCase() === right.toLowerCase() || left.toLowerCase().includes(right.toLowerCase())) return right;
    return right;
  }
  text = text.replace(/^ships from\s+/i, "").replace(/^sold by\s+/i, "");
  return collapseRepeatedPhrase(text.replace(/\.$/, ""));
}

export function readRating(root, selectors) {
  if (!root) return null;
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      if (!/out of 5/i.test(label) && !selector.includes("a-icon-alt") && !selector.includes("rating")) continue;
      const rating = parseFirstNumber(label);
      if (rating != null && rating <= 5) return rating;
    }
  }
  return null;
}

export function readReviewCount(root, selectors) {
  if (!root) return null;
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const count = parseReviewCount(element.textContent);
      if (count != null) return count;
    }
  }
  return null;
}

export function readShipsFrom(root, selectors) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = normalizeSpace(element?.textContent || "");
    if (text) return { present: true, text };
  }
  return { present: false, text: "" };
}

/**
 * Seller ships it (FBM) when Ships from is missing and the merchant box says
 * "Shipper / Seller" for a non-Amazon seller, or when Ships from is present
 * and is not Amazon. Amazon ships it (FBA) when Ships from is Amazon, or the
 * legacy merchant line says "Fulfilled by Amazon".
 */
export function classifyFulfillment({ shipsFromPresent, shipsFrom, soldByText, merchantInfo }) {
  const blob = normalizeSpace(`${soldByText || ""} ${merchantInfo || ""}`);
  const sellerName = extractSellerName(soldByText) || extractSellerName(merchantInfo) || "";
  const shipsValue = shipsFromPresent ? extractSellerName(shipsFrom) || collapseRepeatedPhrase(shipsFrom) : "";
  const shipsIsAmazon = isAmazonName(shipsValue);
  const sellerIsAmazon = isAmazonName(sellerName);
  const fulfilledByAmazon = /fulfilled by amazon/i.test(blob);

  let fulfillment = "unknown";
  if (shipsFromPresent && shipsValue && !shipsIsAmazon) {
    fulfillment = "fbm";
  } else if (!shipsFromPresent && /shipper\s*\/\s*seller/i.test(soldByText || "") && sellerName && !sellerIsAmazon) {
    fulfillment = "fbm";
  } else if ((shipsFromPresent && shipsIsAmazon) || fulfilledByAmazon) {
    fulfillment = "fba";
  } else if (!shipsFromPresent && sellerIsAmazon) {
    fulfillment = "fba";
  }

  if (fulfillment === "unknown" && !shipsFromPresent) {
    const legacy = blob.match(/ships from and sold by\s+([^.]*)/i);
    if (legacy) {
      const name = extractSellerName(`Sold by ${legacy[1]}`);
      if (isAmazonName(name)) fulfillment = "fba";
      else if (name) fulfillment = "fbm";
    }
  }

  const displaySeller = sellerName || shipsValue;
  return {
    fulfillment,
    sellerName: displaySeller,
    shipsFrom: shipsValue,
  };
}

export function formatSellerColumn({ fulfillment, sellerName, shipsFrom }) {
  const seller = sellerName || shipsFrom || "";
  if (fulfillment === "fba") {
    if (seller && !isAmazonName(seller)) return `Amazon ships it · Sold by ${seller}`;
    return `Amazon ships it · ${seller || "Amazon.com"}`;
  }
  if (fulfillment === "fbm") return `Seller ships it · ${seller || "Seller"}`;
  return seller || "Unknown";
}

export function passesShipsFilter(fulfillment, filter) {
  if (filter === "any") return true;
  if (filter === "fbm") return fulfillment === "fbm";
  if (filter === "fba") return fulfillment === "fba";
  return false;
}

function normalizeTitle(title) {
  return normalizeSpace(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titlesAreSimilar(left, right) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 12 && longer.includes(shorter)) return true;
  const wordsA = new Set(a.split(" ").filter((word) => word.length > 1));
  const wordsB = new Set(b.split(" ").filter((word) => word.length > 1));
  if (!wordsA.size || !wordsB.size) return false;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  const union = wordsA.size + wordsB.size - shared;
  return union > 0 && shared / union >= 0.75;
}

export function isDuplicateVariant(existing, candidate) {
  const seller = normalizeSpace(candidate.sellerName).toLowerCase();
  return existing.some((item) => {
    return (
      normalizeSpace(item.sellerName).toLowerCase() === seller &&
      item.reviews === candidate.reviews &&
      titlesAreSimilar(item.title, candidate.title)
    );
  });
}

export function isSponsored(card, selectors) {
  return selectors.some((selector) => card.querySelector(selector));
}

export function parseSearchCard(card, config = amazonConfig) {
  const asin = (card.getAttribute("data-asin") || "").trim().toUpperCase();
  return {
    asin: isAsin(asin) ? asin : "",
    title: firstText(card, config.search.title),
    rating: readRating(card, config.search.rating),
    reviews: readReviewCount(card, config.search.reviewCount),
    searchPrice: parsePrice(firstText(card, config.search.searchPrice)),
    sponsored: isSponsored(card, config.search.sponsored),
  };
}

export function parseSearchPage(doc, config = amazonConfig) {
  const seen = new Set();
  const cards = [];
  for (const selector of config.search.resultItem) {
    for (const card of doc.querySelectorAll(selector)) {
      if (seen.has(card)) continue;
      seen.add(card);
      cards.push(parseSearchCard(card, config));
    }
  }
  return cards;
}

export function parseProductDocument(doc, config = amazonConfig) {
  const ships = readShipsFrom(doc, config.product.shipsFrom);
  const soldByText = firstText(doc, config.product.soldBy);
  const merchantInfo = firstText(doc, config.product.merchantInfo);
  const fulfillment = classifyFulfillment({
    shipsFromPresent: ships.present,
    shipsFrom: ships.text,
    soldByText,
    merchantInfo,
  });
  return {
    title: firstText(doc, config.product.title),
    price: parsePrice(firstText(doc, config.product.price)),
    rating: readRating(doc, config.product.rating),
    reviews: readReviewCount(doc, config.product.reviews),
    ...fulfillment,
    sellerColumn: formatSellerColumn(fulfillment),
    soldByText,
    merchantInfo,
  };
}

export function readDeliveryText(doc, config = amazonConfig) {
  const line2 = firstText(doc, config.delivery.zipSelectors);
  const line1 = firstText(doc, config.delivery.zipLine1Selectors);
  return { line1, line2, combined: normalizeSpace(`${line1} ${line2}`) };
}

export function textContainsZip(text, zip) {
  const raw = String(text || "").toLowerCase();
  const want = String(zip || "").trim().toLowerCase();
  if (!want) return false;
  if (raw.includes(want)) return true;
  return raw.replace(/\s+/g, "").includes(want.replace(/\s+/g, ""));
}

export function extractCsrfToken(html, headerToken) {
  if (headerToken && String(headerToken).trim()) return String(headerToken).trim();
  const doc = typeof html === "string" ? parseHtml(html) : html;
  const source = typeof html === "string" ? html : "";
  for (const selector of amazonConfig.delivery.tokenSelectors) {
    const element = doc.querySelector?.(selector);
    if (!element) continue;
    const value = selector.startsWith("meta")
      ? element.getAttribute("content")
      : element.getAttribute("value") || element.textContent;
    if (value && value.trim()) return value.trim();
  }
  const match = source.match(/anti-csrftoken-a2z["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{10,})/i);
  return match?.[1] || "";
}
