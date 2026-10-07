import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("manifest is Manifest V3 with only the permissions this extension needs", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "NicheNet");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "cookies"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.amazon.com/*",
    "https://yfuisdyvujfhbwlbqsoy.supabase.co/*",
  ]);
  assert.equal(manifest.action.default_popup, undefined);
  assert.doesNotMatch(manifest.name, /amazon/i);
});

test("the service worker only opens the finder tab", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new DOMParser|fetch\(/);
  assert.match(source, /finder\.html/);
});

test("icons are real PNGs at the store sizes", () => {
  for (const size of [16, 32, 48, 128]) {
    const bytes = readFileSync(new URL(`../icons/icon${size}.png`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test("SheetJS and JSZip are files inside the extension", () => {
  const xlsx = readFileSync(new URL("../vendor/xlsx.full.min.js", import.meta.url));
  const jszip = readFileSync(new URL("../vendor/jszip.min.js", import.meta.url));
  assert.ok(xlsx.length > 100000);
  assert.ok(jszip.length > 10000);
});
