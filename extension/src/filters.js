export const FILTER_DEFAULTS = {
  keywords: "",
  minPrice: 20,
  maxPrice: 40,
  minRating: 4.5,
  minReviews: 100,
  targetReviews: 200,
  shipsFrom: "fbm",
  resultsWanted: 10,
  maxPages: 10,
  zip: "10001",
  speed: "recommended",
  handmade: true,
};

export const SPEED_OPTIONS = [
  {
    value: "recommended",
    label: "Recommended — steadier, fewer Amazon checks",
    minDelay: 1500,
    maxDelay: 4000,
    concurrency: 2,
    note: "Recommended is the usual choice: about 1.5–4 seconds between requests, two at a time, and fewer human checks. Fast is about twice as quick, but Amazon is more likely to stop the search and ask you to prove you are human. You can switch back before the next search.",
  },
  {
    value: "fast",
    label: "Fast — about twice as fast; Amazon may ask for a human check",
    minDelay: 600,
    maxDelay: 1500,
    concurrency: 3,
    note: "Fast is about twice as quick: about 0.6–1.5 seconds, three requests at a time. Amazon is more likely to stop the search and ask you to prove you are human. The run pauses until you solve that check. Switch back to Recommended if that starts happening.",
  },
  {
    value: "gentle",
    label: "Gentle — slower, least likely to be interrupted",
    minDelay: 3000,
    maxDelay: 6000,
    concurrency: 1,
    note: "Gentle waits about 3–6 seconds and runs one request at a time. This is the least likely to be interrupted. Recommended is the usual choice.",
  },
];

export function speedOption(value) {
  return SPEED_OPTIONS.find((option) => option.value === value) || SPEED_OPTIONS[0];
}

export const SHIP_OPTIONS = [
  { value: "fbm", label: "Not Amazon (seller ships it)" },
  { value: "fba", label: "Amazon only (FBA)" },
  { value: "any", label: "Any" },
];

export function shipLabel(value) {
  return SHIP_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function parseKeywords(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function numberOrNaN(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() === "") return Number.NaN;
  return Number(value);
}

export function normalizeFilters(input) {
  const source = { ...FILTER_DEFAULTS, ...(input || {}) };
  return {
    keywords: String(source.keywords ?? ""),
    minPrice: numberOrNaN(source.minPrice),
    maxPrice: numberOrNaN(source.maxPrice),
    minRating: numberOrNaN(source.minRating),
    minReviews: numberOrNaN(source.minReviews),
    targetReviews: numberOrNaN(source.targetReviews),
    shipsFrom: source.shipsFrom,
    resultsWanted: numberOrNaN(source.resultsWanted),
    maxPages: numberOrNaN(source.maxPages),
    zip: String(source.zip || "").trim(),
    speed: speedOption(source.speed).value,
    handmade: source.handmade === true || source.handmade === "true" || source.handmade === "on",
  };
}

export function validateFilters(input) {
  const filters = normalizeFilters(input);
  const errors = [];
  const keywords = parseKeywords(filters.keywords);
  if (!keywords.length) errors.push("Enter at least one product name.");
  if (!Number.isFinite(filters.minPrice) || filters.minPrice < 0) errors.push("Enter a minimum price of 0 or more.");
  if (!Number.isFinite(filters.maxPrice) || filters.maxPrice < filters.minPrice) {
    errors.push("Maximum price must be at least the minimum price.");
  }
  if (!Number.isFinite(filters.minRating) || filters.minRating < 0 || filters.minRating > 5) {
    errors.push("Minimum rating must be between 0 and 5.");
  }
  if (!Number.isFinite(filters.minReviews) || filters.minReviews < 0) errors.push("Enter a minimum review count of 0 or more.");
  if (!Number.isFinite(filters.targetReviews) || filters.targetReviews < 0) {
    errors.push("Target reviews must be 0 or more.");
  }
  if (!["fbm", "fba", "any"].includes(filters.shipsFrom)) errors.push("Choose who ships the product.");
  if (!Number.isInteger(filters.resultsWanted) || filters.resultsWanted < 1 || filters.resultsWanted > 100) {
    errors.push("Results wanted must be a whole number from 1 to 100.");
  }
  if (!Number.isInteger(filters.maxPages) || filters.maxPages < 1) {
    errors.push("Max pages must be a whole number of 1 or more.");
  }
  if (!filters.zip || filters.zip.length > 12) errors.push("Enter a ZIP or postcode.");
  return { ok: errors.length === 0, errors, filters, keywords };
}
