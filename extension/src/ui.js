import { describeFilters, formatRunDate, runKeywords, runMatchCount } from "./history.js";
import { NOTE_PRICE, NOTE_REVIEWS } from "./productChecker.js";
import { summaryLine } from "./scanner.js";

export function countMatches(run) {
  return (run?.groups || []).reduce((total, group) => total + group.matches.length, 0);
}

export function renderLog(list, entries) {
  const doc = list.ownerDocument;
  list.replaceChildren();
  for (const entry of entries) {
    const item = doc.createElement("li");
    item.className = `log-${entry.level}`;
    const time = doc.createElement("time");
    time.dateTime = entry.time;
    time.textContent = entry.time.slice(11, 19);
    const text = doc.createElement("span");
    text.textContent = entry.message;
    item.append(time, text);
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Icons come from the <symbol> sprite in finder.html.
function icon(doc, name, className = "i") {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function textEl(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

export function renderResults(container, run) {
  const doc = container.ownerDocument;
  // Keep groups the user folded closed while results re-render during a search.
  const closed = new Set([...container.querySelectorAll("details.group:not([open])")].map((item) => item.dataset.keyword));
  container.replaceChildren();
  const groups = run?.groups || [];
  if (!groups.length) {
    const empty = doc.createElement("div");
    empty.className = "empty";
    const badge = doc.createElement("span");
    badge.className = "empty-icon";
    badge.append(icon(doc, "search"));
    empty.append(
      badge,
      textEl(doc, "p", "empty-title", "No results yet"),
      textEl(doc, "p", "", "Matches show up here while a search is running. The last results stay on this device so you can export them later."),
    );
    container.append(empty);
    return;
  }
  for (const group of groups) {
    const section = doc.createElement("details");
    section.className = "group";
    section.dataset.keyword = group.keyword;
    section.open = !closed.has(group.keyword);
    const head = doc.createElement("summary");
    head.append(textEl(doc, "h3", "", group.keyword));
    if (group.status === "stopped" || group.status === "running") {
      head.append(textEl(doc, "span", `status-chip ${group.status}`, group.status === "stopped" ? "Stopped" : "Searching"));
    }
    head.append(
      textEl(doc, "span", "summary", summaryLine(group.matches.length, group.checked)),
      icon(doc, "chevron", "i chevron"),
    );
    section.append(head);
    if (group.matches.length) section.append(renderTable(doc, group, run));
    else section.append(textEl(doc, "p", "group-empty", "No matches for this product name yet."));
    container.append(section);
  }
}

function renderTable(doc, group, run) {
  const wrap = doc.createElement("div");
  wrap.className = "table-wrap";
  const table = doc.createElement("table");
  const head = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  const columns = [["#", "idx"], ["Product", "product"], ["Price", "num price"], ["Rating", "num rating"], ["Reviews", "num reviews"], ["", "copy"]];
  for (const [label, className] of columns) {
    const cell = doc.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  group.matches.forEach((match, index) => {
    const row = doc.createElement("tr");
    row.append(
      cell(doc, String(index + 1), "idx"),
      productCell(doc, match, run),
      cell(doc, `$${Number(match.price).toFixed(2)}`, "num price"),
      ratingCell(doc, match.rating),
      cell(doc, Number(match.reviews).toLocaleString("en-US"), "num"),
      copyCell(doc, match.url),
    );
    body.append(row);
  });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function cell(doc, text, className) {
  const td = doc.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

// Seller text and tags sit under the title so the table fits next to the filters.
function productCell(doc, match, run) {
  const td = doc.createElement("td");
  td.className = "product";
  const link = doc.createElement("a");
  link.href = match.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = match.title;
  link.textContent = match.title;
  const meta = doc.createElement("div");
  meta.className = "product-meta";
  if (match.sellerColumn) meta.append(sellerLabel(doc, match.sellerColumn));
  for (const tag of productTags(match, run?.filters?.targetReviews)) {
    const chip = textEl(doc, "span", `tag ${tag.kind}`, tag.label);
    chip.title = tag.tip;
    meta.append(chip);
  }
  td.append(link);
  if (meta.childNodes.length) td.append(meta);
  return td;
}

// "Seller ships it · Tayfus" → a badge for who ships it, then the seller name.
function sellerLabel(doc, text) {
  const wrap = doc.createElement("span");
  wrap.className = "seller";
  const split = text.indexOf(" · ");
  const who = split === -1 ? text : text.slice(0, split);
  const kind = /^Seller ships/.test(who) ? "fbm" : /^Amazon ships/.test(who) ? "fba" : "";
  if (!kind) {
    wrap.textContent = text;
    return wrap;
  }
  wrap.append(textEl(doc, "span", `badge ${kind}`, who));
  if (split !== -1) wrap.append(doc.createTextNode(text.slice(split)));
  return wrap;
}

// Short labels for the table. The Excel and CSV files keep the full note text.
function productTags(match, targetReviews) {
  const tags = [];
  const rating = Number(match.rating);
  if (rating >= 4.8) tags.push({ label: "Top rated", kind: "top", tip: `Rated ${rating.toFixed(1)} out of 5` });
  for (const note of match.notes || []) tags.push(noteTag(note, match, Number(targetReviews)));
  return tags;
}

function noteTag(note, match, target) {
  if (note === NOTE_REVIEWS) {
    const reviews = Number(match.reviews);
    if (!(target > 0)) return { label: "Off-target reviews", kind: "info", tip: note };
    const tip = `${note}: ${reviews.toLocaleString("en-US")} reviews, target ${target.toLocaleString("en-US")}`;
    return { label: reviews > target ? "Many reviews" : "Few reviews", kind: "info", tip };
  }
  if (note === NOTE_PRICE) {
    const before = match.searchPrice != null ? ` Search page showed $${Number(match.searchPrice).toFixed(2)}.` : "";
    return { label: "Price changed", kind: "warn", tip: `${note}.${before}` };
  }
  return { label: note, kind: "info", tip: note };
}

function ratingCell(doc, rating) {
  const td = doc.createElement("td");
  td.className = "num rating";
  const star = textEl(doc, "span", "star", "★");
  star.setAttribute("aria-hidden", "true");
  td.append(star, doc.createTextNode(Number(rating).toFixed(1)));
  return td;
}

function copyCell(doc, url) {
  const td = doc.createElement("td");
  td.className = "copy";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "ghost icon copy-link";
  button.dataset.copy = url;
  button.title = "Copy link";
  button.setAttribute("aria-label", "Copy link");
  button.append(icon(doc, "copy"));
  td.append(button);
  return td;
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function allLinks(run) {
  return (run?.groups || []).flatMap((group) => group.matches.map((match) => match.url)).join("\n");
}

// History tab: one card per past search, newest first.
export function renderHistory(container, entries, { viewingId = null, latestId = null } = {}) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  if (!entries.length) {
    const empty = doc.createElement("div");
    empty.className = "empty";
    const badge = doc.createElement("span");
    badge.className = "empty-icon";
    badge.append(icon(doc, "clock"));
    empty.append(
      badge,
      textEl(doc, "p", "empty-title", "No past searches yet"),
      textEl(doc, "p", "", "Every search you run is saved here on this device, so you can open it again and export it later."),
    );
    container.append(empty);
    return;
  }
  for (const entry of entries) {
    const run = entry.run || {};
    const item = doc.createElement("article");
    item.className = "history-item";
    if (entry.id === viewingId || (!viewingId && entry.id === latestId)) item.classList.add("current");

    const main = doc.createElement("div");
    main.className = "history-main";
    const top = doc.createElement("div");
    top.className = "history-top";
    const time = textEl(doc, "time", "", formatRunDate(run.startedAt || entry.savedAt));
    time.dateTime = run.startedAt || entry.savedAt;
    top.append(time);
    const finished = Boolean(run.finishedAt);
    top.append(textEl(doc, "span", `status-chip ${finished ? "done" : "stopped"}`, finished ? "Finished" : "Stopped"));
    if (entry.id === viewingId) top.append(textEl(doc, "span", "status-chip running", "Viewing"));
    else if (!viewingId && entry.id === latestId) top.append(textEl(doc, "span", "status-chip running", "Current"));

    const keywords = runKeywords(run);
    const words = textEl(doc, "p", "history-keywords", keywords.join(", ") || "No product names");
    words.title = keywords.join(", ");

    const matches = runMatchCount(run);
    const facts = [
      `${matches} match${matches === 1 ? "" : "es"}`,
      `${keywords.length} product name${keywords.length === 1 ? "" : "s"}`,
      ...describeFilters(run.filters),
    ];
    main.append(top, words, textEl(doc, "p", "history-meta", facts.join(" · ")));

    const actions = doc.createElement("div");
    actions.className = "history-actions";
    const open = doc.createElement("button");
    open.type = "button";
    open.className = "secondary sm";
    open.dataset.open = entry.id;
    open.textContent = "Open";
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "ghost icon sm";
    remove.dataset.delete = entry.id;
    remove.title = "Delete from history";
    remove.setAttribute("aria-label", "Delete from history");
    remove.append(icon(doc, "trash"));
    actions.append(open, remove);

    item.append(main, actions);
    container.append(item);
  }
}
