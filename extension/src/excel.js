import { shipLabel } from "./filters.js";

const HEADERS = ["#", "Product", "Price (USD)", "Rating", "Reviews", "Ships from / Sold by", "Link", "Note"];

function getXLSX() {
  const lib = globalThis.XLSX;
  if (!lib?.utils) throw new Error("SheetJS failed to load from vendor/xlsx.full.min.js");
  return lib;
}

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function workbookFilename(date = new Date()) {
  return `NicheNet_${formatLocalDate(date)}.xlsx`;
}

export function csvFilename(date = new Date()) {
  return `NicheNet_${formatLocalDate(date)}.csv`;
}

export function sanitizeSheetName(keyword, used = new Set()) {
  let name = String(keyword || "")
    .replace(/[\\/*?:\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) name = "Results";
  name = name.slice(0, 31).trim() || "Results";
  const base = name;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

export function filterSummary(run) {
  const filters = run.filters || {};
  const when = formatLocalDate(run.startedAt ? new Date(run.startedAt) : new Date());
  const handmade = filters.handmade ? ", including Handmade" : "";
  return `Filters: price $${filters.minPrice}–$${filters.maxPrice}, rating ≥ ${filters.minRating}, reviews ≥ ${filters.minReviews}, target ${filters.targetReviews}, ships ${shipLabel(filters.shipsFrom)}, ${filters.resultsWanted} results, ${filters.maxPages} pages max${handmade}, ZIP ${run.zip || filters.zip || ""}, ${when}`;
}

function sheetForGroup(XLSX, group, run) {
  const rows = [
    [`NicheNet — ${group.keyword}`],
    [filterSummary(run)],
    HEADERS,
    ...group.matches.map((match, index) => [
      index + 1,
      match.title,
      match.price,
      match.rating,
      match.reviews,
      match.sellerColumn,
      match.url,
      (match.notes || []).join("; "),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  group.matches.forEach((match, index) => {
    const row = index + 3;
    sheet[XLSX.utils.encode_cell({ r: row, c: 2 })] = { t: "n", v: match.price, z: "$#,##0.00" };
    sheet[XLSX.utils.encode_cell({ r: row, c: 3 })] = { t: "n", v: match.rating, z: "0.0" };
    sheet[XLSX.utils.encode_cell({ r: row, c: 4 })] = { t: "n", v: match.reviews, z: "#,##0" };
    sheet[XLSX.utils.encode_cell({ r: row, c: 6 })] = {
      t: "s",
      v: match.url,
      l: { Target: match.url, Tooltip: "Open product" },
    };
  });
  const lastRow = Math.max(3, 3 + group.matches.length);
  sheet["!autofilter"] = { ref: `A3:H${lastRow}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 3 };
  sheet["!cols"] = [
    { wch: 5 },
    { wch: 56 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 38 },
    { wch: 46 },
    { wch: 42 },
  ];
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ];
  return sheet;
}

async function freezeHeaderRows(bytes) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error("JSZip failed to load from vendor/jszip.min.js");
  const zip = await JSZip.loadAsync(bytes);
  const frozen =
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A4" sqref="A4"/></sheetView></sheetViews>';
  const names = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  for (const name of names) {
    let xml = await zip.file(name).async("string");
    if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
      xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, frozen);
    } else {
      xml = xml.replace("<sheetData", `${frozen}<sheetData`);
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function buildWorkbook(run) {
  const XLSX = getXLSX();
  const book = XLSX.utils.book_new();
  const used = new Set();
  const groups = run.groups?.length ? run.groups : [{ keyword: "Results", matches: [] }];
  for (const group of groups) {
    XLSX.utils.book_append_sheet(book, sheetForGroup(XLSX, group, run), sanitizeSheetName(group.keyword, used));
  }
  const raw = XLSX.write(book, { bookType: "xlsx", type: "array" });
  return freezeHeaderRows(raw);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(run) {
  const lines = ["NicheNet", filterSummary(run), ["Product name", ...HEADERS].map(csvCell).join(",")];
  for (const group of run.groups || []) {
    group.matches.forEach((match, index) => {
      lines.push(
        [
          group.keyword,
          index + 1,
          match.title,
          `$${Number(match.price).toFixed(2)}`,
          Number(match.rating).toFixed(1),
          match.reviews,
          match.sellerColumn,
          match.url,
          (match.notes || []).join("; "),
        ]
          .map(csvCell)
          .join(","),
      );
    });
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
