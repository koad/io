/**
 * external-messages.js
 *
 * Handles messages from externally-connectable origins (Meteor dev app and
 * production lighthouses) via chrome.runtime.onMessageExternal.
 *
 * Allowed origins are declared in manifest.json > externally_connectable.matches.
 * Chrome enforces the origin filter before this handler is invoked — no manual
 * origin check needed, but we still validate message shape defensively.
 *
 * Message protocol:
 *   { type: string, payload?: any }
 *
 * Response protocol:
 *   { ok: true, ...data }  on success
 *   { ok: false, error: string }  on failure
 */

import { ddp } from './ddp-connection.js';

const EXTENSION_ID = chrome.runtime.id;

// --- Handler registry ---

const handlers = {

  /**
   * ping — health check.
   * Returns the extension ID and current DDP connection state.
   */
  ping(_payload) {
    const connected = !!(ddp.sock && ddp.sock.readyState === WebSocket.OPEN);
    return { extensionId: EXTENSION_ID, ddpConnected: connected };
  },

  /**
   * get-extension-id — lets the client confirm the link and store the ID.
   */
  'get-extension-id'(_payload) {
    return { extensionId: EXTENSION_ID };
  },

  /**
   * daemon-query — calls a DDP method on the connected daemon and returns the result.
   *
   * Expected payload: { method: string, params?: any[] }
   */
  async 'daemon-query'(payload) {
    if (!payload || typeof payload.method !== 'string') {
      throw new Error('daemon-query requires payload.method (string)');
    }
    if (!ddp.sock || ddp.sock.readyState !== WebSocket.OPEN) {
      throw new Error('DDP not connected');
    }
    const result = await ddp.call(payload.method, ...(payload.params || []));
    return { result };
  },

  /**
   * chrome-api — bridges a safe subset of Chrome APIs to the external page.
   *
   * Supported api values:
   *   "tabs.query"       — payload: { queryInfo }
   *   "storage.session.get" — payload: { keys }
   *   "storage.session.set" — payload: { items }
   *   "storage.local.get"   — payload: { keys }
   *
   * Dangerous or privileged APIs (scripting.executeScript, etc.) are not exposed.
   */
  async 'chrome-api'(payload) {
    if (!payload || typeof payload.api !== 'string') {
      throw new Error('chrome-api requires payload.api (string)');
    }
    switch (payload.api) {
      case 'tabs.query': {
        const tabs = await chrome.tabs.query(payload.queryInfo || {});
        return { tabs };
      }
      case 'storage.session.get': {
        const data = await chrome.storage.session.get(payload.keys || null);
        return { data };
      }
      case 'storage.session.set': {
        if (!payload.items || typeof payload.items !== 'object') {
          throw new Error('storage.session.set requires payload.items (object)');
        }
        await chrome.storage.session.set(payload.items);
        return {};
      }
      case 'storage.local.get': {
        const data = await chrome.storage.local.get(payload.keys || null);
        return { data };
      }
      default:
        throw new Error(`chrome-api: unsupported api "${payload.api}"`);
    }
  },
};

// --- Shared dispatch helper ---

function dispatchMessage(message, sendResponse) {
  if (!message || typeof message.type !== 'string') {
    sendResponse({ ok: false, error: 'invalid message shape — expected { type, payload? }' });
    return false;
  }

  const handler = handlers[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: `unknown message type "${message.type}"` });
    return false;
  }

  Promise.resolve()
    .then(() => handler(message.payload))
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // keep the message channel open for async response
}

// --- External listener (externally_connectable — kept for any future use) ---

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  return dispatchMessage(message, sendResponse);
});

// --- Internal listener (content script bridge via passenger-bridge.js) ---
// Content scripts use chrome.runtime.sendMessage (internal), not sendMessageExternal.
// We filter by message shape so we don't interfere with the action-based handlers
// already registered in index.js (getTabs, getCurrentTab, etc.).

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle type-based protocol messages; action-based ones are handled in index.js.
  if (!message || typeof message.type !== 'string') return false;
  // Ignore messages that come from the extension's own pages (popup, options, etc.)
  // to avoid double-handling. Content scripts have a tab in sender.
  if (!sender.tab) return false;
  return dispatchMessage(message, sendResponse);
});

console.log('koad:io dark-passenger — message handlers registered (internal + external)');
