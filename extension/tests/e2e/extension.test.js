import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { homePage, productResultPage, searchResultsPage } from "../fixtures.js";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const JSZip = require("jszip");

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = path.resolve(import.meta.dirname, "../..");

const SEARCH_ITEMS = [
  { asin: "B0SPONSOR1", title: "Sponsored shelf ad", rating: "4.9", reviewsLabel: "300", price: "$25.00", sponsored: true },
  { asin: "B0LOW00001", title: "Cheap shelf", rating: "3.1", reviewsLabel: "220", price: "$21.00" },
  { asin: "B0FBM00001", title: "Walnut floating shelf", rating: "4.8", reviewsLabel: "190", price: "$24.00" },
  { asin: "B0FBA00001", title: "Warehouse boxed shelf", rating: "4.9", reviewsLabel: "210", price: "$29.00" },
  { asin: "B0FBM00002", title: "Oak serving board", rating: "4.7", reviewsLabel: "400", price: "$22.00" },
];

function productHtml(url) {
  if (url.includes("B0FBA00001")) {
    return productResultPage({ price: "$29.00", rating: "4.9", reviews: "210", shipsFrom: "Amazon.com", merchant: "Sold by Acme Co" });
  }
  if (url.includes("B0FBM00002")) {
    return productResultPage({ price: "$30.00", rating: "4.7", reviews: "400", merchant: "Shipper / Seller OtherShop" });
  }
  return productResultPage({ price: "$24.00", rating: "4.8", reviews: "190", merchant: "Shipper / Seller Tayfus Tayfus Sold by Tayfus" });
}

function stageExtension() {
  const dir = mkdtempSync(path.join(tmpdir(), "nichenet-ext-"));
  for (const file of ["manifest.json", "background.js", "finder.html", "src", "vendor", "icons"]) {
    cpSync(path.join(root, file), path.join(dir, file), { recursive: true });
  }
  return dir;
}

async function launchBrowser(extensionPath) {
  const launched = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    enableExtensions: true,
    protocolTimeout: 120000,
    args: ["--host-resolver-rules=MAP www.amazon.com 127.0.0.1,MAP amazon.com 127.0.0.1"],
  });
  const installedId = await launched.installExtension(extensionPath);
  return { launched, installedId };
}

let browser;
let extension;
let id;

async function startSession() {
  extension = stageExtension();
  const started = await launchBrowser(extension);
  browser = started.launched;
  id = started.installedId;
}

async function stopSession() {
  await browser?.close();
  browser = undefined;
  if (extension) rmSync(extension, { recursive: true, force: true });
  extension = undefined;
}

async function mockAccount(request) {
  const url = request.url();
  if (!url.includes("supabase.co")) return false;
  if (request.method() === "OPTIONS") {
    await request.respond({ status: 204, body: "" });
    return true;
  }
  const consumed = url.includes("consume_search");
  await request.respond({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      allowed: true,
      token: "test-token",
      email: "tester@example.com",
      name: "Tester",
      active: true,
      searches_per_day: 100,
      used_today: consumed ? 1 : 0,
      remaining: consumed ? 99 : 100,
      max_pages: null,
      max_results: null,
    }),
  });
  return true;
}

async function signIn(page) {
  await page.waitForFunction(() => document.body.dataset.ready === "yes");
  await page.$eval("#account-email", (element) => {
    element.value = "tester@example.com";
  });
  await page.$eval("#account-password", (element) => {
    element.value = "test-password";
  });
  await page.click("#account-login");
  await page.waitForSelector("#app-main:not([hidden])");
}

async function openFinder(query) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`chrome-extension://${id}/finder.html?${query}`, { waitUntil: "domcontentloaded" });
  return { page, errors };
}

