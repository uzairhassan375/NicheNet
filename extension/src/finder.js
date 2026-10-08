import { clampFiltersToAccount, consumeSearch, loginAccount, logoutAccount, recordActivity, restoreAccount } from "./account.js";
import { createAmazonClient } from "./amazonClient.js";
import { manualZipMessage, prepareDelivery } from "./delivery.js";
import { buildCsv, buildWorkbook, csvFilename, downloadBlob, workbookFilename } from "./excel.js";
import { FILTER_DEFAULTS, normalizeFilters, parseKeywords, speedOption, validateFilters } from "./filters.js";
import { addToHistory, formatRunDate, historyEntry, historyForAccount } from "./history.js";
import { StoppedError, createJobControl } from "./jobControl.js";
import { createKeywordList } from "./keywordList.js";
import { createPacer } from "./pacer.js";
import { createResultsStore } from "./resultsStore.js";
import { formatProgressLine, runSearch } from "./scanner.js";
import { createSettingsStore } from "./storage.js";
import { allLinks, copyText, countMatches, renderHistory, renderLog, renderResults } from "./ui.js";

const params = new URLSearchParams(location.search);
const fast = params.get("pace") === "fast";
const concurrency = Math.max(1, Number(params.get("concurrency") || 2));
const pollMs = Math.max(10, Number(params.get("poll") || (fast ? 40 : 10000)));

const control = createJobControl();
const pacer = createPacer({
  minDelay: fast ? 0 : 1500,
  maxDelay: fast ? 0 : 4000,
  concurrency,
});

const form = document.querySelector("#filters");
const keywordSource = form.elements.namedItem("keywords");
const keywordList = createKeywordList({
  list: document.querySelector("#keyword-list"),
  source: keywordSource,
  addButton: document.querySelector("#add-keyword"),
});
const accountForm = document.querySelector("#account-form");
const accountEmail = document.querySelector("#account-email");
const accountPassword = document.querySelector("#account-password");
const accountError = document.querySelector("#account-error");
const accountStatus = document.querySelector("#account-status");
const appMain = document.querySelector("#app-main");
const progress = document.querySelector("#progress");
const deliveryStatus = document.querySelector("#delivery-status");
const formErrors = document.querySelector("#form-errors");
const captchaBanner = document.querySelector("#captcha-banner");
const manualBanner = document.querySelector("#manual-banner");
const manualText = document.querySelector("#manual-text");
const errorBanner = document.querySelector("#error-banner");
const resultsEl = document.querySelector("#results");
const logPanel = document.querySelector("#log-panel");
const logList = document.querySelector("#log-list");
const keepOpen = document.querySelector("#keep-open");
const startBtn = document.querySelector("#start");
const pauseBtn = document.querySelector("#pause");
const resumeBtn = document.querySelector("#resume");
const stopBtn = document.querySelector("#stop");
const deliveryBtn = document.querySelector("#set-delivery");
const presetSelect = document.querySelector("#preset-select");
const presetName = document.querySelector("#preset-name");
const downloadXlsx = document.querySelector("#download-xlsx");
const downloadCsv = document.querySelector("#download-csv");
const copyAll = document.querySelector("#copy-all");
const stateLabel = document.querySelector("#state-label");
const progressBar = document.querySelector("#progress-bar");
const statKeyword = document.querySelector("#stat-keyword");
const statChecked = document.querySelector("#stat-checked");
const statMatches = document.querySelector("#stat-matches");
const resultsCount = document.querySelector("#results-count");
const keywordCount = document.querySelector("#keyword-count");
const accountName = document.querySelector("#account-name");
const accountAvatar = document.querySelector("#account-avatar");
const accountMeter = document.querySelector("#account-meter");
const accountCaps = document.querySelector("#account-caps");
const toast = document.querySelector("#toast");
const historyDrawer = document.querySelector("#history-drawer");
const openHistoryBtn = document.querySelector("#open-history");
const historyList = document.querySelector("#history-list");
const historyCount = document.querySelector("#history-count");
const clearHistoryBtn = document.querySelector("#clear-history");
const viewingBar = document.querySelector("#viewing-bar");
const viewingText = document.querySelector("#viewing-text");

