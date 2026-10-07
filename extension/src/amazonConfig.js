/**
 * All Amazon-specific selectors and URL patterns live here.
 * When the site changes its HTML, update the fallback lists (first match wins).
 *
 * The loaded extension is allowed to talk to www.amazon.com only.
 * To add another marketplace later (amazon.co.uk, amazon.ae, …):
 *   1. Copy the US entry below and change origin, cookieDomain, and currency.
 *   2. Add a matching entry to host_permissions in manifest.json.
 *   3. Point ACTIVE_MARKETPLACE at the new id.
 * Selectors are shared until a marketplace needs its own list.
 */

export const MARKETPLACES = {
  US: {
    id: "US",
    origin: "https://www.amazon.com",
    cookieDomain: ".amazon.com",
    currency: "USD",
    currencyCookie: "i18n-prefs",
    languageCookie: "lc-main",
    language: "en_US",
    productPath: "/dp/",
    defaultZip: "10001",
  },
};

export const ACTIVE_MARKETPLACE = "US";

export const amazonConfig = {
  marketplace: MARKETPLACES[ACTIVE_MARKETPLACE],

  search: {
    // Ordered fallbacks. The first selector that matches is used.
    resultItem: ['div[data-component-type="s-search-result"]'],
    sponsored: [".puis-sponsored-label-text", ".s-sponsored-label-text"],
    title: ["h2"],
    rating: ['[aria-label*="out of 5"]', ".a-icon-alt"],
    reviewCount: ['a[href*="customerReviews"] span'],
    searchPrice: [".a-price:not(.a-text-price) .a-offscreen", ".a-price .a-offscreen"],
    // A real search page has one of these. A block page has none of them.
    pageReady: [
      '[data-component-type="s-search-result"]',
      ".s-main-slot",
      "#search",
      ".s-no-outline",
    ],
  },

  product: {
    title: ["#productTitle", "#title"],
    price: [
      "#corePrice_feature_div .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
    ],
    rating: ["#acrPopover .a-icon-alt", "#acrPopover", '[data-hook="rating-out-of-text"]'],
    reviews: ["#acrCustomerReviewText", '[data-hook="total-review-count"]'],
    // Value only. If none of these exist, the Ships-from field is missing.
    shipsFrom: [
      "#fulfillerInfoFeature_feature_div .offer-display-feature-text",
      '[offer-display-feature-name="desktop-fulfiller-info"] .offer-display-feature-text',
    ],
    // Whole merchant box so the "Shipper / Seller" label is included.
    soldBy: [
      "#merchantInfoFeature_feature_div",
      '[offer-display-feature-name="desktop-merchant-info"]',
    ],
    merchantInfo: ["#merchant-info"],
  },

  delivery: {
    zipSelectors: ["#glow-ingress-line2"],
    zipLine1Selectors: ["#glow-ingress-line1"],
    csrfPaths: [
      "/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Gateway&storeContext=NoStoreName&actionSource=desktop-modal",
    ],
    // Amazon's Deliver-to popover posts here with the anti-csrftoken-a2z token.
    jsonChangePaths: ["/portal-migration/hz/glow/address-change?actionSource=glow"],
    formChangePaths: ["/gp/delivery/ajax/address-change.html"],
    tokenSelectors: ["#glowValidationToken", 'input[name="glow-validation-token"]', 'meta[name="anti-csrftoken-a2z"]'],
  },

  captcha: {
    htmlSnippets: [
      "validateCaptcha",
      "Enter the characters you see below",
      "Click the button below to continue shopping",
    ],
    titlePatterns: [/robot check/i],
    errorTitlePatterns: [/sorry!\s*something went wrong/i],
    urlPatterns: [/validateCaptcha/i, /opfcaptcha/i],
    blockStatuses: [503],
  },
};

export function buildSearchUrl(keyword, page, minPrice, maxPrice, marketplace = amazonConfig.marketplace, handmade = false) {
  const minCents = Math.round(Number(minPrice) * 100);
  const maxCents = Math.round(Number(maxPrice) * 100);
  const url = new URL("/s", marketplace.origin);
  url.searchParams.set("k", keyword);
  url.searchParams.set("rh", `p_36:${minCents}-${maxCents}`);
  url.searchParams.set("page", String(page));
  if (handmade) url.searchParams.set("i", "handmade");
  return url.toString();
}

export function buildProductUrl(asin, marketplace = amazonConfig.marketplace) {
  return `${marketplace.origin}${marketplace.productPath}${encodeURIComponent(asin)}`;
}

export function absoluteUrl(path, marketplace = amazonConfig.marketplace) {
  return new URL(path, marketplace.origin).toString();
}
