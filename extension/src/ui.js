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

export function renderResults(container, run) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const groups = run?.groups || [];
  if (!groups.length) {
    const empty = doc.createElement("p");
    empty.className = "empty";
    empty.textContent = "Matches show up here while a search is running. The last results stay on this device so you can export them later.";
    container.append(empty);
    return;
  }
  for (const group of groups) {
    const section = doc.createElement("section");
    section.className = "group";
    const heading = doc.createElement("h3");
    heading.textContent = group.status === "stopped" ? `${group.keyword} · stopped` : group.keyword;
    const summary = doc.createElement("p");
    summary.className = "summary";
    summary.textContent = summaryLine(group.matches.length, group.checked);
    section.append(heading, summary);
    if (group.matches.length) section.append(renderTable(doc, group));
    container.append(section);
  }
}

function renderTable(doc, group) {
  const wrap = doc.createElement("div");
  wrap.className = "table-wrap";
  const table = doc.createElement("table");
  const head = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const label of ["#", "Product", "Price (USD)", "Rating", "Reviews", "Ships from / Sold by", "Note", ""]) {
    const cell = doc.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  group.matches.forEach((match, index) => {
    const row = doc.createElement("tr");
    row.append(
      cell(doc, String(index + 1)),
      productCell(doc, match),
      cell(doc, `$${Number(match.price).toFixed(2)}`, "num"),
      cell(doc, Number(match.rating).toFixed(1), "num"),
      cell(doc, Number(match.reviews).toLocaleString("en-US"), "num"),
      cell(doc, match.sellerColumn),
      notesCell(doc, match.notes),
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

function productCell(doc, match) {
  const td = doc.createElement("td");
  const link = doc.createElement("a");
  link.href = match.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = match.title;
  td.append(link);
  return td;
}

function notesCell(doc, notes) {
  const td = doc.createElement("td");
  td.className = "notes";
  if (!notes?.length) {
    td.textContent = "";
    return td;
  }
  for (const note of notes) {
    const chip = doc.createElement("span");
    chip.className = "note";
    chip.textContent = note;
    td.append(chip);
  }
  return td;
}

function copyCell(doc, url) {
  const td = doc.createElement("td");
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "ghost copy-link";
  button.dataset.copy = url;
  button.textContent = "Copy link";
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
