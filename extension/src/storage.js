// storage: filters, named presets, and the last results stay in chrome.storage.local
// on this device. Nothing is sent to a server.

const FILTERS = "filters";
const PRESETS = "presets";
const RESULTS = "results";

function rejectRuntime(reject) {
  const message = globalThis.chrome?.runtime?.lastError?.message;
  if (message) {
    reject(new Error(message));
    return true;
  }
  return false;
}

export function createSettingsStore(area) {
  function get(keys) {
    return new Promise((resolve, reject) => {
      area.get(keys, (items) => {
        if (rejectRuntime(reject)) return;
        resolve(items || {});
      });
    });
  }

  function set(items) {
    return new Promise((resolve, reject) => {
      area.set(items, () => {
        if (rejectRuntime(reject)) return;
        resolve();
      });
    });
  }

  return {
    async loadFilters() {
      const items = await get(FILTERS);
      return items[FILTERS] || null;
    },
    saveFilters(filters) {
      return set({ [FILTERS]: filters });
    },
    async loadPresets() {
      const items = await get(PRESETS);
      return Array.isArray(items[PRESETS]) ? items[PRESETS] : [];
    },
    savePresets(presets) {
      return set({ [PRESETS]: presets });
    },
    async loadResults() {
      const items = await get(RESULTS);
      return items[RESULTS] || null;
    },
    saveResults(results) {
      return set({ [RESULTS]: results });
    },
  };
}

export function createMemoryArea(initial = {}) {
  const data = { ...initial };
  return {
    get(keys, callback) {
      const names = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const name of names) result[name] = data[name];
      callback(result);
    },
    set(items, callback) {
      Object.assign(data, items);
      callback();
    },
    snapshot: () => data,
  };
}
