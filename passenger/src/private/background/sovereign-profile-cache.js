// sovereign-profile-cache.js
//
// SPEC-196 §5 — Tier 3 fallback identity. The extension never holds private
// keys, but it caches the operator's public sovereign profile so the offline
// view can still render identity (handle, sigchain tip, public keys, last
// emission hint, etc.).
//
// Cache lifecycle:
//   - Refresh whenever tier transitions 3 → 1/2 (we have a daemon again)
//   - Refresh every 30 minutes while tier 1/2 is active
//   - Stored in chrome.storage.local (survives browser restarts; this is
//     public identity data, not secret material)
//
// If the daemon endpoint doesn't exist yet, the cache stays empty and the
// fallback view shows a "no cached profile" message.

import { currentTier, onTierChange } from './tier-detection.js';
import { daemonGet } from './daemon-proxy.js';

const STORAGE_KEY = 'sovereignProfile';
const REFRESH_MS = 30 * 60 * 1000;  // 30 minutes
const ENDPOINT = '/api/sovereign-profile';

let _refreshTimer = null;

async function fetchAndCache() {
	const tier = currentTier();
	if (tier !== 1 && tier !== 2) return;
	const result = await daemonGet(ENDPOINT);
	if (result.status !== 'ok' || !result.data) {
		// Endpoint not exposed yet, or returned nothing — leave existing cache as-is.
		return;
	}
	await chrome.storage.local.set({
		[STORAGE_KEY]: Object.assign({}, result.data, { cachedAt: Date.now() }),
	});
	console.log('sovereign-profile-cache: refreshed');
}

function startRefreshTimer() {
	stopRefreshTimer();
	_refreshTimer = setInterval(() => {
		fetchAndCache().catch((e) => console.warn('profile refresh failed', e));
	}, REFRESH_MS);
}

function stopRefreshTimer() {
	if (_refreshTimer !== null) {
		clearInterval(_refreshTimer);
		_refreshTimer = null;
	}
}

// React to tier transitions
onTierChange((tier) => {
	if (tier === 1 || tier === 2) {
		fetchAndCache().catch((e) => console.warn('profile fetch failed', e));
		startRefreshTimer();
	} else {
		stopRefreshTimer();
	}
});

// Prime on startup if we already have a tier
const t = currentTier();
if (t === 1 || t === 2) {
	fetchAndCache().catch(() => {});
	startRefreshTimer();
}
