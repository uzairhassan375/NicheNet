export class StoppedError extends Error {
  constructor() {
    super("Stopped");
    this.name = "StoppedError";
  }
}

export function createJobControl() {
  let state = "idle";
  let pauseAfterCaptcha = false;
  const waiters = new Set();

  function wake() {
    const current = [...waiters];
    waiters.clear();
    for (const fn of current) fn();
  }

  async function checkpoint() {
    while (state === "paused" || state === "captcha") {
      await new Promise((resolve) => waiters.add(resolve));
    }
    if (state === "stopping") throw new StoppedError();
  }

  return {
    getState: () => state,
    start() {
      pauseAfterCaptcha = false;
      state = "running";
    },
    pause() {
      if (state === "running") {
        state = "paused";
        wake();
      } else if (state === "captcha") {
        pauseAfterCaptcha = true;
      }
    },
    resume() {
      if (state === "paused") {
        state = "running";
        wake();
      } else if (state === "captcha") {
        pauseAfterCaptcha = false;
        wake();
      }
    },
    enterCaptcha() {
      if (state !== "stopping") state = "captcha";
    },
    resumeFromCaptcha() {
      if (state === "stopping") return "stopping";
      if (pauseAfterCaptcha) {
        pauseAfterCaptcha = false;
        state = "paused";
        return "paused";
      }
      state = "running";
      wake();
      return "running";
    },
    stop() {
      state = "stopping";
      wake();
    },
    finish() {
      state = "idle";
      pauseAfterCaptcha = false;
    },
    isStopping: () => state === "stopping",
    checkpoint,
    subscribe(fn) {
      waiters.add(fn);
      return () => waiters.delete(fn);
    },
  };
}
