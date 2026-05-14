// session-tab-state.js
// Tab state helpers wrapping chrome.storage.session.
// session storage is cleared when the browser session ends (browser close / restart)
// but survives service worker suspension — unlike in-memory variables.
// Use for state that must survive service worker wake cycles but doesn't need
// to persist across browser restarts (active tab URL, selected entity, etc.).

const PREFIX = 'tab:';

export async function getTabState(tabId) {
    const key = PREFIX + tabId;
    const stored = await chrome.storage.session.get(key);
    return stored[key] || {};
}

export async function setTabState(tabId, patch) {
    const key = PREFIX + tabId;
    const existing = await getTabState(tabId);
    await chrome.storage.session.set({ [key]: Object.assign({}, existing, patch) });
}

export async function clearTabState(tabId) {
    const key = PREFIX + tabId;
    await chrome.storage.session.remove(key);
}

// Auto-clean session state when a tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabState(tabId).catch(() => {});
});
