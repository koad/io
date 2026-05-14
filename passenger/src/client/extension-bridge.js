/**
 * extension-bridge.js
 *
 * Client-side bridge for the Meteor dev app (and production lighthouses) to
 * communicate with the dark-passenger service worker via the content script relay.
 *
 * Transport: window.postMessage ↔ content script (passenger-bridge.js) ↔
 *            chrome.runtime.sendMessage ↔ service worker
 *
 * The original externally_connectable approach (chrome.runtime.sendMessage
 * from the page) fails on IP-addressed origins because Chrome does not inject
 * chrome.runtime into those pages. The content script bridge works everywhere
 * the extension declares a match in manifest.json > content_scripts.
 *
 * Usage (in any Meteor client file):
 *
 *   import { extensionBridge } from '/client/extension-bridge.js';
 *
 *   // Check availability (cached after first call)
 *   const available = await extensionBridge.isAvailable();
 *
 *   // Send a message
 *   const result = await extensionBridge.send('ping');
 *   const tabs   = await extensionBridge.send('chrome-api', { api: 'tabs.query', queryInfo: {} });
 *   const dq     = await extensionBridge.send('daemon-query', { method: 'passenger.check.duty' });
 *
 * Falls back gracefully when the extension is not installed:
 *   isAvailable() → false
 *   send(...)     → null (no error thrown)
 */

let _availabilityCache = null; // null = not yet checked, true/false = result
let _pendingRequests = {};     // correlationId → { resolve, timer }

// Listen once for all responses from the content script bridge.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'passenger-bridge-response') return;
    const { id, response } = event.data;
    const pending = _pendingRequests[id];
    if (!pending) return;
    clearTimeout(pending.timer);
    delete _pendingRequests[id];
    pending.resolve(response);
  });
}

/**
 * Returns true if the extension is installed and responding to pings.
 * Result is cached for the lifetime of the page.
 */
async function isAvailable() {
  if (_availabilityCache !== null) return _availabilityCache;

  try {
    const response = await _rawSend('ping', undefined, 2000);
    _availabilityCache = !!(response && response.ok);
  } catch (_err) {
    _availabilityCache = false;
  }
  return _availabilityCache;
}

/**
 * Sends a message to the extension service worker.
 *
 * Returns the response data (with `.ok` stripped) on success, or null if the
 * extension is unavailable. Throws only on unexpected protocol errors.
 *
 * @param {string} type      Message type (see external-messages.js handler registry)
 * @param {any}    [payload] Optional message payload
 * @returns {Promise<any|null>}
 */
async function send(type, payload) {
  const available = await isAvailable();
  if (!available) return null;

  const response = await _rawSend(type, payload);
  if (!response) return null;
  if (!response.ok) {
    console.warn(`[extension-bridge] error from extension: ${response.error}`);
    return null;
  }
  const { ok: _ok, ...data } = response;
  return data;
}

/**
 * Internal: sends a message via window.postMessage to the content script relay
 * and waits for the matching response. Times out after timeoutMs (default 5000ms).
 *
 * @param {string}  type
 * @param {any}     payload
 * @param {number}  [timeoutMs=5000]
 * @returns {Promise<object|null>}
 */
function _rawSend(type, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const id = _correlationId();

    const timer = setTimeout(() => {
      delete _pendingRequests[id];
      resolve(null); // timeout = treat as unavailable, not an error
    }, timeoutMs);

    _pendingRequests[id] = { resolve, timer };

    window.postMessage({
      source: 'passenger-bridge',
      id,
      type,
      payload,
    }, '*');
  });
}

/**
 * Generates a short unique correlation ID.
 */
function _correlationId() {
  return `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Resets the availability cache.
 * Call this if the user may have installed/removed the extension since page load.
 */
function resetCache() {
  _availabilityCache = null;
}

export const extensionBridge = { isAvailable, send, resetCache };
