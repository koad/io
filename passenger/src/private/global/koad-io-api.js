// koad-io-api.js — runs in MAIN world (page world) on every URL.
//
// SPEC-196 §6 (tab context injection) + §9 (sovereign userscript platform).
//
// Exposes `window.__koad_io__` to page scripts and userscripts. Because this
// runs in page world, it has NO chrome.runtime access. It posts to a
// companion isolated-world bridge (koad-io-bridge.js) via window.postMessage.
// The bridge forwards to the service worker, which routes through
// daemon-proxy.js with the MCP session token attached.
//
//   page-world API   →  window.postMessage  →  isolated-world bridge
//                                                ↓
//                                   chrome.runtime.sendMessage
//                                                ↓
//                                       service worker handlers

(function () {
	if (window.__koad_io__) return;  // idempotent across reinjections

	const BRIDGE_SOURCE = 'koad-io-api';
	const BRIDGE_RESPONSE = 'koad-io-api-response';
	const pending = new Map();
	let counter = 0;

	function correlationId() {
		return `koad-${Date.now()}-${++counter}`;
	}

	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		const msg = event.data;
		if (!msg || msg.source !== BRIDGE_RESPONSE) return;
		const resolver = pending.get(msg.id);
		if (!resolver) return;
		pending.delete(msg.id);
		resolver(msg.response);
	});

	function call(action, payload) {
		const id = correlationId();
		return new Promise((resolve) => {
			pending.set(id, resolve);
			window.postMessage({ source: BRIDGE_SOURCE, id, action, payload }, '*');
			// Hard timeout — bridge or SW unreachable
			setTimeout(() => {
				if (pending.has(id)) {
					pending.delete(id);
					resolve({ ok: false, error: 'bridge timeout' });
				}
			}, 10000);
		});
	}

	window.__koad_io__ = {
		// SPEC-196 §6 — push structured context to the entity's active session.
		injectContext(payload) {
			if (!payload || typeof payload !== 'object') {
				return Promise.resolve({ ok: false, error: 'payload required' });
			}
			return call('injectContext', payload);
		},

		// SPEC-196 §8 — corpus lookup for the current page URL by default.
		corpusByUrl(url) {
			return call('corpusByUrl', { url: url || location.href });
		},

		// Tell the popup/panel to refresh.
		notify(reason) {
			return call('panelRefresh', { reason });
		},

		// Current panel state (tier, active tab, etc.).
		state() {
			return call('getPanelState', {});
		},

		version: '0.1.0',
	};

	window.dispatchEvent(new Event('koad-io-ready'));
})();
