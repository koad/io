// active-tab.js
//
// Tracks the active tab — URL, title, id — and persists to session storage.
// Foundation for SPEC-196 §6 (tab context injection): the active tab context
// is what gets injected into the entity's context window when the panel
// queries corpus matches or when a userscript pushes context.
//
// Emits a 'panelStateChanged' runtime message whenever the active tab changes,
// so any open side panel re-fetches its state.

const SESSION_KEY = 'activeTab';

async function setActiveTab(tab) {
  if (!tab || !tab.url) return;
  const snapshot = {
    id: tab.id,
    url: tab.url,
    title: tab.title || '',
    capturedAt: Date.now(),
  };
  await chrome.storage.session.set({ [SESSION_KEY]: snapshot });
  // Broadcast to any open extension page (popup / side panel).
  chrome.runtime.sendMessage({ action: 'panelStateChanged', reason: 'tab' }).catch(() => {});
}

async function getActiveTab() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

// Track tab activation
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setActiveTab(tab);
  } catch (e) {
    // Tab may have closed between activation and get — ignore.
  }
});

// Track URL changes within the active tab
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab || !tab.active) return;
  if (!info.url && info.status !== 'complete') return;
  await setActiveTab(tab);
});

// Track window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await setActiveTab(tab);
  } catch (e) {
    // Window may have closed — ignore.
  }
});

// Prime the cache on SW startup with whatever's currently focused.
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await setActiveTab(tab);
  } catch (e) {
    // No tabs yet — wait for the first onActivated.
  }
})();

export { getActiveTab };
