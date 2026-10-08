import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMIT,
  addToHistory,
  describeFilters,
  historyEntry,
  historyForAccount,
  runKeywords,
  runMatchCount,
} from "../src/history.js";

function run(startedAt, keywords = ["shelf"], matches = 1) {
  return {
    startedAt,
    finishedAt: startedAt,
    keywords,
    filters: { minPrice: 20, maxPrice: 40, minRating: 4.5, minReviews: 100, shipsFrom: "fbm" },
    groups: keywords.map((keyword) => ({ keyword, checked: 10, status: "done", matches: Array.from({ length: matches }, () => ({})) })),
  };
}

test("history keeps the newest search first and replaces a search saved twice", () => {
  let list = [];
  list = addToHistory(list, historyEntry(run("2026-10-01T10:00:00.000Z"), { email: "Ali@Example.com" }));
  list = addToHistory(list, historyEntry(run("2026-10-03T10:00:00.000Z"), { email: "ali@example.com" }));
  list = addToHistory(list, historyEntry(run("2026-10-02T10:00:00.000Z"), null));
  assert.deepEqual(list.map((item) => item.id), ["2026-10-03T10:00:00.000Z", "2026-10-02T10:00:00.000Z", "2026-10-01T10:00:00.000Z"]);

  list = addToHistory(list, historyEntry(run("2026-10-01T10:00:00.000Z", ["shelf", "tray"]), { email: "ali@example.com" }));
  assert.equal(list.length, 3);
  assert.deepEqual(list.at(-1).run.keywords, ["shelf", "tray"]);
});

test("history drops the oldest searches past the limit", () => {
  let list = [];
  for (let day = 1; day <= HISTORY_LIMIT + 5; day += 1) {
    const date = new Date(Date.UTC(2026, 0, day)).toISOString();
    list = addToHistory(list, historyEntry(run(date), null));
  }
  assert.equal(list.length, HISTORY_LIMIT);
  assert.equal(list[0].id, new Date(Date.UTC(2026, 0, HISTORY_LIMIT + 5)).toISOString());
});

test("each account sees its own searches plus ones saved without an account", () => {
  const list = [
    historyEntry(run("2026-10-03T10:00:00.000Z"), { email: "ali@example.com" }),
    historyEntry(run("2026-10-02T10:00:00.000Z"), { email: "sara@example.com" }),
    historyEntry(run("2026-10-01T10:00:00.000Z"), null),
  ];
  assert.deepEqual(historyForAccount(list, { email: " ALI@example.com " }).map((item) => item.id), [
    "2026-10-03T10:00:00.000Z",
    "2026-10-01T10:00:00.000Z",
  ]);
});

test("a history entry summarises its keywords, matches, and filters", () => {
  const saved = run("2026-10-03T10:00:00.000Z", ["shelf", "tray"], 3);
  assert.deepEqual(runKeywords(saved), ["shelf", "tray"]);
  assert.equal(runMatchCount(saved), 6);
  assert.deepEqual(describeFilters(saved.filters), ["$20–$40", "★ 4.5+", "100+ reviews", "Seller ships"]);
  assert.deepEqual(runKeywords({ groups: [{ keyword: "old run" }] }), ["old run"]);
});