const STATE_LABELS = { idle: "Ready", running: "Running", paused: "Paused", captcha: "Needs your check" };

const logs = [];
let settings;
let store;
let manualResolve = null;
let manualReject = null;
let presets = [];
let currentAccount = null;
let history = [];
// A past search opened from History. Null means the latest results are shown.
let viewing = null;

const client = createAmazonClient({
  pacer,
  control,
  pollMs,
  resumeNoticeMs: fast ? 0 : 1200,
  log,
  onCaptcha: handleCaptcha,
  openTab: async (url) => {
    // tabs: open the Amazon page that asked for a human check, without
    // hiding this tab. The 10 second re-check runs here, and Chrome slows
    // timers in background tabs.
    await chrome.tabs.create({ url, active: false });
  },
});

function log(level, message) {
  logs.push({ time: new Date().toISOString(), level, message });
  if (logs.length > 400) logs.shift();
  renderLog(logList, logs);
  if (level === "error" || level === "warn") logPanel.open = true;
  recordActivity(currentAccount?.token, level, message);
}

function setRunState(state) {
  document.body.dataset.state = state;
  stateLabel.textContent = STATE_LABELS[state] || STATE_LABELS.idle;
  keepOpen.classList.toggle("active", state !== "idle");
  const controls = new Set(["start", "pause", "resume", "stop"]);
  for (const field of form.querySelectorAll("input, textarea, select, button")) {
    if (controls.has(field.id)) continue;
    field.disabled = state !== "idle";
  }
  startBtn.disabled = state !== "idle";
  pauseBtn.disabled = state !== "running" && state !== "captcha";
  resumeBtn.disabled = state !== "paused" && state !== "captcha";
  stopBtn.disabled = state === "idle";
  deliveryBtn.disabled = state !== "idle";
  if (state === "idle" && currentAccount) applyInputCaps(currentAccount);
}

function showErrors(errors) {
  formErrors.replaceChildren();
  if (!errors.length) {
    formErrors.hidden = true;
    return;
  }
  formErrors.hidden = false;
  for (const message of errors) {
    const item = document.createElement("li");
    item.textContent = message;
    formErrors.append(item);
  }
}

