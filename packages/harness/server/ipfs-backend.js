// IPFS Backend — VESTA-SPEC-134 Phase 6
//
// Swaps KoadMemoryStoreIPFS from MockIPFS to a real Kubo HTTP API client.
//
// Configuration (via env vars, loaded from the koad:io env cascade):
//   KOAD_IO_IPFS_API_URL       — Kubo HTTP API URL (default: http://127.0.0.1:5001)
//   KOAD_IO_IPFS_GATEWAY_URL   — Public IPFS gateway for reads (default: http://127.0.0.1:8080)
//   KOAD_IO_IPFS_CLUSTER_URL   — IPFS Cluster API URL (optional; if set, pin/unpin use cluster API)
//
// When KOAD_IO_IPFS_API_URL is not set, this module is a no-op — MockIPFS stays active.
// When it is set, this module registers a real IPFS backend on KoadMemoryStoreIPFS.
//
// Kubo API calls:
//   write  → POST /api/v0/add?pin=true   (multipart/form-data, returns { Hash: cid })
//   read   → GET  <gateway_url>/ipfs/<cid>
//   unpin  → POST /api/v0/pin/rm?arg=<cid> (or cluster API DELETE /pins/<cid>)
//
// Cluster API calls (when KOAD_IO_IPFS_CLUSTER_URL is set):
//   pin    → POST /pins/<cid>
//   unpin  → DELETE /pins/<cid>
//
// All methods surface errors up. MemoryStore's callers swallow read errors
// gracefully (Layer 4a silent omit on failure per SPEC-134 §8.1).

import { Meteor } from 'meteor/meteor';

// ── Environment config ─────────────────────────────────────────────────────────

function getConfig() {
  return {
    apiUrl:     process.env.KOAD_IO_IPFS_API_URL     || null,
    gatewayUrl: process.env.KOAD_IO_IPFS_GATEWAY_URL || 'http://127.0.0.1:8080',
    clusterUrl: process.env.KOAD_IO_IPFS_CLUSTER_URL || null,
  };
}

// ── Real IPFS write — Kubo HTTP API /api/v0/add ───────────────────────────────
//
// POSTs padded ciphertext bytes as multipart/form-data to Kubo.
// Returns the real CID string from the response.

async function kuboWrite(paddedBytes, apiUrl) {
  // Build multipart body manually — Node 22 has FormData on globalThis
  // but we use the raw boundary approach to avoid pulling in extra deps.
  const boundary = `----KoadIPFSBoundary${Date.now()}`;
  const prefix   = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="blob"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n',
    'utf8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body   = Buffer.concat([prefix, Buffer.from(paddedBytes), suffix]);

  const response = await fetch(`${apiUrl}/api/v0/add?pin=true&cid-version=1`, {
    method:  'POST',
    headers: {
      'Content-Type':   `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString(),
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`IPFS add failed: ${response.status} ${response.statusText} — ${text}`);
  }

  const json = await response.json();
  if (!json.Hash) {
    throw new Error(`IPFS add: unexpected response shape — no Hash field: ${JSON.stringify(json)}`);
  }

  return json.Hash; // real CID string (e.g. "bafyrei...")
}

// ── Real IPFS read — Kubo gateway GET /ipfs/<cid> ─────────────────────────────
//
// Fetches ciphertext from the kingdom gateway.
// Returns Uint8Array of the padded ciphertext bytes.

async function kuboRead(cid, gatewayUrl) {
  const url      = `${gatewayUrl}/ipfs/${cid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`IPFS read failed: ${response.status} ${response.statusText} for CID ${cid}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

// ── Unpin — cluster API if available, Kubo API fallback ───────────────────────
//
// Unpin failure is non-fatal per SPEC-134 §9.2 — callers swallow errors.

async function kuboUnpin(cid, apiUrl, clusterUrl) {
  if (clusterUrl) {
    // IPFS Cluster API: DELETE /pins/<cid>
    try {
      const response = await fetch(`${clusterUrl}/pins/${cid}`, { method: 'DELETE' });
      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        throw new Error(`cluster unpin failed: ${response.status} — ${text}`);
      }
      return;
    } catch (err) {
      // Log and fall through to Kubo API as backup
      console.warn(`[ipfs-backend] cluster unpin failed for ${cid}: ${err.message} — trying Kubo API`);
    }
  }

  // Single-node Kubo: POST /api/v0/pin/rm?arg=<cid>
  const response = await fetch(`${apiUrl}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`Kubo unpin failed: ${response.status} ${response.statusText} — ${text}`);
  }
}

// ── Backend factory ───────────────────────────────────────────────────────────
//
// Returns an IPFS backend object conforming to KoadMemoryStoreIPFS interface:
//   { write(paddedBytes) → cid, read(cid) → Uint8Array, unpin(cid) → void }

function buildRealIPFSBackend(config) {
  const { apiUrl, gatewayUrl, clusterUrl } = config;

  return {
    async write(paddedBytes) {
      return kuboWrite(paddedBytes, apiUrl);
    },

    async read(cid) {
      return kuboRead(cid, gatewayUrl);
    },

    async unpin(cid) {
      return kuboUnpin(cid, apiUrl, clusterUrl);
    },
  };
}

// ── Registration ──────────────────────────────────────────────────────────────
//
// Runs at startup. If KOAD_IO_IPFS_API_URL is configured, replaces MockIPFS.
// If not configured, MockIPFS remains active (Phase 2 fallback).

Meteor.startup(() => {
  const config = getConfig();

  if (!config.apiUrl) {
    console.log('[ipfs-backend] KOAD_IO_IPFS_API_URL not set — MockIPFS remains active (Phase 2 mode)');
    return;
  }

  const backend = buildRealIPFSBackend(config);
  globalThis.KoadMemoryStoreIPFS = backend;

  const clusterNote = config.clusterUrl ? ` cluster=${config.clusterUrl}` : ' (single-node)';
  console.log(`[ipfs-backend] Phase 6 real IPFS backend registered — api=${config.apiUrl} gateway=${config.gatewayUrl}${clusterNote}`);
});
