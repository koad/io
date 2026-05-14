/**
 * extension-bridge.js
 *
 * Client-side bridge for the Meteor dev app (and production lighthouses) to
 * communicate with the dark-passenger service worker via externally_connectable.
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

// Extension ID for the dark-passenger extension.
// Keep in sync with the ID shown on chrome://extensions for the loaded unpacked build.
const EXTENSION_ID = 'mnjmiafkhiohmdgnhgpkkdkojjaepoaf';

let _availabilityCache = null; // null = not yet checked, true/false = result

/**
 * Returns true if the extension is installed and responding to pings.
 * Result is cached for the lifetime of the page.
 */
async function isAvailable() {
  if (_availabilityCache !== null) return _availabilityCache;

  // chrome.runtime is absent in non-Chrome or when extension is not installed
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    _availabilityCache = false;
    return false;
  }

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
 * @param {string} type     Message type (see external-messages.js handler registry)
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
 * Internal: sends a raw chrome.runtime.sendMessage and wraps it in a Promise.
 * Times out after `timeoutMs` (default 5000ms).
 *
 * @param {string}  type
 * @param {any}     payload
 * @param {number}  [timeoutMs=5000]
 */
function _rawSend(type, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null); // timeout = treat as unavailable, not an error
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type, payload }, (response) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (chrome.runtime.lastError) {
          // Extension not installed or not connectable — not an error worth throwing
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (err) {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }
  });
}

/**
 * Resets the availability cache.
 * Call this if the user may have installed/removed the extension since page load.
 */
function resetCache() {
  _availabilityCache = null;
}

export const extensionBridge = { isAvailable, send, resetCache, EXTENSION_ID };
