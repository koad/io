// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-server.js — Server-side sigchain verification and IPFS pinning
// Consumer: daemon (kingofalldata.com server, Passenger local daemon)
//
// API surface:
//   SovereignProfile.verify(cid) → { valid, errors }
//   SovereignProfile.pin(cid)    → { pinned, cid }
//
// verify() performs a full chain walk and signature check server-side.
// pin() requests the daemon to persist the CID via the IPFS node.
// Both stub to IPFSServer once that package's server API is finalized.

import { encode as dagJsonEncode, decode as dagJsonDecode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as ed from '@noble/ed25519';

// ── SovereignProfile (server) ─────────────────────────────────────────────────

const SovereignProfile = {};

/**
 * Server-side full chain verification.
 * Mirrors client-side verifyChain() logic but runs in Node/Fiber context
 * on the daemon, where the full IPFS node (IPFSServer) is available.
 *
 * @param {string} cid — tip CIDv1 string
 * @returns {Promise<{ valid: boolean, errors: Array<string> }>}
 */
SovereignProfile.verify = async function(cid) {
  // TODO: walk chain using IPFSServer.get(cid) once ipfs-client server API is finalized.
  // Pattern:
  //   let currentCid = cid;
  //   while (currentCid) {
  //     const bytes = await IPFSServer.get(currentCid);
  //     const entry = dagJsonDecode(bytes);
  //     // verify CID recomputation, signature, entity consistency
  //     // apply device key auth set mutations
  //     currentCid = entry.previous;
  //   }

  console.log('[sovereign-profiles:server] verify stub — cid:', cid);
  console.log('[sovereign-profiles:server] TODO: wire to IPFSServer.get() for server-side chain walk');

  return {
    valid: false,
    errors: ['TODO: server-side verify not implemented — wire to IPFSServer.get()'],
  };
};

/**
 * Pin a profile CID via the daemon's IPFS node.
 * Called by the daemon when a user publishes a new profile or when a
 * namespaced user's essential data needs to stay warm on the gateway.
 *
 * Per sigchain-witness-architecture brief:
 *   - All namespaced users: pin essentials (avatar + sigchain)
 *   - Sponsors ($100+): pin everything
 *
 * @param {string} cid — CIDv1 to pin
 * @returns {Promise<{ pinned: boolean, cid: string }>}
 */
SovereignProfile.pin = async function(cid) {
  // TODO: wire to IPFSServer.pin(cid) once ipfs-client server Phase 2 is implemented.
  // See sigchain-witness-architecture.md §"Pinning Service" and §"Gateway".

  console.log('[sovereign-profiles:server] pin stub — cid:', cid);
  console.log('[sovereign-profiles:server] TODO: wire to IPFSServer.pin() for daemon pinning');

  return {
    pinned: false,
    cid,
    error: 'TODO: server-side pin not implemented — wire to IPFSServer.pin()',
  };
};

// ── Attach to koad global (server) ───────────────────────────────────────────

if (typeof koad !== 'undefined') {
  koad.sovereign = koad.sovereign || {};
  koad.sovereign.profile = SovereignProfile;
}

export { SovereignProfile };
