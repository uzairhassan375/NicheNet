import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { sanitizeSheetName, buildWorkbook, buildCsv, workbookFilename } from "../src/excel.js";
import { FILTER_DEFAULTS } from "../src/filters.js";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("xlsx");
globalThis.JSZip = require("jszip");

const run = {
  startedAt: "2026-10-07T12:00:00.000Z",
  zip: "10001",
  filters: { ...FILTER_DEFAULTS, keywords: "wooden floating shelves" },
  groups: [
    {
      keyword: "wooden floating shelves",
      matches: [
        {
          title: "Walnut shelf",
          asin: "B0FBM00001",
          price: 25,
          rating: 4.8,
          reviews: 180,
          sellerColumn: "Seller ships it · Tayfus",
          url: "https://www.amazon.com/dp/B0FBM00001",
          notes: [],
        },
      ],
    },
    {
      keyword: "wooden floating shelves",
      matches: [],
    },
  ],
};

test("sheet names drop invalid characters and stay within 31 characters", () => {
  const used = new Set();
  assert.equal(sanitizeSheetName("a:b/c?d*e[f]g", used), "a b c d e f g");
  const long = sanitizeSheetName("x".repeat(50), new Set());
  assert.equal(long.length, 31);
  const first = sanitizeSheetName("wooden floating shelves", used);
  const second = sanitizeSheetName("wooden floating shelves", used);
  assert.equal(first, "wooden floating shelves");
  assert.notEqual(second, first);
  assert.ok(second.length <= 31);
});

test("workbook has one sheet per keyword, a frozen header, autofilter, and a product hyperlink", async () => {
  const bytes = await buildWorkbook(run);
  const zip = await globalThis.JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels").async("string");
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /ySplit="3"/);
  assert.match(sheet, /autoFilter ref="A3:H4"/);
  assert.match(rels, /https:\/\/www\.amazon\.com\/dp\/B0FBM00001/);
  const styles = await zip.file("xl/styles.xml").async("string");
  assert.match(styles, /\$#,##0\.00/);
  assert.match(styles, /#,##0/);
  const book = globalThis.XLSX.read(bytes, { type: "array" });
  assert.equal(book.SheetNames[0], "wooden floating shelves");
  assert.equal(book.SheetNames.length, 2);
  assert.equal(book.Sheets[book.SheetNames[0]].C4.v, 25);
  assert.equal(book.Sheets[book.SheetNames[0]].D4.v, 4.8);
});

test("csv and filename include the export date and the product link", () => {
  assert.equal(workbookFilename(new Date(2026, 9, 7)), "NicheNet_2026-10-07.xlsx");
  const csv = buildCsv(run);
  assert.match(csv, /Walnut shelf/);
  assert.match(csv, /https:\/\/www\.amazon\.com\/dp\/B0FBM00001/);
  assert.match(csv, /10001/);
});
