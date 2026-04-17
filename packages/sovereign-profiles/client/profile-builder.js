// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-builder.js — Sovereign profile creation and signing
// Consumer: Passenger (the user's local PWA). Requires local key access.
//
// Implements VESTA-SPEC-111 §2 (entry schema), §3 (serialization + signing),
// §4 (genesis), §5.2 (koad.state-update with scope:"profile").
//
// API surface (attached to koad.sovereign.profile on the koad global):
//
//   SovereignProfile.create({ name, bio, avatar, socialProofs }) → entry
//   SovereignProfile.update(currentCid, changes) → entry
//   SovereignProfile.sign(entry, privateKey) → signedEntry
//   SovereignProfile.publish(signedEntry) → cid
//
// All methods return Promises. Signing requires @noble/ed25519.
// Publishing requires koad:io-ipfs-client (IPFSClient) to be initialized.

let dagJsonEncode, CID, sha256, ed;
async function ensureDeps() {
  if (!dagJsonEncode) {
    ({ encode: dagJsonEncode } = await import('@ipld/dag-json'));
    ({ CID } = await import('multiformats/cid'));
    ({ sha256 } = await import('multiformats/hashes/sha2'));
    ed = await import('@noble/ed25519');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Produce the canonical pre-image for signing per SPEC-111 §3.2.
 * Fields are sorted lexicographically; the `signature` field is absent.
 *
 * @param {object} entry — entry object without `signature`
 * @returns {Uint8Array} — dag-json bytes ready for Ed25519 signing
 */
async function canonicalPreImage(entry) {
  await ensureDeps();
  const ordered = {
    entity: entry.entity,
    payload: entry.payload,
    previous: entry.previous,
    timestamp: entry.timestamp,
    type: entry.type,
    version: entry.version,
  };
  return dagJsonEncode(ordered);
}

/**
 * Compute a CIDv1 (dag-json, sha2-256) from dag-json bytes.
 * Per SPEC-111 §3.1: codec 0x0129, hash 0x12.
 *
 * @param {Uint8Array} bytes — canonical dag-json encoding of the signed entry
 * @returns {Promise<string>} — base32-upper CIDv1 string e.g. "bafyrei..."
 */
async function computeCid(bytes) {
  await ensureDeps();
  const hash = await sha256.digest(bytes);
  // dag-json codec = 0x0129
  const cid = CID.createV1(0x0129, hash);
  return cid.toString(); // base32 upper by default for CIDv1
}

/**
 * Encode raw bytes to base64url without padding (RFC 4648 §5, no `=`).
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64Url(bytes) {
  // btoa operates on binary strings
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Decode base64url (no padding) to Uint8Array.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/**
 * UTC ISO 8601 timestamp with second precision, always Z.
 * Per SPEC-111 §2.1: MUST include seconds, no timezone offset.
 *
 * @returns {string}
 */
function nowTimestamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// ── SovereignProfile ─────────────────────────────────────────────────────────

const SovereignProfile = {};

/**
 * Create a genesis sigchain entry for a new sovereign profile.
 * Entry type: koad.genesis per SPEC-111 §4.
 * Profile data is NOT embedded in the genesis entry — the genesis anchors
 * the chain identity. The initial profile state is a subsequent
 * koad.state-update entry with scope:"profile" (see SovereignProfile.update).
 *
 * @param {object} opts
 * @param {string} opts.entity — entity name (e.g. "juno", "alice")
 * @param {string} opts.pubkeyBytes — Ed25519 public key as Uint8Array
 * @param {string} [opts.description] — human-readable chain description
 * @returns {object} — unsigned genesis entry (call .sign() next)
 */
SovereignProfile.genesis = function({ entity, pubkeyBytes, description }) {
  const timestamp = nowTimestamp();
  const pubkey = toBase64Url(pubkeyBytes);
  return {
    version: 1,
    entity,
    timestamp,
    type: 'koad.genesis',
    payload: {
      entity,
      pubkey,
      created: timestamp,
      description: description || `${entity} sovereign profile chain — genesis`,
    },
    previous: null,
    // signature added by .sign()
  };
};

/**
 * Create a new koad.state-update entry carrying the full profile state.
 * Per SPEC-111 §5.2: full replacement within scope "profile".
 *
 * @param {object} opts
 * @param {string} opts.entity — entity name
 * @param {string} opts.previousCid — CID of the entry this supersedes
 * @param {object} opts.profile
 * @param {string} opts.profile.name
 * @param {string} [opts.profile.bio]
 * @param {string} [opts.profile.avatar] — CID of the avatar image on IPFS
 * @param {Array}  [opts.profile.socialProofs] — array of { platform, handle, url }
 * @returns {object} — unsigned entry (call .sign() next)
 */
SovereignProfile.create = function({ entity, previousCid, profile }) {
  return {
    version: 1,
    entity,
    timestamp: nowTimestamp(),
    type: 'koad.state-update',
    payload: {
      scope: 'profile',
      data: {
        name: profile.name,
        bio: profile.bio || '',
        avatar: profile.avatar || null,
        socialProofs: profile.socialProofs || [],
      },
    },
    previous: previousCid,
    // signature added by .sign()
  };
};

/**
 * Alias of .create() — produces a new state-update entry referencing the
 * current tip. Semantically identical; named separately for clarity at call sites.
 *
 * @param {string} currentCid — tip CID to reference as `previous`
 * @param {object} changes — partial or full profile fields to update
 * @param {string} entity — entity name
 * @returns {object} — unsigned entry
 */
SovereignProfile.update = function(currentCid, changes, entity) {
  return SovereignProfile.create({
    entity,
    previousCid: currentCid,
    profile: changes,
  });
};

/**
 * Sign an entry with the given Ed25519 private key.
 * Implements SPEC-111 §3.2–3.3.
 *
 * @param {object} entry — unsigned entry (no `signature` field)
 * @param {Uint8Array} privateKey — 32-byte Ed25519 private key scalar
 * @returns {Promise<object>} — signed entry with `signature` populated
 */
SovereignProfile.sign = async function(entry, privateKey) {
  const preImage = await canonicalPreImage(entry);
  // @noble/ed25519 sign(message, privateKey) → Promise<Uint8Array>
  const sigBytes = await ed.sign(preImage, privateKey);
  return {
    ...entry,
    signature: toBase64Url(sigBytes),
  };
};

/**
 * Publish a signed entry to IPFS via koad:io-ipfs-client.
 * Encodes the entry as dag-json, stores in the Helia blockstore, and
 * returns the CIDv1 (dag-json codec 0x0129, sha2-256).
 *
 * Implements SPEC-111 §3.1: canonical dag-json serialization; the returned
 * CID is content-addressed and serves as the `previous` pointer for
 * subsequent sigchain entries.
 *
 * @param {object} signedEntry — entry with `signature` field populated
 * @returns {Promise<string>} — CIDv1 string e.g. "bagu..."
 */
SovereignProfile.publish = async function(signedEntry) {
  await ensureDeps();
  const bytes = dagJsonEncode(signedEntry);
  // IPFSClient.put() accepts pre-encoded Uint8Array — no double-encoding
  const cid = await IPFSClient.put(bytes);
  return cid;
};

// ── Attach to koad global ─────────────────────────────────────────────────────

if (typeof koad !== 'undefined') {
  koad.sovereign = koad.sovereign || {};
  koad.sovereign.profile = SovereignProfile;
}

// ── Ed25519 utility — also exported for Passenger key-store ──────────────────

/**
 * Derive an Ed25519 public key from a 32-byte seed (private key scalar).
 * Exported so that koad.passenger.key-store can use the same noble dependency.
 *
 * @param {Uint8Array} seedBytes — 32-byte private key seed
 * @returns {Promise<Uint8Array>} — 32-byte public key
 */
const ed25519GetPublicKey = async function(seedBytes) {
  await ensureDeps();
  return ed.getPublicKeyAsync(seedBytes);
};

if (typeof koad !== 'undefined') {
  koad.sovereign = koad.sovereign || {};
  koad.sovereign.ed25519GetPublicKey = ed25519GetPublicKey;
}

export { SovereignProfile, canonicalPreImage, computeCid, toBase64Url, fromBase64Url, ed25519GetPublicKey };
