// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-server.js — Server-side profile API: create-from-dir, verify, pin, broadcast
// Consumer: daemon (kingofalldata.com server, Passenger local daemon)
//
// This file extends the SovereignProfile object with server-only methods:
//
//   SovereignProfile.fromEntityDir(entityDir) → { entity, genesis, keys }
//     Read entity keys + manifest from disk; return the data needed to build
//     and sign a genesis entry. Does NOT sign — call .sign() next.
//
//   SovereignProfile.verify(cid) → Promise<{ valid, errors }>
//     Full chain walk + signature verification (server-side, using IPFS node).
//     Currently a stub pending IPFSServer finalization.
//
//   SovereignProfile.pin(cid) → Promise<{ pinned, cid }>
//     Pin a CID via the daemon's IPFS node.
//     Currently a stub pending ipfs-client server Phase 2.
//
//   SovereignProfile.publishToChain(signedEntry, pubKeyHex, entityName, ticker)
//     → Promise<{ txid, address } | null>
//     Hand off a signed entry to ecoincore:sigchain-discovery for chain broadcast.
//     Weak dependency — returns null if sigchain-discovery is not loaded.
//
// The create/sign/authenticate/verify-signature flow lives in:
//   server/keystore.js  — reads keys from entity id/ dir
//   server/auth.js      — challenge-response auth API

'use strict';

let dagJsonEncode, dagJsonDecode, CID, sha256, ed;
async function ensureDeps() {
  if (!dagJsonEncode) {
    ({ encode: dagJsonEncode, decode: dagJsonDecode } = await import('@ipld/dag-json'));
    ({ CID } = await import('multiformats/cid'));
    ({ sha256 } = await import('multiformats/hashes/sha2'));
    ed = await import('@noble/ed25519');
  }
}

// ── SovereignProfile (server) ─────────────────────────────────────────────────

const SovereignProfile = {};

/**
 * Compose profile creation data from an entity directory.
 * Reads keys + passenger.json from disk. Returns the data needed to build
 * a genesis entry via SovereignProfile.genesis() and sign it with .sign().
 *
 * Full daemon flow:
 *   const data = SovereignProfile.fromEntityDir('/home/koad/.juno');
 *   const genesis = SovereignProfile.genesis(data);     // from profile-builder
 *   const signed  = await SovereignProfile.sign(genesis, data.seedBytes);
 *   const cid     = await SovereignProfile.publish(signed);
 *   await SovereignProfile.publishToChain(signed, data.pubKeyHex, data.entityName);
 *
 * @param {string} entityDir — absolute path to entity home dir (e.g. /home/koad/.juno)
 * @returns {{ entityName: string, pubKeyBytes: Uint8Array, seedBytes: Uint8Array,
 *             pubKeyHex: string, manifest: object }}
 */
SovereignProfile.fromEntityDir = function(entityDir) {
  const keystore = globalThis.SovereignProfileKeystore;
  if (!keystore) {
    throw new Error('SovereignProfile.fromEntityDir: SovereignProfileKeystore not available. Ensure keystore.js is loaded.');
  }
  const result = keystore.fromEntityDir(entityDir);

  // Derive hex representation for sigchain-discovery API (wants hex, not Uint8Array)
  result.pubKeyHex = Buffer.from(result.pubKeyBytes).toString('hex');

  return result;
};

/**
 * Server-side full chain verification.
 * Mirrors client-side verifyChain() logic but runs in Node context on the daemon,
 * where the full IPFS node (IPFSServer) is available.
 *
 * @param {string} cid — tip CIDv1 string
 * @returns {Promise<{ valid: boolean, errors: Array<string> }>}
 */
SovereignProfile.verify = async function(cid) {
  await ensureDeps();
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
  await ensureDeps();
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

/**
 * Hand off a signed sigchain entry to ecoincore:sigchain-discovery for chain broadcast.
 *
 * This is a weak dependency path — sovereign-profiles works standalone for rendering
 * and signing. The chain broadcast only fires when sigchain-discovery is present.
 *
 * The signed entry is serialized to dag-json, the CID is embedded in an OP_RETURN
 * payload, and broadcast to the entity's derived CDN address. This is handled entirely
 * by sigchain-discovery; we only call its API here.
 *
 * ROOTY-SPEC-002 §4.1 / §9: the broadcast address is derived from the entity's
 * Ed25519 public key + entity name via HKDF (handled inside sigchain-discovery).
 *
 * @param {string} cid          — CIDv1 of the signed entry (from SovereignProfile.publish)
 * @param {string} pubKeyHex    — entity Ed25519 public key as hex (64 chars = 32 bytes)
 * @param {string} entityName   — entity name (for HKDF salt in address derivation)
 * @param {string} [ticker='CDN'] — chain ticker
 * @returns {Promise<{ txid: string, address: string } | null>}
 *   Returns null if sigchain-discovery is not present (weak dep).
 *   Returns { txid, address } on successful broadcast.
 */
SovereignProfile.publishToChain = async function(cid, pubKeyHex, entityName, ticker = 'CDN') {
  // Weak dependency guard — check if sigchain-discovery is present
  const discovery = (typeof eCoinCore !== 'undefined' && eCoinCore?.sigchain?.discovery);
  if (!discovery) {
    console.log('[sovereign-profiles:server] publishToChain: ecoincore:sigchain-discovery not present — skipping chain broadcast');
    console.log('[sovereign-profiles:server] publishToChain: add ecoincore:sigchain-discovery to app .meteor/packages to enable chain broadcast');
    return null;
  }

  if (!cid || !pubKeyHex || !entityName) {
    throw new Error('publishToChain: cid, pubKeyHex, and entityName are required');
  }

  console.log(`[sovereign-profiles:server] publishToChain: broadcasting cid=${cid.slice(0, 20)}... for ${entityName} on ${ticker}`);

  try {
    // sigchain-discovery.broadcastCid is the planned API for §4.1 broadcast mode.
    // If that method doesn't exist yet (in-progress), fall back to watchEntity
    // (which starts observing but doesn't initiate a broadcast).
    if (typeof discovery.broadcastCid === 'function') {
      const result = await discovery.broadcastCid(cid, pubKeyHex, entityName, ticker);
      console.log(`[sovereign-profiles:server] publishToChain: broadcast result:`, result);
      return result;
    }

    // Fallback: start watching the entity's broadcast address.
    // The operator will need to manually submit the OP_RETURN transaction
    // or use a separate broadcast tool. This starts the observation so the
    // daemon will index it when the transaction lands.
    console.warn('[sovereign-profiles:server] publishToChain: discovery.broadcastCid not available — starting watch mode instead');
    await discovery.watchEntity(entityName, pubKeyHex, ticker);
    console.log(`[sovereign-profiles:server] publishToChain: watchEntity started for ${entityName} — broadcast tx must be submitted separately`);
    return null;

  } catch (err) {
    console.error(`[sovereign-profiles:server] publishToChain: error:`, err.message);
    throw err;
  }
};

// ── Attach to koad global (server) ───────────────────────────────────────────

if (typeof koad !== 'undefined') {
  koad.sovereign = koad.sovereign || {};
  koad.sovereign.profile = SovereignProfile;
}

// Attach to globalThis for cross-file server access
globalThis.SovereignProfile = globalThis.SovereignProfile
  ? Object.assign(globalThis.SovereignProfile, SovereignProfile)
  : SovereignProfile;

export { SovereignProfile };
