/**
 * passenger-bridge.js — content script relay
 *
 * Bridges the page (window.postMessage) ↔ service worker (chrome.runtime.sendMessage).
 *
 * Content scripts are part of the extension and DO have chrome.runtime access,
 * unlike externally_connectable which fails on IP-addressed origins.
 *
 * Protocol (page → content script → service worker):
 *   window.postMessage({
 *     source: 'passenger-bridge',
 *     id: '<correlation-id>',   // caller-supplied, echoed in response
 *     type: '<handler-type>',
 *     payload: <any>
 *   }, '*')
 *
 * Protocol (service worker → content script → page):
 *   window.postMessage({
 *     source: 'passenger-bridge-response',
 *     id: '<correlation-id>',
 *     response: { ok: boolean, ...data }
 *   }, '*')
 */

window.addEventListener('message', (event) => {
  // Only handle messages from this page, not from other frames.
  if (event.source !== window) return;

  const msg = event.data;
  if (!msg || msg.source !== 'passenger-bridge') return;
  if (typeof msg.type !== 'string') return;

  const correlationId = msg.id;

  chrome.runtime.sendMessage(
    { type: msg.type, payload: msg.payload },
    (response) => {
      if (chrome.runtime.lastError) {
        // Service worker not reachable — send a clean error back to the page.
        window.postMessage({
          source: 'passenger-bridge-response',
          id: correlationId,
          response: { ok: false, error: chrome.runtime.lastError.message || 'service worker unreachable' },
        }, '*');
        return;
      }

      window.postMessage({
        source: 'passenger-bridge-response',
        id: correlationId,
        response: response || { ok: false, error: 'no response from service worker' },
      }, '*');
    }
  );
});

console.log('koad:io dark-passenger — content script bridge active');
