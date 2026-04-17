// SPDX-License-Identifier: AGPL-3.0-or-later
//
// stream-server.js — Server-side sigchain walker for SSR and API endpoints.
//
// On the server, IPFS client access differs from the browser (no service worker,
// no OPFS blockstore). This module uses the HTTP gateway fallback path:
//   GET kingofalldata.com/ipfs/<cid>  → JSON entry
//
// Phase 2: when the daemon's IPFS node is live, replace the gateway fetch with
// a direct RPC to the local kubo/helia daemon.
//
// API:
//   ActivityStreamServer.walk(tipCid, opts) → Promise<Array<object>>
//   ActivityStreamServer.render(entries, opts) → Array<object>  (same as client)

const GATEWAY_BASE = process.env.IPFS_GATEWAY || 'https://kingofalldata.com/ipfs';
const DEFAULT_MAX_DEPTH = 1000;

/**
 * Walk a sigchain from tipCid to genesis on the server.
 * Returns array of entry objects in chain order (oldest first).
 *
 * @param {string} tipCid
 * @param {object} [opts]
 * @param {number} [opts.maxDepth] — stop after N entries (default 1000)
 * @param {string} [opts.gateway] — override gateway base URL
 * @returns {Promise<Array<object>>}
 */
async function walkSigchain(tipCid, opts) {
  opts = opts || {};
  const maxDepth = opts.maxDepth || DEFAULT_MAX_DEPTH;
  const gateway  = opts.gateway  || GATEWAY_BASE;

  const entries = [];
  let cid = tipCid;
  let depth = 0;
  const visited = new Set();

  while (cid && !visited.has(cid) && depth < maxDepth) {
    visited.add(cid);
    depth++;

    let entry;
    try {
      // Server-side fetch — Meteor's environment provides fetch or we use Node fetch
      const res = await fetch(`${gateway}/${cid}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      });
      if (!res.ok) {
        console.warn(`[activity-stream/server] Failed to fetch ${cid}: HTTP ${res.status}`);
        break;
      }
      entry = await res.json();
    } catch (e) {
      console.warn(`[activity-stream/server] Fetch error for ${cid}:`, e.message);
      break;
    }

    if (!entry || typeof entry !== 'object') break;

    entries.push({ ...entry, _cid: cid });
    cid = entry.previous || null;
  }

  // Reverse: oldest first
  return entries.reverse();
}

/**
 * Walk multiple sigchain sources and merge chronologically.
 *
 * @param {Array<{tipCid: string}>} sources
 * @param {object} [opts]
 * @returns {Promise<Array<object>>}
 */
async function walkAll(sources, opts) {
  const results = await Promise.allSettled(
    (sources || []).map(src => {
      if (!src.tipCid) return Promise.resolve([]);
      return walkSigchain(src.tipCid, opts);
    })
  );

  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Deduplicate by CID, sort chronologically
  const seen = new Set();
  const unique = [];
  for (const e of all) {
    const key = e._cid || (e.timestamp + '|' + e.entity + '|' + e.type);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }
  unique.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  return unique;
}

ActivityStreamServer = {
  walk:    walkSigchain,
  walkAll,
};
