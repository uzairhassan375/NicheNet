import { buildSearchUrl } from "./amazonConfig.js";
import { parseSearchPage } from "./parse.js";
import { StoppedError } from "./jobControl.js";
import {
  buildMatch,
  checkProduct,
  isDuplicateVariant,
  searchFiltersPass,
  sortMatches,
} from "./productChecker.js";

export function formatProgressLine({ keywordIndex, keywordCount, page, checked, matches, section }) {
  const where = section ? `${section} page ${page}` : `page ${page}`;
  return `Keyword ${keywordIndex}/${keywordCount}, ${where}, checked ${checked} products, ${matches} matches found`;
}

export function summaryLine(found, checked) {
  return `${found} found from ${checked} products checked`;
}

async function inspectCandidate({ item, client, filters, matches, log }) {
  let product;
  try {
    product = await checkProduct(item, client, log);
  } catch (error) {
    if (error instanceof StoppedError || error.name === "StoppedError") throw error;
    log("error", `Product "${item.title || "untitled"}" failed: ${error.message}`);
    return null;
  }
  const decision = buildMatch(item, product, filters);
  if (!decision.ok) {
    log("info", `Skipped "${item.title || "untitled"}": ${decision.reason}.`);
    return null;
  }
  if (matches.length >= filters.resultsWanted) return null;
  if (isDuplicateVariant(matches, decision.match)) {
    log("info", `Skipped "${item.title || "untitled"}": same seller, reviews, and a very similar title.`);
    return null;
  }
  return decision.match;
}

/**
 * One keyword at a time. Two workers share the result list so at most two
 * product pages are opened at once (the pacer enforces the same cap).
 */
export async function runSearch({ filters, keywords, client, control, log, onProgress, onGroup, workers = 2 }) {
  const groups = keywords.map((keyword) => ({
    keyword,
    checked: 0,
    status: "pending",
    matches: [],
  }));

  try {
  for (let index = 0; index < keywords.length; index += 1) {
    await control.checkpoint();
    const keyword = keywords[index];
    const group = groups[index];
    group.status = "running";
    const seen = new Set();
    onGroup(groups);

    const catalogs = filters.handmade
      ? [{ handmade: false, section: "" }, { handmade: true, section: "Handmade" }]
      : [{ handmade: false, section: "" }];
    for (const catalog of catalogs) {
    if (group.matches.length >= filters.resultsWanted) break;
    for (let page = 1; page <= filters.maxPages && group.matches.length < filters.resultsWanted; page += 1) {
      await control.checkpoint();
      const report = () => {
        onProgress({
          keywordIndex: index + 1,
          keywordCount: keywords.length,
          keyword,
          page,
          section: catalog.section,
          checked: group.checked,
          matches: group.matches.length,
        });
      };
      report();
      const url = buildSearchUrl(keyword, page, filters.minPrice, filters.maxPrice, undefined, catalog.handmade);
      client.setProbeUrl?.(url);
      let parsed = [];
      try {
        const result = await client.fetchHtml(url, { kind: "search", paced: true });
        if (result.status >= 400) {
          log("error", `Search page ${page} for "${keyword}" returned HTTP ${result.status}.`);
          continue;
        }
        parsed = parseSearchPage(result.doc);
      } catch (error) {
        if (error instanceof StoppedError || error.name === "StoppedError") throw error;
        log("error", `Search page ${page} for "${keyword}" failed: ${error.message}`);
        continue;
      }

      const sponsored = parsed.filter((item) => item.sponsored);
      const queue = parsed.filter((item) => item.asin && !item.sponsored);
      const place = catalog.section ? `${catalog.section} page ${page}` : `page ${page}`;
      log("info", `"${keyword}" ${place}: ${queue.length} results, ${sponsored.length} sponsored skipped.`);
      if (queue.length === 0) {
        log("info", `"${keyword}" ${place} has no products. Later pages are skipped.`);
        break;
      }

      let cursor = 0;
      let stopError = null;
      const worker = async () => {
        try {
          while (cursor < queue.length && group.matches.length < filters.resultsWanted) {
            await control.checkpoint();
            if (cursor >= queue.length || group.matches.length >= filters.resultsWanted) return;
            const item = queue[cursor];
            cursor += 1;
            if (!item?.asin || seen.has(item.asin)) continue;
            seen.add(item.asin);
            group.checked += 1;
            report();
            if (!searchFiltersPass(item, filters)) continue;
            const match = await inspectCandidate({
              item,
              client,
              filters,
              matches: group.matches,
              log,
            });
            if (!match) continue;
            if (group.matches.length >= filters.resultsWanted) return;
            if (isDuplicateVariant(group.matches, match)) continue;
            group.matches.push(match);
            sortMatches(group.matches, filters.targetReviews);
            onGroup(groups);
            report();
          }
        } catch (error) {
          if (error instanceof StoppedError || error.name === "StoppedError") {
            stopError = error;
            return;
          }
          throw error;
        }
      };

      const workerCount = Math.max(1, Math.min(6, Number(workers) || 2));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (stopError) throw stopError;
    }
    }

    group.status = "done";
    onGroup(groups);
    log("info", `"${keyword}": ${summaryLine(group.matches.length, group.checked)}.`);
  }
  } catch (error) {
    if (error instanceof StoppedError || error.name === "StoppedError") {
      for (const group of groups) {
        if (group.status === "running" || group.status === "pending") group.status = "stopped";
      }
      onGroup(groups);
    }
    throw error;
  }

  return groups;
}

export { StoppedError };
