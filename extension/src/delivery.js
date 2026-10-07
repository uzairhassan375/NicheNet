import { absoluteUrl, amazonConfig } from "./amazonConfig.js";
import { extractCsrfToken, readDeliveryText, textContainsZip } from "./parse.js";

function cookieSet(cookies, details) {
  return new Promise((resolve, reject) => {
    cookies.set(details, (cookie) => {
      const message = globalThis.chrome?.runtime?.lastError?.message;
      if (message) {
        reject(new Error(message));
        return;
      }
      if (!cookie && cookies.failMessage) {
        reject(new Error(cookies.failMessage));
        return;
      }
      resolve(cookie || null);
    });
  });
}

export async function setAmazonPrefs(cookies, marketplace = amazonConfig.marketplace) {
  const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const base = {
    url: `${marketplace.origin}/`,
    domain: marketplace.cookieDomain,
    path: "/",
    secure: true,
    expirationDate,
  };
  await cookieSet(cookies, { ...base, name: marketplace.currencyCookie, value: marketplace.currency });
  await cookieSet(cookies, { ...base, name: marketplace.languageCookie, value: marketplace.language });
}

function glowAccepted(status, body) {
  if (status < 200 || status >= 300) return false;
  if (/validateCaptcha|robot check/i.test(body || "")) return false;
  try {
    const data = JSON.parse(body);
    if (data.isValidAddress === false || data.isValidAddress === 0) return false;
    if (data.successful === 0 || data.success === false) return false;
    return true;
  } catch {
    return false;
  }
}

async function readToken(client, marketplace) {
  for (const path of amazonConfig.delivery.csrfPaths) {
    const page = await client.fetchHtml(absoluteUrl(path, marketplace), { kind: "json", paced: false });
    const headerToken = page.headers?.get?.("anti-csrftoken-a2z") || page.headerToken || "";
    const token = extractCsrfToken(page.html, headerToken);
    if (token) return token;
  }
  return "";
}

async function postZip(client, marketplace, zip, token) {
  const payload = {
    locationType: "LOCATION_INPUT",
    zipCode: zip,
    storeContext: "generic",
    deviceType: "web",
    pageType: "Gateway",
    actionSource: "glow",
  };
  for (const path of amazonConfig.delivery.jsonChangePaths) {
    const page = await client.fetchHtml(absoluteUrl(path, marketplace), {
      kind: "json",
      paced: false,
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        accept: "application/json, text/plain, */*",
        "anti-csrftoken-a2z": token,
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
    });
    if (glowAccepted(page.status, page.html)) return true;
  }
  const form = new URLSearchParams(payload);
  for (const path of amazonConfig.delivery.formChangePaths) {
    const page = await client.fetchHtml(absoluteUrl(path, marketplace), {
      kind: "json",
      paced: false,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/plain, */*",
        "anti-csrftoken-a2z": token,
        "x-requested-with": "XMLHttpRequest",
      },
      body: form.toString(),
    });
    if (glowAccepted(page.status, page.html)) return true;
  }
  return false;
}

export function manualZipMessage(zip) {
  return `Click "Deliver to" at the top left, enter ZIP ${zip}, click Apply, then come back and press Continue.`;
}

export async function verifyDeliveryZip(client, zip, marketplace = amazonConfig.marketplace) {
  const page = await client.fetchHtml(`${marketplace.origin}/`, { kind: "home", paced: false });
  const delivery = readDeliveryText(page.doc);
  const text = delivery.line2 || delivery.combined;
  if (!textContainsZip(delivery.combined, zip)) {
    return { ok: false, text, reason: text ? `Amazon shows "${text}"` : "Amazon did not show a delivery location" };
  }
  return { ok: true, text, reason: "" };
}

/**
 * Sets USD, then repeats the Deliver-to popover request (CSRF token + ZIP).
 * If Amazon rejects that, the caller shows the manual steps and waits.
 * Search must not start until the ZIP is visible on the homepage.
 */
export async function prepareDelivery({
  zip,
  client,
  cookies,
  confirmManually,
  log = () => {},
  onStatus = () => {},
  marketplace = amazonConfig.marketplace,
}) {
  onStatus("Opening Amazon to confirm the delivery location…");
  await client.fetchHtml(`${marketplace.origin}/`, { kind: "home", paced: false });

  onStatus("Setting currency to USD…");
  try {
    await setAmazonPrefs(cookies, marketplace);
    log("info", `Currency cookie ${marketplace.currencyCookie} set to ${marketplace.currency}.`);
  } catch (error) {
    log("warn", `Could not set the currency cookie (${error.message}).`);
  }

  onStatus(`Setting Deliver to ${zip}…`);
  let glowOk = false;
  try {
    const token = await readToken(client, marketplace);
    if (!token) throw new Error("Amazon did not return a delivery token");
    glowOk = await postZip(client, marketplace, zip, token);
    if (!glowOk) throw new Error("Amazon did not accept the ZIP request");
    log("info", `Asked Amazon to deliver to ${zip}.`);
  } catch (error) {
    log("warn", `${error.message}. Set the ZIP on Amazon, then continue.`);
    onStatus(manualZipMessage(zip));
    await confirmManually(zip);
    glowOk = true;
  }

  onStatus("Checking the delivery location…");
  let verified = await verifyDeliveryZip(client, zip, marketplace);
  if (!verified.ok) {
    log("warn", `Delivery check failed (${verified.reason}).`);
    onStatus(manualZipMessage(zip));
    await confirmManually(zip);
    verified = await verifyDeliveryZip(client, zip, marketplace);
  }
  if (!verified.ok) {
    throw new Error(`Still not delivering to ${zip}. ${verified.reason}.`);
  }
  return verified;
}