function showError(message) {
  if (!message) {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
    return;
  }
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

function handleCaptcha(event) {
  if (event.mode === "hide") {
    captchaBanner.hidden = true;
    captchaBanner.classList.remove("good");
    const state = control.getState();
    if (state === "running" || state === "paused" || state === "captcha") setRunState(state === "captcha" ? "captcha" : state);
    return;
  }
  captchaBanner.hidden = false;
  captchaBanner.classList.toggle("good", event.mode === "resuming");
  captchaBanner.textContent = event.message;
  if (event.mode !== "resuming") setRunState("captcha");
}

function readForm() {
  const data = new FormData(form);
  return normalizeFilters({
    keywords: data.get("keywords"),
    minPrice: data.get("minPrice"),
    maxPrice: data.get("maxPrice"),
    minRating: data.get("minRating"),
    minReviews: data.get("minReviews"),
    targetReviews: data.get("targetReviews"),
    shipsFrom: data.get("shipsFrom"),
    resultsWanted: data.get("resultsWanted"),
    maxPages: data.get("maxPages"),
    zip: data.get("zip"),
    speed: data.get("speed"),
    handmade: form.elements.namedItem("handmade")?.checked === true,
  });
}

function fillForm(filters) {
  const values = { ...FILTER_DEFAULTS, ...filters };
  for (const [key, value] of Object.entries(values)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = value === true || value === "true" || value === "on";
    else field.value = value;
  }
  keywordList.render();
  updateSpeedNote();
  updateKeywordCount();
}

function updateKeywordCount() {
  const count = parseKeywords(form.elements.namedItem("keywords")?.value).length;
  keywordCount.textContent = `${count} product name${count === 1 ? "" : "s"}`;
}

// Display only: the status card numbers and progress bar.
function showStats({ keyword = "–", checked = 0, matches = 0, percent = 0 }) {
  statKeyword.textContent = keyword;
  statChecked.textContent = Number(checked).toLocaleString("en-US");
  statMatches.textContent = Number(matches).toLocaleString("en-US");
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function showRunStats(run, percent) {
  const groups = run?.groups || [];
  const searched = groups.filter((group) => group.status !== "pending").length;
  showStats({
    keyword: groups.length ? `${searched}/${groups.length}` : "–",
    checked: groups.reduce((total, group) => total + (group.checked || 0), 0),
    matches: countMatches(run),
    percent: percent ?? (run?.finishedAt ? 100 : 0),
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1600);
}

// History opens as a panel from the header button.
function openHistoryPanel() {
  refreshHistory();
  historyDrawer.classList.add("open");
  openHistoryBtn.setAttribute("aria-expanded", "true");
  historyDrawer.querySelector(".drawer-head [data-close-history]").focus();
}

function closeHistoryPanel() {
  if (!historyDrawer.classList.contains("open")) return;
  historyDrawer.classList.remove("open");
  openHistoryBtn.setAttribute("aria-expanded", "false");
  openHistoryBtn.focus();
}

function visibleHistory() {
  return historyForAccount(history, currentAccount);
}

function refreshHistory() {
  const entries = visibleHistory();
  renderHistory(historyList, entries, { viewingId: viewing?.id, latestId: store?.get()?.startedAt });
  historyCount.hidden = entries.length === 0;
  historyCount.textContent = String(entries.length);
  clearHistoryBtn.hidden = entries.length === 0;
}

async function saveHistory() {
  try {
    await settings.saveHistory(history);
  } catch (error) {
    // Storage is full: keep the newer half and try once more.
    history = history.slice(0, Math.max(1, Math.floor(history.length / 2)));
    try {
      await settings.saveHistory(history);
    } catch (again) {
      log("warn", `Could not save search history (${again.message}).`);
    }
  }
}

async function recordHistory(run) {
  if (!run?.groups?.length) return;
  history = addToHistory(history, historyEntry(structuredClone(run), currentAccount));
  await saveHistory();
  refreshHistory();
}

function showLatest() {
  viewing = null;
  const run = store.get();
  renderRun(run);
  showRunStats(run);
  progress.textContent = run?.groups?.length ? "Showing your last search." : "";
  refreshHistory();
}

function openHistory(id) {
  const entry = history.find((item) => item.id === id);
  if (!entry) return;
  if (control.getState() !== "idle") {
    showToast("Wait until the search finishes.");
    return;
  }
  if (entry.id === store.get()?.startedAt) {
    showLatest();
  } else {
    viewing = entry;
    renderRun(entry.run);
    showRunStats(entry.run);
    progress.textContent = "Showing a past search.";
  }
  closeHistoryPanel();
}

async function deleteHistory(id) {
  history = history.filter((item) => item.id !== id);
  await saveHistory();
  if (viewing?.id === id) showLatest();
  refreshHistory();
}

async function clearHistory() {
  const visible = new Set(visibleHistory().map((item) => item.id));
  if (!visible.size) return;
  const label = `${visible.size} saved search${visible.size === 1 ? "" : "es"}`;
  if (!confirm(`Delete ${label} from this device? This cannot be undone.`)) return;
  history = history.filter((item) => !visible.has(item.id));
  await saveHistory();
  if (viewing) showLatest();
  refreshHistory();
  showToast("History cleared");
}

function updateSpeedNote() {
  const note = document.querySelector("#speed-note");
  const selected = speedOption(form.elements.namedItem("speed")?.value);
  if (note) note.textContent = selected.note;
}

function applySelectedPace() {
  if (fast) return 2;
  const selected = speedOption(readForm().speed);
  pacer.setPace(selected);
  updateSpeedNote();
  return selected.concurrency;
}

function shownRun() {
  return viewing?.run || store?.get();
}

function updateExportButtons() {
  const run = shownRun();
  const ready = countMatches(run) > 0 || (run?.groups || []).length > 0;
  downloadXlsx.disabled = !run?.groups?.length;
  downloadCsv.disabled = !ready;
  copyAll.disabled = countMatches(run) === 0;
}

function renderRun(run) {
  renderResults(resultsEl, run);
  viewingBar.hidden = !viewing;
  viewingText.textContent = viewing ? `Viewing a past search from ${formatRunDate(viewing.run.startedAt || viewing.savedAt)}.` : "";
  const found = countMatches(run);
  resultsCount.hidden = found === 0;
  resultsCount.textContent = String(found);
  updateExportButtons();
}

function waitForManual(zip) {
  manualText.textContent = manualZipMessage(zip);
  manualBanner.hidden = false;
  chrome.tabs.create({ url: "https://www.amazon.com/", active: true }).catch((error) => {
    log("warn", `Could not open Amazon (${error.message}).`);
  });
  return new Promise((resolve, reject) => {
    manualResolve = () => {
      manualBanner.hidden = true;
      manualResolve = null;
      manualReject = null;
      resolve();
    };
    manualReject = (error) => {
      manualBanner.hidden = true;
      manualResolve = null;
      manualReject = null;
      reject(error);
    };
  });
}

async function rememberFilters() {
  try {
    await settings.saveFilters(readForm());
  } catch (error) {
    log("warn", `Could not save filters (${error.message}).`);
  }
}

async function refreshPresets(selectedId) {
  presetSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = presets.length ? "Select a preset" : "No saved presets";
  presetSelect.append(placeholder);
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect.append(option);
  }
  if (selectedId) presetSelect.value = selectedId;
}

async function runDelivery(zip) {
  return prepareDelivery({
    zip,
    client,
    // cookies: sets i18n-prefs=USD (and English) on .amazon.com only.
    cookies: chrome.cookies,
    confirmManually: waitForManual,
    log,
    onStatus: (text) => {
      progress.textContent = text;
    },
  });
}

function showAccountError(message) {
  accountError.hidden = !message;
  accountError.textContent = message || "";
}

function applyInputCaps(account) {
  const pages = form.elements.namedItem("maxPages");
  const results = form.elements.namedItem("resultsWanted");
  const minPrice = form.elements.namedItem("minPrice");
  const maxPrice = form.elements.namedItem("maxPrice");
  const minRating = form.elements.namedItem("minRating");
  const minReviews = form.elements.namedItem("minReviews");
  const target = form.elements.namedItem("targetReviews");
  const ships = form.elements.namedItem("shipsFrom");
  const zip = form.elements.namedItem("zip");
  if (account?.max_pages != null) pages.max = String(account.max_pages);
  else pages.removeAttribute("max");
  if (account?.max_results != null) results.max = String(Math.min(100, Number(account.max_results)));
  else results.max = "100";
  if (account?.price_min != null) minPrice.min = String(account.price_min);
  else minPrice.min = "0";
  if (account?.price_max != null) maxPrice.max = String(account.price_max);
  else maxPrice.removeAttribute("max");
  if (account?.min_rating != null) minRating.min = String(account.min_rating);
  else minRating.min = "0";
  if (account?.min_reviews != null) minReviews.min = String(account.min_reviews);
  else minReviews.min = "0";
  target.disabled = account?.target_reviews != null;
  ships.disabled = Boolean(account?.ships_from);
  zip.disabled = Boolean(account?.deliver_zip);
}

function updateAccountStatus(account) {
  const limit = Number(account.searches_per_day);
  const left = account.remaining != null ? Number(account.remaining) : Math.max(0, limit - Number(account.used_today || 0));
  const caps = [];
  if (account.max_pages != null) caps.push(`up to ${account.max_pages} pages`);
  if (account.max_results != null) caps.push(`up to ${account.max_results} results`);
  if (account.price_min != null || account.price_max != null) {
    caps.push(`price $${account.price_min ?? "0"}–$${account.price_max ?? "any"}`);
  }
  if (account.min_rating != null) caps.push(`rating ≥ ${account.min_rating}`);
  if (account.min_reviews != null) caps.push(`reviews ≥ ${account.min_reviews}`);
  if (account.ships_from) caps.push(`ships ${account.ships_from}`);
  if (account.deliver_zip) caps.push(`ZIP ${account.deliver_zip}`);
  const who = account.name || account.email || "";
  accountStatus.textContent = `${left} of ${limit} searches left today`;
  accountName.textContent = who;
  accountName.title = account.email || who;
  accountAvatar.textContent = who.trim().charAt(0).toUpperCase();
  accountMeter.firstElementChild.style.width = `${limit > 0 ? Math.min(100, Math.round((left / limit) * 100)) : 0}%`;
  accountMeter.dataset.level = left <= 0 ? "empty" : left <= limit * 0.1 ? "low" : "ok";
  accountCaps.hidden = caps.length === 0;
  accountCaps.textContent = caps.length ? `Account limits: ${caps.join(", ")}.` : "";
}

function showGate() {
  currentAccount = null;
  accountForm.hidden = false;
  appMain.hidden = true;
}

function enterApp(account) {
  currentAccount = account;
  accountForm.hidden = true;
  appMain.hidden = false;
  showAccountError("");
  applyInputCaps(account);
  fillForm(clampFiltersToAccount(readForm(), account));
  updateAccountStatus(account);
  refreshHistory();
}

async function startSearch() {
  if (control.getState() !== "idle") return;
  showError("");
  if (!currentAccount?.token) {
    showError("Sign in first.");
    showGate();
    return;
  }
  const workers = applySelectedPace();
  const capped = clampFiltersToAccount(readForm(), currentAccount);
  fillForm(capped);
  const validation = validateFilters(capped);
  showErrors(validation.errors);
  if (!validation.ok) return;
  let gate;
  try {
    gate = await consumeSearch(currentAccount.token, validation.filters);
  } catch (error) {
    showError(error.message);
    return;
  }
  if (!gate.ok) {
    showError(gate.error || "You cannot start another search until an admin allows it.");
    if (gate.code === "unauthorized") {
      await logoutAccount();
      showGate();
    } else {
      currentAccount = { ...currentAccount, ...gate, token: currentAccount.token };
      updateAccountStatus(currentAccount);
    }
    return;
  }
  currentAccount = { ...currentAccount, ...gate, token: currentAccount.token };
  updateAccountStatus(currentAccount);
  control.start();
  setRunState("running");
  const run = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    filters: validation.filters,
    keywords: validation.keywords,
    zip: validation.filters.zip,
    deliveryText: "",
    groups: [],
  };
  viewing = null;
  closeHistoryPanel();
  let progressPercent = 0;
  showStats({ keyword: `0/${validation.keywords.length}` });
  try {
    await store.set(run);
    renderRun(run);
    await settings.saveFilters(validation.filters);
    const verified = await runDelivery(validation.filters.zip);
    run.deliveryText = verified.text;
    deliveryStatus.textContent = `Delivering to: ${verified.text}`;
    log("info", `Delivering to: ${verified.text}`);
    await runSearch({
      filters: validation.filters,
      keywords: validation.keywords,
      workers,
      client,
      control,
      log,
      onProgress: (update) => {
        progress.textContent = formatProgressLine(update);
        const { maxPages, resultsWanted, handmade } = validation.filters;
        const step = (update.section ? maxPages : 0) + update.page - 1;
        const within = Math.min(1, Math.max(update.matches / resultsWanted, step / (maxPages * (handmade ? 2 : 1))));
        progressPercent = Math.max(progressPercent, ((update.keywordIndex - 1 + within) / update.keywordCount) * 100);
        showRunStats(run, progressPercent);
        statKeyword.textContent = `${update.keywordIndex}/${update.keywordCount}`;
      },
      onGroup: (groups) => {
        run.groups = groups;
        renderRun(run);
        store.set(run);
      },
    });
    run.finishedAt = new Date().toISOString();
    showRunStats(run, 100);
    const found = countMatches(run);
    progress.textContent = `Finished. ${found} match${found === 1 ? "" : "es"} across ${run.groups.length} product name${run.groups.length === 1 ? "" : "s"}.`;
    log("info", progress.textContent);
  } catch (error) {
    if (error instanceof StoppedError || error.name === "StoppedError") {
      progress.textContent = "Stopped. Kept the matches found so far.";
      log("info", progress.textContent);
      renderRun(run);
      showRunStats(run, progressPercent);
    } else {
      progress.textContent = "Search did not finish.";
      showError(error.message);
      log("error", error.message);
    }
  } finally {
    manualBanner.hidden = true;
    captchaBanner.hidden = true;
    control.finish();
    setRunState("idle");
    try {
      await store.set(run, true);
    } catch (error) {
      log("warn", `Could not save results (${error.message}).`);
    }
    await recordHistory(run);
    updateExportButtons();
  }
}

async function setDeliveryOnly() {
  if (control.getState() !== "idle") return;
  showError("");
  const zip = readForm().zip;
  if (!zip) {
    showErrors(["Enter a ZIP or postcode."]);
    return;
  }
  showErrors([]);
  control.start();
  setRunState("running");
  try {
    await rememberFilters();
    const verified = await runDelivery(zip);
    deliveryStatus.textContent = `Delivering to: ${verified.text}`;
    progress.textContent = `Delivering to: ${verified.text}`;
    log("info", `Delivering to: ${verified.text}`);
  } catch (error) {
    if (!(error instanceof StoppedError) && error.name !== "StoppedError") {
      showError(error.message);
      log("error", error.message);
      progress.textContent = "Delivery location was not confirmed.";
    } else {
      progress.textContent = "Stopped before the delivery location was confirmed.";
    }
  } finally {
    manualBanner.hidden = true;
    control.finish();
    setRunState("idle");
  }
}

function bind() {
  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAccountError("");
    try {
      const account = await loginAccount(accountEmail.value, accountPassword.value);
      accountPassword.value = "";
      enterApp(account);
    } catch (error) {
      showAccountError(error.message);
    }
  });
  document.querySelector("#account-logout").addEventListener("click", async () => {
    if (control.getState() !== "idle") return;
    await logoutAccount();
    showGate();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    startSearch();
  });
  pauseBtn.addEventListener("click", () => {
    control.pause();
    if (control.getState() === "paused") {
      setRunState("paused");
      progress.textContent = `Paused. ${progress.textContent.replace(/^Paused\. /, "")}`;
      log("info", "Paused.");
    } else {
      log("info", "Will pause after the Amazon check.");
    }
  });
  resumeBtn.addEventListener("click", () => {
    control.resume();
    if (control.getState() === "running") {
      setRunState("running");
      progress.textContent = progress.textContent.replace(/^Paused\. /, "");
      log("info", "Resumed.");
    }
  });
  stopBtn.addEventListener("click", () => {
    control.stop();
    manualReject?.(new StoppedError());
    log("info", "Stopping…");
  });
  deliveryBtn.addEventListener("click", setDeliveryOnly);
  document.querySelector("#manual-continue").addEventListener("click", () => manualResolve?.());
  // A field folded away in "Advanced settings" must be visible when the browser flags it.
  form.addEventListener(
    "invalid",
    (event) => {
      event.target.closest("details")?.setAttribute("open", "");
    },
    true,
  );
  form.addEventListener("input", (event) => {
    if (event.target === keywordSource) keywordList.render();
    updateSpeedNote();
    updateKeywordCount();
    clearTimeout(bind.timer);
    bind.timer = setTimeout(rememberFilters, 300);
  });
  document.querySelector("#save-preset").addEventListener("click", async () => {
    const name = presetName.value.trim();
    if (!name) {
      showErrors(["Name the preset before saving it."]);
      return;
    }
    const validation = validateFilters(readForm());
    if (!validation.ok) {
      showErrors(validation.errors);
      return;
    }
    showErrors([]);
    const existing = presets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const preset = {
      id: existing?.id || crypto.randomUUID(),
      name,
      filters: validation.filters,
      savedAt: new Date().toISOString(),
    };
    presets = presets.filter((item) => item.id !== preset.id).concat(preset);
    await settings.savePresets(presets);
    await refreshPresets(preset.id);
    log("info", `Saved preset “${name}”.`);
  });
  document.querySelector("#load-preset").addEventListener("click", async () => {
    const preset = presets.find((item) => item.id === presetSelect.value);
    if (!preset) return;
    fillForm(preset.filters);
    presetName.value = preset.name;
    await rememberFilters();
    log("info", `Loaded preset “${preset.name}”.`);
  });
  document.querySelector("#delete-preset").addEventListener("click", async () => {
    const preset = presets.find((item) => item.id === presetSelect.value);
    if (!preset) return;
    presets = presets.filter((item) => item.id !== preset.id);
    await settings.savePresets(presets);
    await refreshPresets();
    log("info", `Deleted preset “${preset.name}”.`);
  });
  downloadXlsx.addEventListener("click", async () => {
    const run = shownRun();
    if (!run?.groups?.length) return;
    try {
      const bytes = await buildWorkbook(run);
      downloadBlob(
        workbookFilename(),
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
    } catch (error) {
      showError(error.message);
      log("error", `Excel export failed: ${error.message}`);
    }
  });
  downloadCsv.addEventListener("click", () => {
    const run = shownRun();
    if (!run?.groups?.length) return;
    try {
      downloadBlob(csvFilename(), new Blob([buildCsv(run)], { type: "text/csv;charset=utf-8" }));
    } catch (error) {
      showError(error.message);
      log("error", `CSV export failed: ${error.message}`);
    }
  });
  copyAll.addEventListener("click", async () => {
    const links = allLinks(shownRun());
    if (!links) return;
    await copyText(links);
    showToast("All links copied");
  });
  openHistoryBtn.addEventListener("click", openHistoryPanel);
  for (const closer of historyDrawer.querySelectorAll("[data-close-history]")) {
    closer.addEventListener("click", closeHistoryPanel);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeHistoryPanel();
  });
  document.querySelector("#back-to-latest").addEventListener("click", showLatest);
  clearHistoryBtn.addEventListener("click", clearHistory);
  historyList.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) openHistory(open.dataset.open);
    const remove = event.target.closest("[data-delete]");
    if (remove) deleteHistory(remove.dataset.delete);
  });
  resultsEl.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    await copyText(button.dataset.copy);
    showToast("Link copied");
  });
  window.addEventListener("beforeunload", (event) => {
    if (control.getState() !== "idle") {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function init() {
  try {
  if (!globalThis.chrome?.runtime?.id || !chrome.storage?.local) {
    showAccountError("Open this page from the NicheNet toolbar icon after loading the extension.");
    return;
  }
  settings = createSettingsStore(chrome.storage.local);
  store = createResultsStore(settings, (error) => log("warn", `Could not save results (${error.message}).`));
  bind();
  setRunState("idle");
  try {
    const saved = await settings.loadFilters();
    fillForm(saved || FILTER_DEFAULTS);
    presets = await settings.loadPresets();
    history = await settings.loadHistory();
    await refreshPresets();
    const previous = await store.load();
    if (previous?.deliveryText) deliveryStatus.textContent = `Delivering to: ${previous.deliveryText} (last run)`;
    renderRun(previous);
    showRunStats(previous);
    // Searches run before History existed: keep the last one so it is not lost.
    if (previous?.groups?.length && !history.some((item) => item.id === previous.startedAt)) {
      history = addToHistory(history, historyEntry(previous, null, previous.finishedAt || previous.startedAt));
      await saveHistory();
    }
    if (previous?.groups?.length) progress.textContent = "Showing your last search.";
    const account = await restoreAccount();
    if (account?.active === false) {
      showAccountError("This account is paused. An admin has to allow searches again.");
      showGate();
    } else if (account) {
      enterApp(account);
    } else {
      showGate();
    }
  } catch (error) {
    log("error", `Could not restore saved data (${error.message}).`);
    fillForm(FILTER_DEFAULTS);
    showGate();
  }
  } finally {
    document.body.dataset.ready = "yes";
  }
}

init();
