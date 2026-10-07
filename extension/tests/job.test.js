import test from "node:test";
import assert from "node:assert/strict";
import { createJobControl } from "../src/jobControl.js";
import { createPacer } from "../src/pacer.js";
import { createMemoryArea, createSettingsStore } from "../src/storage.js";
import { validateFilters, FILTER_DEFAULTS } from "../src/filters.js";

test("pause holds the job until resume", async () => {
  const control = createJobControl();
  control.start();
  control.pause();
  let passed = false;
  const pending = (async () => {
    await control.checkpoint();
    passed = true;
  })();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(passed, false);
  control.resume();
  await pending;
  assert.equal(passed, true);
});

test("at most two requests run at once", async () => {
  let active = 0;
  let max = 0;
  const pacer = createPacer({ minDelay: 0, maxDelay: 0, concurrency: 2, sleepFn: async () => {}, random: () => 0 });
  const control = createJobControl();
  control.start();
  await Promise.all(
    Array.from({ length: 6 }, () =>
      pacer.schedule(async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }, control),
    ),
  );
  assert.equal(max, 2);
});

test("stop rejects a request that has not started", async () => {
  const control = createJobControl();
  control.stop();
  const pacer = createPacer({ minDelay: 0, maxDelay: 0, sleepFn: async () => {} });
  let ran = false;
  await assert.rejects(
    () =>
      pacer.schedule(async () => {
        ran = true;
      }, control),
    { name: "StoppedError" },
  );
  assert.equal(ran, false);
});

test("filters and presets round-trip in local storage", async () => {
  const store = createSettingsStore(createMemoryArea());
  const filters = { ...FILTER_DEFAULTS, keywords: "wooden floating shelves", zip: "10001" };
  await store.saveFilters(filters);
  await store.savePresets([{ id: "1", name: "Shelves", filters }]);
  await store.saveResults({ groups: [{ keyword: "wooden floating shelves", matches: [] }] });
  assert.equal((await store.loadFilters()).zip, "10001");
  assert.equal((await store.loadPresets())[0].name, "Shelves");
  assert.equal((await store.loadResults()).groups.length, 1);
});

test("default filters match the finder form", () => {
  const result = validateFilters({ ...FILTER_DEFAULTS, keywords: "wooden floating shelves" });
  assert.equal(result.ok, true);
  assert.equal(result.filters.minPrice, 20);
  assert.equal(result.filters.maxPrice, 40);
  assert.equal(result.filters.minRating, 4.5);
  assert.equal(result.filters.minReviews, 100);
  assert.equal(result.filters.targetReviews, 200);
  assert.equal(result.filters.shipsFrom, "fbm");
  assert.equal(result.filters.resultsWanted, 10);
  assert.equal(result.filters.maxPages, 10);
  assert.equal(result.filters.zip, "10001");
  assert.equal(result.filters.speed, "recommended");
  assert.equal(result.filters.handmade, true);
  assert.equal(validateFilters({ ...FILTER_DEFAULTS, keywords: "tray", handmade: false }).filters.handmade, false);
  assert.equal(validateFilters({ ...FILTER_DEFAULTS, keywords: "tray", speed: "nope" }).filters.speed, "recommended");
  assert.equal(validateFilters({ ...FILTER_DEFAULTS, keywords: "" }).ok, false);
  assert.equal(validateFilters({ ...FILTER_DEFAULTS, keywords: "tray", maxPages: 500 }).ok, true);
  assert.equal(validateFilters({ ...FILTER_DEFAULTS, keywords: "tray", maxPages: 0 }).ok, false);
});
