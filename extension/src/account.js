import { accountConfig } from "./accountConfig.js";

const SESSION_KEY = "accountSession";

export async function rpc(name, args) {
  if (!accountConfig.supabaseUrl || !accountConfig.supabaseAnonKey) {
    return { ok: false, error: "Account sign-in is not configured in this extension yet." };
  }
  let response;
  try {
    response = await fetch(`${accountConfig.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: accountConfig.supabaseAnonKey,
        Authorization: `Bearer ${accountConfig.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    return { ok: false, error: "Could not reach the account server. Check your connection and try again." };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Account server returned HTTP ${response.status}.`;
    if (response.status === 401 || /invalid api key|no api key/i.test(message)) {
      return { ok: false, error: "Paste the Supabase anon key into extension/src/accountConfig.js, then reload the extension." };
    }
    return { ok: false, error: message };
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return { ok: false, error: "Unexpected account server response." };
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clampFiltersToAccount(filters, account) {
  const next = { ...filters };
  const maxPages = finiteNumber(account?.max_pages);
  const maxResults = finiteNumber(account?.max_results);
  const priceMin = finiteNumber(account?.price_min);
  const priceMax = finiteNumber(account?.price_max);
  const minRating = finiteNumber(account?.min_rating);
  const minReviews = finiteNumber(account?.min_reviews);
  const targetReviews = finiteNumber(account?.target_reviews);
  if (maxPages != null) next.maxPages = Math.min(next.maxPages, maxPages);
  if (maxResults != null) next.resultsWanted = Math.min(next.resultsWanted, maxResults);
  if (priceMin != null) next.minPrice = Math.max(next.minPrice, priceMin);
  if (priceMax != null) next.maxPrice = Math.min(next.maxPrice, priceMax);
  if (next.minPrice > next.maxPrice) {
    if (priceMax == null || next.minPrice <= priceMax) next.maxPrice = next.minPrice;
    else next.minPrice = next.maxPrice;
  }
  if (minRating != null) next.minRating = Math.max(next.minRating, minRating);
  if (minReviews != null) next.minReviews = Math.max(next.minReviews, minReviews);
  if (targetReviews != null) next.targetReviews = targetReviews;
  if (account?.ships_from) next.shipsFrom = account.ships_from;
  if (account?.deliver_zip) next.zip = String(account.deliver_zip);
  return next;
}

export async function loginAccount(email, password) {
  const result = await rpc("user_login", { p_email: email.trim(), p_password: password });
  if (!result.ok) {
    const error = new Error(result.error || "Sign-in failed.");
    error.code = result.code;
    throw error;
  }
  await chrome.storage.local.set({ [SESSION_KEY]: { token: result.token } });
  return result;
}

export async function restoreAccount() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const token = stored[SESSION_KEY]?.token;
  if (!token) return null;
  const result = await rpc("session_status", { p_token: token });
  if (!result.ok) {
    await chrome.storage.local.remove(SESSION_KEY);
    return null;
  }
  return result;
}

export async function logoutAccount() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const token = stored[SESSION_KEY]?.token;
  await chrome.storage.local.remove(SESSION_KEY);
  if (token) await rpc("sign_out", { p_token: token });
}

export function recordActivity(token, action, detail) {
  if (!token) return;
  rpc("record_activity", {
    p_token: token,
    p_action: String(action || "info").slice(0, 80),
    p_detail: String(detail || "").slice(0, 2000),
  }).catch(() => {});
}

export async function consumeSearch(token, filters) {
  return rpc("consume_search", {
    p_token: token,
    p_pages: filters.maxPages,
    p_results: filters.resultsWanted,
    p_min_price: filters.minPrice,
    p_max_price: filters.maxPrice,
    p_min_rating: filters.minRating,
    p_min_reviews: filters.minReviews,
    p_ships: filters.shipsFrom,
    p_zip: filters.zip,
  });
}
