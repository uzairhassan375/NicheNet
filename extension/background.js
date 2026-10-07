// Service worker only opens the finder tab. Searching runs in finder.html.
// A service worker is killed when idle and has no DOMParser, so it must not
// fetch or parse product pages.

// tabs: reuse the open finder tab instead of opening a second one.
chrome.action.onClicked.addListener(async () => {
  const finderUrl = chrome.runtime.getURL("finder.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url && tab.url.startsWith(finderUrl));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: finderUrl });
});
