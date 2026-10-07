import { amazonConfig } from "./amazonConfig.js";
import { parseHtml } from "./parse.js";

function pageTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * Block pages: CAPTCHA, robot check, Amazon's error page, HTTP 503,
 * or a search response that is missing the search layout entirely.
 * A normal "no results" search page still has #search or .s-main-slot.
 */
export function detectBlock({ html, status, url, kind, selectors = amazonConfig }) {
  const body = String(html || "");
  const title = pageTitle(body);
  const finalUrl = String(url || "");
  if (selectors.captcha.blockStatuses.includes(Number(status))) {
    return { blocked: true, reason: `HTTP ${status}` };
  }
  if (selectors.captcha.htmlSnippets.some((snippet) => body.includes(snippet))) {
    return { blocked: true, reason: "CAPTCHA" };
  }
  if (selectors.captcha.titlePatterns.some((pattern) => pattern.test(title))) {
    return { blocked: true, reason: "Robot Check" };
  }
  if (selectors.captcha.errorTitlePatterns.some((pattern) => pattern.test(title))) {
    return { blocked: true, reason: "Error page" };
  }
  if (selectors.captcha.urlPatterns.some((pattern) => pattern.test(finalUrl))) {
    return { blocked: true, reason: "CAPTCHA redirect" };
  }
  if (kind === "search") {
    const doc = parseHtml(body);
    const ready = selectors.search.pageReady.some((selector) => doc.querySelector(selector));
    if (!ready) return { blocked: true, reason: "Search page missing results" };
  }
  return { blocked: false, reason: "" };
}
