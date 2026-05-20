
import { ddp } from './ddp-connection.js';
import './panel.js';
import './settings-daemon.js';
import './settings-subscription.js';
import './external-messages.js';
import { currentTier, onTierChange, resolveWorkspaceUrl } from './tier-detection.js';
import { getActiveTab } from './active-tab.js';
import { daemonGet, daemonPost } from './daemon-proxy.js';
import './session-token.js';  // primes MCP token on SW startup

globalThis.koad = { asof: new Date(), daemon: ddp}

// --- Panel state ----------------------------------------------------------
//
// The side panel and popup ask for current tier + workspace URL +
// matching corpus items via `action: getPanelState`.
//
// Tier comes from tier-detection.js (SPEC-196 §3 sequential HTTP probe).
// Workspace URL comes from chrome.storage.local.workspaceUrl, or derived
// from the active tier's host:port if unset.
// Active tab comes from active-tab.js — used for SPEC-196 §6 (tab context)
// and §8 (corpus-url surface).
//
// Corpus actionable list returns [] until /api/corpus/by-url is exposed
// on the daemon. Once it is, this function calls it with the active tab
// URL and returns the matching items.

async function getPanelState() {
  const tier = currentTier() || 3;
  const workspaceUrl = (tier === 3) ? null : await resolveWorkspaceUrl();
  const activeTab = await getActiveTab();

  // Cached sovereign profile (SPEC-196 §5). Populated on last successful
  // connection; empty until the cache layer is wired.
  const profileStored = await chrome.storage.local.get('sovereignProfile');
  const profile = profileStored.sovereignProfile || null;

  // SPEC-196 §8 — fetch corpus items matching the active tab URL.
  // Daemon may not expose /api/corpus/by-url yet; offline / not-found / error
  // all degrade to an empty list.
  let actionable = [];
  if (tier !== 3 && activeTab && activeTab.url) {
    const result = await daemonGet('/api/corpus/by-url', { url: activeTab.url });
    if (result.status === 'ok' && Array.isArray(result.data)) {
      actionable = result.data;
    }
  }

  return {
    ok: true,
    tier,
    workspaceUrl,
    daemonUrl: workspaceUrl,  // backward-compat alias for the panel
    activeTab,
    profile: tier === 3 ? profile : null,
    actionable,
  };
}

// Broadcast tier changes so any open panel/popup re-renders.
onTierChange((tier) => {
  console.log('tier change → broadcasting panelStateChanged');
  chrome.runtime.sendMessage({ action: 'panelStateChanged', reason: 'tier', tier })
    .catch(() => { /* no listener — fine */ });
});

// This function is called when the button is clicked
function copyTabs() {
  // Query all tabs in the current window
  chrome.tabs.query({currentWindow: true}, function(tabs) {
    // Map tabs to a JSON array
    let tabsInfo = tabs.map(tab => {
      return {tab: tab.id, url: tab.url, title: tab.title};
    });

    // Copy the JSON array to the clipboard
    console.log(`list has ${tabsInfo.length} items in it.`);
    console.log({tabsInfo})
    copyToClipboard(JSON.stringify(tabsInfo));
  });
}

// To be injected to the active tab
function contentCopy(text) {
  navigator.clipboard.writeText(text);
}

async function copyToClipboard(content, tab) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: contentCopy,
    args: [content],
  });
}

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

async function sendRequestToDaemon(data) {
  // Resolve daemon URL from stored lighthouse config (same source as DDP).
  // Uses HTTP scheme alongside the DDP ws scheme — same host:port, /passenger/post path.
  const stored = await chrome.storage.local.get('lighthouse');
  const lh = Object.assign({ host: '10.10.10.10', port: 28282, proto: 'ws' }, stored.lighthouse);
  const httpProto = lh.proto === 'wss' ? 'https' : 'http';
  const url = `${httpProto}://${lh.host}:${lh.port}/passenger/post`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const responseData = await response.json();
    console.log('Daemon response:', responseData);
    return responseData;
  } catch (error) {
    console.error('Error communicating with daemon:', error);
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPanelState") {
    getPanelState().then(sendResponse).catch((err) => {
      console.warn('getPanelState failed:', err);
      sendResponse({ ok: false, error: String(err && err.message || err) });
    });
    return true;
  }

  // SPEC-196 §6 — window.__koad_io__.injectContext(...) from a page.
  // The SW forwards the payload to the daemon (which routes it into the
  // active entity's context bubble). 401/404/offline degrade gracefully.
  if (request.action === "injectContext") {
    daemonPost('/api/context/inject', {
      origin: request.origin,
      payload: request.payload,
      activeTabHint: sender.tab ? { id: sender.tab.id, url: sender.tab.url, title: sender.tab.title } : null,
    }).then(result => sendResponse({ ok: result.status === 'ok', ...result }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // SPEC-196 §8 — window.__koad_io__.corpusByUrl(url) from a page.
  if (request.action === "corpusByUrl") {
    const url = (request.payload && request.payload.url) || (sender.tab && sender.tab.url);
    if (!url) {
      sendResponse({ ok: false, error: 'url required' });
      return true;
    }
    daemonGet('/api/corpus/by-url', { url })
      .then(result => sendResponse({ ok: result.status === 'ok', ...result }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // Page-triggered panel refresh — userscript notifies the HUD that state
  // changed (e.g. it just pushed context, so the actionable list might shift).
  if (request.action === "panelRefresh") {
    chrome.runtime.sendMessage({ action: 'panelStateChanged', reason: 'page' }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === "getTabs") {
    chrome.tabs.query({currentWindow: true}, (tabs) => {
      let tabsInfo = tabs.map(tab => {
        return {tab: tab.id, url: tab.url, title: tab.title};
      });
      sendResponse(tabsInfo);
    });
    return true; // Indicates that the response is asynchronous
  }

  if (request.action === "getCurrentTab") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        sendResponse({url: tabs[0].url, title: tabs[0].title});
      }
    });
    return true; // Indicates that the response is asynchronous
  }

  if (request.action === "discardTabs") {
    chrome.tabs.query({currentWindow: true}, async (tabs) => {
      let count = 0;
      for (const tab of tabs) {
        try {
          await chrome.tabs.discard(tab.id);
          count++;
        } catch (e) {
          console.log('Could not discard tab:', tab.id, e.message);
        }
      }
      sendResponse({count: count});
    });
    return true;
  }

  if (request.action === "showOptions") {
    console.log('showing page options');
    chrome.runtime.openOptionsPage();
  } else if (request.action === "sendToDaemon") {
    console.log("Button clicked in content script");

    // Implement logic to handle the click here.
    // For example, communicate with the koad:io daemon if necessary.
    // This might involve sending a message to the daemon via WebSocket, HTTP request, or any other protocol your daemon supports.

    // Placeholder for sending a request to the daemon
    if(request.videoId) sendRequestToDaemon({youtube: request.videoId});

    // Optionally, send a response back to the content script
    sendResponse({status: "received"});
  }
});

chrome.contextMenus.onClicked.addListener((item, tab) => {
  console.log('context menu item clicked')
  console.log({item, tab});
});



console.log('koad:io dark passenger - background worker now running')
