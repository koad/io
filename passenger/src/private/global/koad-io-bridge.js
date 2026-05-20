// koad-io-bridge.js — isolated-world content script, runs on every URL.
//
// Companion to koad-io-api.js (page world). Listens for window.postMessage
// from the page API, forwards to the service worker via chrome.runtime,
// echoes the response back via window.postMessage so the page-world API
// resolves its promise.
//
//   page-world API   →  window.postMessage  →  this bridge (isolated world)
//                                                ↓
//                                   chrome.runtime.sendMessage
//                                                ↓
//                                       service worker handlers
//
// Distinct from `shims/passenger-bridge.js` — that one is lighthouse-domain
// only and uses a different protocol token (the Meteor app's RPC envelope).
// This bridge is the universal koad:io API surface for any page.

const BRIDGE_SOURCE = 'koad-io-api';
const BRIDGE_RESPONSE = 'koad-io-api-response';

window.addEventListener('message', (event) => {
	if (event.source !== window) return;
	const msg = event.data;
	if (!msg || msg.source !== BRIDGE_SOURCE) return;
	if (typeof msg.action !== 'string') return;

	const correlationId = msg.id;

	chrome.runtime.sendMessage(
		{ action: msg.action, payload: msg.payload, origin: location.origin },
		(response) => {
			if (chrome.runtime.lastError) {
				window.postMessage({
					source: BRIDGE_RESPONSE,
					id: correlationId,
					response: { ok: false, error: chrome.runtime.lastError.message || 'service worker unreachable' },
				}, '*');
				return;
			}
			window.postMessage({
				source: BRIDGE_RESPONSE,
				id: correlationId,
				response: response || { ok: false, error: 'no response' },
			}, '*');
		},
	);
});

console.log('koad:io-dark-passenger — universal API bridge active');