test("finder searches seller-shipped products, pauses, and exports a linked workbook", { timeout: 90000 }, async () => {
  await startSession();
  try {
  const { page, errors } = await openFinder("pace=fast&concurrency=1&poll=30");
  const posts = [];
  const productUrls = [];
  let releaseHeld;
  const held = new Promise((resolve) => {
    releaseHeld = resolve;
  });
  let holding = false;

  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = request.url();
    try {
      if (await mockAccount(request)) return;
      if (!url.includes("amazon.com")) {
        await request.continue();
        return;
      }
      if (url.includes("get-rendered-address-selections")) {
        await request.respond({
          status: 200,
          contentType: "text/html",
          headers: { "anti-csrftoken-a2z": "test-token" },
          body: "<html><input id='glowValidationToken' value='test-token'></html>",
        });
        return;
      }
      if (url.includes("address-change") || url.includes("ajax/address-change")) {
        posts.push({ url, body: request.postData() || "", token: request.headers()["anti-csrftoken-a2z"] });
        await request.respond({ status: 200, contentType: "application/json", body: '{"isValidAddress":true}' });
        return;
      }
      if (url.includes("/dp/")) {
        productUrls.push(url);
        if (url.includes("B0FBM00001")) {
          holding = true;
          await held;
        }
        await request.respond({ status: 200, contentType: "text/html", body: productHtml(url) });
        return;
      }
      if (url.includes("/s?")) {
        await request.respond({ status: 200, contentType: "text/html", body: searchResultsPage(SEARCH_ITEMS) });
        return;
      }
      await request.respond({ status: 200, contentType: "text/html", body: homePage("New York 10001") });
    } catch (error) {
      errors.push(String(error));
    }
  });

  await signIn(page);
  await page.$eval('textarea[name="keywords"]', (element) => {
    element.value = "wooden floating shelves";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(await page.$eval("#keep-open", (element) => element.textContent), /Keep this tab open while searching/);
  await page.click("#start");

  await page.waitForFunction(() => document.querySelector("#delivery-status").textContent.includes("10001"), { timeout: 15000 });
  const cookie = await page.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.cookies.get({ url: "https://www.amazon.com/", name: "i18n-prefs" }, resolve);
      }),
  );
  assert.equal(cookie?.value, "USD");
  assert.equal(posts.length > 0, true, errors.join("\n"));
  assert.match(posts[0].body, /10001/);
  assert.equal(posts[0].token, "test-token");

  const started = Date.now();
  while (!holding && Date.now() - started < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(holding, true, `Product request never started.\n${errors.join("\n")}`);
  await page.click("#pause");
  releaseHeld();
  await page.waitForSelector("tbody tr", { timeout: 10000 });
  const duringPause = productUrls.length;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(productUrls.filter((url) => url.includes("B0FBM00002")).length, 0, productUrls.join("\n"));
  assert.equal(productUrls.length, duringPause);
  await page.click("#resume");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 2, { timeout: 10000 });

  const text = await page.$eval("#results", (element) => element.innerText);
  assert.match(text, /Seller ships it · Tayfus/);
  assert.match(text, /Seller ships it · OtherShop/);
  assert.doesNotMatch(text, /Amazon ships it/);
  assert.doesNotMatch(text, /Sponsored shelf ad/);
  assert.match(text, /2 found from 4 products checked/);
  assert.match(text, /Reviews far from target/);
  assert.match(text, /Price re-checked on product page/);
  const firstHref = await page.$eval("tbody tr a", (element) => element.href);
  assert.equal(firstHref, "https://www.amazon.com/dp/B0FBM00001");

  const downloadDir = mkdtempSync(path.join(tmpdir(), "nichenet-xlsx-"));
  const client = await page.createCDPSession();
  try {
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  } catch {
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
  }
  await page.click("#download-xlsx");
  let file = "";
  const downloadStarted = Date.now();
  while (!file && Date.now() - downloadStarted < 8000) {
    file = readdirSync(downloadDir).find((name) => name.endsWith(".xlsx")) || "";
    if (!file) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(file, `Excel file was not downloaded.\n${errors.join("\n")}`);
  assert.match(file, /^NicheNet_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const zip = await JSZip.loadAsync(await (await import("node:fs/promises")).readFile(path.join(downloadDir, file)));
  const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels").async("string");
  assert.match(rels, /https:\/\/www\.amazon\.com\/dp\/B0FBM00001/);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(sheet, /state="frozen"/);
  rmSync(downloadDir, { recursive: true, force: true });
  await page.close();
  } finally {
    await stopSession();
  }
});

test("a CAPTCHA pauses the run until Amazon returns a normal search page", { timeout: 90000 }, async () => {
  await startSession();
  try {
  const { page, errors } = await openFinder("pace=fast&concurrency=1&poll=200");
  let searches = 0;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = request.url();
    try {
      if (await mockAccount(request)) return;
      if (!url.includes("amazon.com")) {
        await request.continue();
        return;
      }
      if (url.includes("get-rendered-address-selections")) {
        await request.respond({
          status: 200,
          contentType: "text/html",
          headers: { "anti-csrftoken-a2z": "test-token" },
          body: "<html></html>",
        });
        return;
      }
      if (request.method() === "POST") {
        await request.respond({ status: 200, contentType: "application/json", body: '{"isValidAddress":true}' });
        return;
      }
      if (url.includes("/dp/")) {
        await request.respond({ status: 200, contentType: "text/html", body: productHtml(url) });
        return;
      }
      if (url.includes("/s?")) {
        searches += 1;
        const body = searches === 1 ? "<html><title>Robot Check</title><body>validateCaptcha</body></html>" : searchResultsPage(SEARCH_ITEMS);
        await request.respond({ status: 200, contentType: "text/html", body });
        return;
      }
      await request.respond({ status: 200, contentType: "text/html", body: homePage("New York 10001") });
    } catch (error) {
      errors.push(String(error));
    }
  });

  await signIn(page);
  await page.$eval('textarea[name="keywords"]', (element) => {
    element.value = "wooden floating shelves";
  });
  await page.click("#start");
  await page.waitForFunction(
    () => /confirm you're human/i.test(document.querySelector("#captcha-banner")?.textContent || ""),
    { timeout: 15000 },
  );
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 2, { timeout: 15000 });
  const banner = await page.$eval("#captcha-banner", (element) => element.hidden);
  assert.equal(banner, true);
  assert.ok(searches >= 2, errors.join("\n"));
  await page.close();
  } finally {
    await stopSession();
  }
});
