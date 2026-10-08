// history: past searches stay in chrome.storage.local on this device, newest first.
// Nothing is sent to a server.

export const HISTORY_LIMIT = 30;

const SHIPS = { fbm: "Seller ships", fba: "Amazon ships", any: "Any seller" };

function accountKey(account) {
  return account?.email ? String(account.email).trim().toLowerCase() : null;
}

export function historyEntry(run, account, savedAt = new Date().toISOString()) {
  return {
    id: run?.startedAt || savedAt,
    account: accountKey(account),
    savedAt,
    run,
  };
}

// The same search saved again replaces its old entry instead of adding a copy.
// Ids are ISO start times, so sorting them as text puts the newest first.
export function addToHistory(list, entry, limit = HISTORY_LIMIT) {
  return [entry, ...(list || []).filter((item) => item.id !== entry.id)]
    .sort((a, b) => (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0))
    .slice(0, limit);
}

// Entries saved before accounts were recorded are shown to everyone on this device.
export function historyForAccount(list, account) {
  const key = accountKey(account);
  return (list || []).filter((item) => !item.account || item.account === key);
}

export function runMatchCount(run) {
  return (run?.groups || []).reduce((total, group) => total + (group.matches?.length || 0), 0);
}

export function runKeywords(run) {
  if (Array.isArray(run?.keywords) && run.keywords.length) return run.keywords;
  return (run?.groups || []).map((group) => group.keyword);
}

// "Oct 8, 4:20 PM" this year, "Dec 30, 2025, 4:20 PM" for older searches.
export function formatRunDate(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Short filter summary, for example "$20–$40 · ★ 4.5+ · 100+ reviews · Seller ships".
export function describeFilters(filters = {}) {
  const parts = [];
  if (Number.isFinite(filters.minPrice) && Number.isFinite(filters.maxPrice)) parts.push(`$${filters.minPrice}–$${filters.maxPrice}`);
  if (Number.isFinite(filters.minRating) && filters.minRating > 0) parts.push(`★ ${filters.minRating}+`);
  if (Number.isFinite(filters.minReviews) && filters.minReviews > 0) {
    parts.push(`${filters.minReviews.toLocaleString("en-US")}+ reviews`);
  }
  if (SHIPS[filters.shipsFrom]) parts.push(SHIPS[filters.shipsFrom]);
  return parts;
}
