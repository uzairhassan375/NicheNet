import { detectBlock } from "./captcha.js";
import { StoppedError } from "./jobControl.js";
import { sleep } from "./pacer.js";
import { parseHtml } from "./parse.js";
import { amazonConfig } from "./amazonConfig.js";

export const CAPTCHA_MESSAGE =
  "Amazon wants to confirm you're human. Please solve the CAPTCHA in the Amazon tab, then come back.";

const WINDOW_MS = 10 * 60 * 1000;

export function createAmazonClient({
  pacer,
  control,
  fetchImpl,
  log = () => {},
  onCaptcha = () => {},
  openTab = async () => {},
  pollMs = 10000,
  resumeNoticeMs = 1200,
} = {}) {
  const fetchFn = fetchImpl || globalThis.fetch.bind(globalThis);
  let probeUrl = `${amazonConfig.marketplace.origin}/s?k=product`;
  let pendingClear = null;
  let delayNote = "";
  const captchaTimes = [];

  function noteCaptcha() {
    const now = Date.now();
    const recent = captchaTimes.filter((time) => now - time < WINDOW_MS);
    recent.push(now);
    captchaTimes.splice(0, captchaTimes.length, ...recent);
    if (captchaTimes.length >= 3) {
      captchaTimes.splice(0, captchaTimes.length);
      pacer.doubleDelays();
      delayNote = ` Delays are now ${pacer.describe()}.`;
      log("warn", `Amazon asked for 3 checks in 10 minutes. Delays are now ${pacer.describe()} so the run stays gentle.`);
    }
  }

  async function waitUntilClear() {
    let attempt = 0;
    while (!control.isStopping()) {
      await sleep(pollMs, control);
      if (control.isStopping()) throw new StoppedError();
      attempt += 1;
      onCaptcha({ mode: "waiting", message: `${CAPTCHA_MESSAGE} Still checking… attempt ${attempt}.${delayNote}` });
      try {
        const response = await fetchFn(probeUrl, {
          credentials: "include",
          cache: "no-store",
          redirect: "follow",
        });
        const html = await response.text();
        const verdict = detectBlock({
          html,
          status: response.status,
          url: response.url || probeUrl,
          kind: "search",
        });
        if (!verdict.blocked) {
          onCaptcha({ mode: "resuming", message: "Thanks, resuming…" });
          if (resumeNoticeMs > 0) await sleep(resumeNoticeMs);
          const next = control.resumeFromCaptcha();
          onCaptcha({ mode: "hide" });
          if (next === "paused") await control.checkpoint();
          return;
        }
      } catch (error) {
        if (error instanceof StoppedError || error?.name === "StoppedError") throw error;
        log("warn", `Still waiting on Amazon (${error.message}).`);
      }
    }
    throw new StoppedError();
  }

  async function waitForPerson(openUrl) {
    if (!pendingClear) {
      pendingClear = (async () => {
        noteCaptcha();
        control.enterCaptcha();
        onCaptcha({ mode: "show", message: `${CAPTCHA_MESSAGE}${delayNote}` });
        log("warn", `${CAPTCHA_MESSAGE}${delayNote}`);
        try {
          await openTab(openUrl);
        } catch (error) {
          log("warn", `Could not open Amazon (${error.message}).`);
        }
        await waitUntilClear();
        log("info", "Thanks, resuming…");
      })().finally(() => {
        pendingClear = null;
      });
    }
    await pendingClear;
  }

  async function fetchHtml(url, options = {}) {
    const kind = options.kind || "other";
    const paced = options.paced !== false;
    while (true) {
      if (control) await control.checkpoint();
      const run = () =>
        fetchFn(url, {
          method: options.method || "GET",
          credentials: "include",
          cache: "no-store",
          redirect: "follow",
          headers: options.headers,
          body: options.body,
        });
      const response = paced && pacer ? await pacer.schedule(run, control) : await run();
      const html = await response.text();
      const finalUrl = response.url || url;
      const verdict = detectBlock({ html, status: response.status, url: finalUrl, kind });
      if (!verdict.blocked) {
        return { html, status: response.status, url: finalUrl, headers: response.headers, doc: parseHtml(html) };
      }
      const openUrl = /amazon\.com/i.test(finalUrl) ? finalUrl : url;
      await waitForPerson(openUrl);
    }
  }

  return {
    fetchHtml,
    setProbeUrl(url) {
      if (url) probeUrl = url;
    },
  };
}
