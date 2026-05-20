// Side panel — the Dark Passenger workspace. Enabled on every tab so the panel
// rides with koad wherever he goes. Path is `panel.html` (declared in
// manifest.json side_panel.default_path). The panel itself decides what to
// render based on the current connection tier (SPEC-196 §2).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('sidePanel.setPanelBehavior failed:', error));

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'panel.html',
      enabled: true,
    });
  } catch (err) {
    console.error('sidePanel.setOptions failed for tab', tabId, err);
  }
});