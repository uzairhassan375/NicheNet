import { StoppedError } from "./jobControl.js";

export function sleep(ms, control) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const unsubscribe = control?.subscribe?.(done);
    function done() {
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    }
  });
}

export function createPacer({
  minDelay = 1500,
  maxDelay = 4000,
  concurrency = 2,
  now = () => Date.now(),
  sleepFn = sleep,
  random = Math.random,
} = {}) {
  let active = 0;
  let multiplier = 1;
  let nextAllowed = 0;
  let delayMin = minDelay;
  let delayMax = maxDelay;
  let limit = concurrency;
  const waiters = [];

  function delayMs() {
    const min = delayMin * multiplier;
    const max = delayMax * multiplier;
    return min + (max - min) * random();
  }

  function takeTicket() {
    if (active >= limit) {
      return new Promise((resolve) => waiters.push(resolve)).then(takeTicket);
    }
    active += 1;
    const current = now();
    const wait = Math.max(0, nextAllowed - current);
    nextAllowed = current + wait + delayMs();
    return Promise.resolve(wait);
  }

  function release() {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  return {
    get multiplier() {
      return multiplier;
    },
    get active() {
      return active;
    },
    describe() {
      const min = ((delayMin * multiplier) / 1000).toFixed(1).replace(/\.0$/, "");
      const max = ((delayMax * multiplier) / 1000).toFixed(1).replace(/\.0$/, "");
      return `${min}–${max} seconds`;
    },
    setPace({ minDelay: nextMin, maxDelay: nextMax, concurrency: nextLimit }) {
      delayMin = nextMin;
      delayMax = nextMax;
      limit = nextLimit;
      multiplier = 1;
    },
    doubleDelays() {
      multiplier *= 2;
      return multiplier;
    },
    async schedule(task, control) {
      const wait = await takeTicket();
      try {
        if (control) await control.checkpoint();
        if (wait > 0) await sleepFn(wait, control);
        if (control) await control.checkpoint();
        return await task();
      } finally {
        release();
      }
    },
  };
}

export { StoppedError };
