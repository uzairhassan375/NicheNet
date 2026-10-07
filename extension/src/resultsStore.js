export function createResultsStore(settings, onError = () => {}) {
  let run = null;
  let timer = 0;
  const save = (immediate) => {
    clearTimeout(timer);
    const write = () => settings.saveResults(run).catch((error) => onError(error));
    if (immediate) return write();
    timer = setTimeout(write, 400);
    return Promise.resolve();
  };
  return {
    get: () => run,
    async load() {
      run = await settings.loadResults();
      return run;
    },
    set(next, immediate = false) {
      run = next;
      return save(immediate);
    },
  };
}
