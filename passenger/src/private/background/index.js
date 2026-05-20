
import { ddp } from './ddp-connection.js';
import './panel.js';
import './settings-daemon.js';
import './settings-subscription.js';
import './external-messages.js';

globalThis.koad = { asof: new Date(), daemon: ddp}

// --- Panel state ----------------------------------------------------------
//
// The side panel asks for the current connection tier + workspace URL +
// matching corpus items via `action: getPanelState`. Until full SPEC-196
// tier detection lands, we infer tier from the DDP socket state and
// derive the workspace URL from the lighthouse config.
//
// Tier mapping (SPEC-196 §3):
//   1 = ZeroTier daemon (10.10.10.10), 2 = public lighthouse, 3 = offline.
//
// The corpus-url surface (SPEC-196 §8) is wired in once the daemon exposes
// /api/corpus/by-url. Until then, panelState returns an empty actionable list
// so the panel renders the "no actionable methods on this page" message.

async function getPanelState() {
  const stored = await chrome.storage.local.get('lighthouse');
  const lh = Object.assign({ host: '10.10.10.10', port: 28282, proto: 'ws' }, stored.lighthouse);
  const connected = !!(ddp && ddp.sock && ddp.sock.readyState === WebSocket.OPEN);

  // Tier inference: until SPEC-196 §3.2 detection lands, treat any open DDP
  // socket as Tier 1 (ZeroTier) if host is the kingdom address, otherwise
  // Tier 2 (public lighthouse). Closed socket → Tier 3.
  let tier = 3;
  if (connected) tier = (lh.host === '10.10.10.10' || lh.host === '127.0.0.1') ? 1 : 2;

  const httpProto = lh.proto === 'wss' ? 'https' : 'http';
  const daemonUrl = `${httpProto}://${lh.host}:${lh.port}/`;

  // Cached sovereign profile (SPEC-196 §5). Populated on last successful
  // connection; empty until the cache layer is wired.
  const profileStored = await chrome.storage.local.get('sovereignProfile');
  const profile = profileStored.sovereignProfile || null;

  return {
    ok: true,
    tier,
    daemonUrl: tier === 3 ? null : daemonUrl,
    profile: tier === 3 ? profile : null,
    actionable: [],  // SPEC-196 §8 — populated via /api/corpus/by-url once exposed
  };
}

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
