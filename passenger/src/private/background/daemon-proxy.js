// daemon-proxy.js
//
// SPEC-196 §2 — service worker as proxy + auth layer.
//
// Every daemon HTTP request flows through here. The proxy:
//   - resolves the active tier (Tier 1 ZeroTier daemon, Tier 2 public lighthouse)
//   - prepends the tier's base URL to the request path
//   - injects the MCP session token as `Authorization: Bearer <token>`
//   - retries once on 401 with a rotated token
//   - returns null when Tier 3 (no daemon reachable) — callers handle gracefully
//
// The side panel and popup never see the proxy; they call the daemon via the
// SW message protocol. Content scripts in pages reach the proxy via the bridge.

import { currentTier } from './tier-detection.js';
import { getToken, rotateToken } from './session-token.js';

const DEFAULT_TIER_1 = { host: '10.10.10.10', port: 28282, proto: 'http' };

async function resolveBaseUrl() {
	const tier = currentTier();
	if (tier === 3 || tier === null) return null;
	const stored = await chrome.storage.local.get(['tier1', 'tier2']);
	if (tier === 1) {
		const t1 = Object.assign({}, DEFAULT_TIER_1, stored.tier1);
		return `${t1.proto}://${t1.host}:${t1.port}`;
	}
	if (tier === 2 && stored.tier2 && stored.tier2.host) {
		const proto = stored.tier2.proto || 'https';
		const port = stored.tier2.port ? `:${stored.tier2.port}` : '';
		return `${proto}://${stored.tier2.host}${port}`;
	}
	return null;
}

async function fetchWithAuth(path, options = {}, token) {
	const baseUrl = await resolveBaseUrl();
	if (!baseUrl) return { status: 'offline', tier: currentTier() };
	const url = baseUrl + path;
	const headers = Object.assign(
		{ 'Authorization': `Bearer ${token}` },
		options.headers || {},
	);
	return fetch(url, Object.assign({}, options, { headers }));
}

// daemonRequest — public API. Returns parsed JSON on success, or a structured
// status object on failure. Callers never see raw fetch errors.
//
//   { status: 'ok', data: <json> }
//   { status: 'not-found' }            — 404; legitimate "no match"
//   { status: 'offline', tier: 3 }     — no daemon reachable
//   { status: 'error', code, message } — anything else
async function daemonRequest(path, options = {}) {
	const tier = currentTier();
	if (tier === 3 || tier === null) return { status: 'offline', tier };

	let token = await getToken();
	let res;

	try {
		res = await fetchWithAuth(path, options, token);
		// fetchWithAuth returns an offline object if baseUrl is null
		if (res && res.status === 'offline') return res;

		if (res.status === 401) {
			token = await rotateToken();
			res = await fetchWithAuth(path, options, token);
			if (res && res.status === 'offline') return res;
		}

		if (res.status === 404) return { status: 'not-found' };

		if (!res.ok) {
			return { status: 'error', code: res.status, message: res.statusText };
		}

		const data = await res.json().catch(() => null);
		return { status: 'ok', data };
	} catch (err) {
		return { status: 'error', code: 0, message: String(err && err.message || err) };
	}
}

// Convenience for GET with query params.
async function daemonGet(path, query = null) {
	const qs = query ? '?' + new URLSearchParams(query).toString() : '';
	return daemonRequest(path + qs, { method: 'GET' });
}

// Convenience for POST with JSON body.
async function daemonPost(path, body) {
	return daemonRequest(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export { daemonRequest, daemonGet, daemonPost, resolveBaseUrl };
