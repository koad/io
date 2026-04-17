// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-viewer.js — Profile resolution, verification, and rendering
// Consumer: any koad:io app (Passenger, kingofalldata.com, etc.)
// No signing keys required — read-only operations.
//
// Implements SPEC-111 §3.4 (verification), §6 (chain verification rules),
// §6.5 (device key authorization set), §7.3 (resolving current state).
//
// API surface (attached to koad.sovereign.profile alongside builder):
//
//   SovereignProfile.resolve(cid) → profileData
//   SovereignProfile.verifyChain(tipCid) → { valid, entries, errors }
//   SovereignProfile.render(profileData) → renderData
//
// All methods return Promises. Requires koad:io-ipfs-client for IPFS fetch.

import { canonicalPreImage, computeCid, toBase64Url, fromBase64Url } from './profile-builder.js';

let dagJsonDecode, dagJsonEncode, CID, sha256, ed;
async function ensureDeps() {
  if (!dagJsonDecode) {
    ({ decode: dagJsonDecode, encode: dagJsonEncode } = await import('@ipld/dag-json'));
    ({ CID } = await import('multiformats/cid'));
    ({ sha256 } = await import('multiformats/hashes/sha2'));
    ed = await import('@noble/ed25519');
  }
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

/**
 * Fetch a dag-json entry from IPFS by CID.
 * Resolution order per sigchain-witness-architecture brief:
 *   1. Local OPFS cache (via Helia blockstore)
 *   2. Helia HTTP delegated routing (delegated-ipfs.dev)
 *
 * Delegates to IPFSClient.get(cid) which calls resolve() for raw bytes
 * then decodes via @ipld/dag-json.
 *
 * @param {string} cid — CIDv1 string
 * @returns {Promise<object>} — decoded dag-json entry object
 */
async function fetchEntry(cid) {
  return IPFSClient.get(cid);
}

// ── Verification helpers ──────────────────────────────────────────────────────

/**
 * Verify a single entry's CID integrity and Ed25519 signature.
 * Implements SPEC-111 §3.4 steps 1–5.
 *
 * @param {string} cid — claimed CID
 * @param {object} entry — decoded entry object
 * @param {Set<string>} authSet — set of base64url-encoded authorized public keys
 * @returns {Promise<{ valid: boolean, error: string|null }>}
 */
async function verifyEntry(cid, entry, authSet) {
  await ensureDeps();
  // Step 1: recompute CID from entry bytes, assert match
  const bytes = dagJsonEncode(entry);
  const recomputedCid = await computeCid(bytes);
  if (recomputedCid !== cid) {
    return { valid: false, error: `CID mismatch: stored=${cid} computed=${recomputedCid}` };
  }

  // Steps 2–5: verify Ed25519 signature against an authorized key
  if (!entry.signature) {
    return { valid: false, error: 'entry missing signature field' };
  }

  const preImage = await canonicalPreImage(entry);
  const sigBytes = fromBase64Url(entry.signature);

  let verified = false;
  for (const pubkeyB64 of authSet) {
    try {
      const pubkeyBytes = fromBase64Url(pubkeyB64);
      const ok = await ed.verify(sigBytes, preImage, pubkeyBytes);
      if (ok) { verified = true; break; }
    } catch (_) {
      // key format error — try next key
    }
  }

  if (!verified) {
    return { valid: false, error: 'signature verification failed against all authorized keys' };
  }

  return { valid: true, error: null };
}

/**
 * Update the device key authorization set given an entry.
 * Implements SPEC-111 §6.5.
 *
 * @param {object} entry
 * @param {Set<string>} authSet — mutated in place
 * @returns {Promise<{ ok: boolean, error: string|null }>}
 */
async function applyDeviceKeyEntry(entry, authSet) {
  const { type, payload } = entry;

  if (type === 'koad.device-key-add') {
    const { device_pubkey, authorized_by, reverse_sig } = payload;

    // Assert authorized_by is in auth set
    if (!authSet.has(authorized_by)) {
      return { ok: false, error: `device-key-add: authorized_by key ${authorized_by} not in authorization set` };
    }

    // Verify reverse_sig: device key signs pre-image with reverse_sig absent
    const preImageEntry = {
      ...entry,
      payload: Object.fromEntries(
        Object.entries(payload).filter(([k]) => k !== 'reverse_sig')
      ),
    };
    const reversePre = await canonicalPreImage(preImageEntry);
    try {
      const devPubBytes = fromBase64Url(device_pubkey);
      const revSigBytes = fromBase64Url(reverse_sig);
      const ok = await ed.verify(revSigBytes, reversePre, devPubBytes);
      if (!ok) {
        return { ok: false, error: 'device-key-add: reverse_sig verification failed' };
      }
    } catch (e) {
      return { ok: false, error: `device-key-add: reverse_sig error: ${e.message}` };
    }

    authSet.add(device_pubkey);
    return { ok: true, error: null };
  }

  if (type === 'koad.device-key-revoke') {
    const { device_pubkey } = payload;
    // Cannot revoke a key that is not in the set (or is the root — root is never removed)
    authSet.delete(device_pubkey);
    return { ok: true, error: null };
  }

  return { ok: true, error: null }; // non-key-management entries: no-op
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a profile from its sigchain tip CID.
 * Walks the chain to find the most recent koad.state-update entry with
 * scope:"profile". Returns the profile data object from its payload.
 *
 * Per SPEC-111 §7.3: obtain tip, verify, walk chain for relevant entries.
 *
 * @param {string} cid — tip CIDv1 string
 * @returns {Promise<object|null>} — profile data object, or null if not found
 */
SovereignProfile.resolve = async function(cid) {
  // verifyChain walks from tip to genesis and collects all entries
  const { valid, entries, errors } = await SovereignProfile.verifyChain(cid);
  if (!valid) {
    console.warn('[sovereign-profiles] chain verification failed:', errors);
    // Return best-effort profile data even if chain has issues (caller decides)
  }

  // Walk entries from tip (index 0) toward genesis — find most recent profile entry
  for (const { entry } of entries) {
    if (entry.type === 'koad.state-update' && entry.payload?.scope === 'profile') {
      return entry.payload.data;
    }
  }

  return null;
};

/**
 * Walk and verify the full sigchain from tip to genesis.
 * Implements SPEC-111 §3.4, §6.1, §6.5.
 *
 * @param {string} tipCid — CIDv1 of the chain tip
 * @returns {Promise<{ valid: boolean, entries: Array, errors: Array<string> }>}
 *   entries: [ { cid, entry }, ... ] ordered tip-first
 *   errors: array of error strings (empty if valid)
 */
SovereignProfile.verifyChain = async function(tipCid) {
  const entries = [];
  const errors = [];
  let currentCid = tipCid;

  // First pass: fetch all entries tip → genesis
  const fetchedEntries = [];
  const seenCids = new Set();

  while (currentCid !== null) {
    if (seenCids.has(currentCid)) {
      errors.push(`cycle detected at CID ${currentCid}`);
      return { valid: false, entries, errors };
    }
    seenCids.add(currentCid);

    let entry;
    try {
      entry = await fetchEntry(currentCid);
    } catch (e) {
      errors.push(`fetch failed for CID ${currentCid}: ${e.message}`);
      return { valid: false, entries, errors };
    }

    // SPEC-111 §2.2: unknown fields MUST cause rejection
    const allowedFields = new Set(['version', 'entity', 'timestamp', 'type', 'payload', 'previous', 'signature']);
    for (const key of Object.keys(entry)) {
      if (!allowedFields.has(key)) {
        errors.push(`unknown field "${key}" in entry ${currentCid}`);
        return { valid: false, entries, errors };
      }
    }

    fetchedEntries.push({ cid: currentCid, entry });
    currentCid = entry.previous;
  }

  // Validate genesis (last entry must be koad.genesis with previous:null)
  const genesisEntry = fetchedEntries[fetchedEntries.length - 1]?.entry;
  if (!genesisEntry || genesisEntry.type !== 'koad.genesis' || genesisEntry.previous !== null) {
    errors.push('chain does not terminate in a valid koad.genesis entry');
    return { valid: false, entries: fetchedEntries, errors };
  }

  // Check entity consistency
  const chainEntity = genesisEntry.entity;
  for (const { cid, entry } of fetchedEntries) {
    if (entry.entity !== chainEntity) {
      errors.push(`entity mismatch at ${cid}: expected ${chainEntity}, got ${entry.entity}`);
      return { valid: false, entries: fetchedEntries, errors };
    }
    if (entry.version !== 1) {
      errors.push(`version mismatch at ${cid}: expected 1, got ${entry.version}`);
      return { valid: false, entries: fetchedEntries, errors };
    }
  }

  // Second pass: walk genesis → tip, build authorization set, verify signatures
  // fetchedEntries is tip-first, so reverse for genesis-first traversal
  const authSet = new Set([genesisEntry.payload.pubkey]); // root key
  let allValid = true;

  for (const { cid, entry } of [...fetchedEntries].reverse()) {
    const { valid: entryValid, error } = await verifyEntry(cid, entry, authSet);
    if (!entryValid) {
      errors.push(`entry ${cid}: ${error}`);
      allValid = false;
      continue; // continue walking to surface all errors
    }

    // Apply device key mutations to auth set
    const { ok, error: keyError } = await applyDeviceKeyEntry(entry, authSet);
    if (!ok) {
      errors.push(`entry ${cid} key management error: ${keyError}`);
      allValid = false;
    }
  }

  // Return entries tip-first (natural walk order for consumers)
  return { valid: allValid, entries: fetchedEntries, errors };
};

/**
 * Derive relationship-annotated kingdom records for a given entity.
 * Pure function — no DB access. Call this before render() to build
 * the kingdomsPerspective argument.
 *
 * Relationship rules (per flight plan / VESTA-SPEC-115):
 *   'sovereign' — entity is the kingdom's sovereign field
 *   'member'    — entity appears in the kingdom's members array and is not sovereign
 *   'peer'      — otherwise (indexed but no explicit membership)
 *
 * @param {string} entityName — entity handle to derive perspective for
 * @param {Array}  kingdomsArray — array of kingdom records (from Kingdoms.find().fetch())
 * @returns {Array<{ name, domain, sovereigntyModel, relationship }>}
 */
SovereignProfile.kingdomsFor = function(entityName, kingdomsArray) {
  if (!entityName || !Array.isArray(kingdomsArray)) return [];

  return kingdomsArray.map(k => {
    let relationship;
    if (k.sovereign === entityName) {
      relationship = 'sovereign';
    } else if (Array.isArray(k.memberHandles) && k.memberHandles.includes(entityName)) {
      relationship = 'member';
    } else {
      relationship = 'peer';
    }

    return {
      name: k.name || k._id,
      domain: k.domain || null,
      sovereigntyModel: k.sovereigntyModel || null,
      relationship,
    };
  });
};

/**
 * Prepare profile data for template rendering.
 * Returns a structured object ready for Blaze template helpers.
 *
 * kingdoms is returned as a top-level key (not nested under profile) because
 * Muse's templates reference {{#if kingdoms.length}} / {{#each kingdoms}} at
 * the top level of the template data object.
 *
 * @param {object} profileData — raw profile data from resolve()
 * @param {object} [opts]
 * @param {boolean} [opts.verified]            — whether chain verification passed
 * @param {string}  [opts.entity]              — entity name
 * @param {Array}   [opts.kingdomsPerspective] — output of kingdomsFor(); if absent, kingdoms is undefined
 * @returns {object} — render-ready data ({ profile, kingdoms })
 */
SovereignProfile.render = function(profileData, opts = {}) {
  if (!profileData) return null;

  // bondCount: count koad.bond entries in sigchain entries if provided; else fall through to
  // profileData.bondCount (set by caller) or 0.
  let bondCount = 0;
  if (opts.chainEntries && Array.isArray(opts.chainEntries)) {
    bondCount = opts.chainEntries.filter(({ entry }) => entry && entry.type === 'koad.bond').length;
  } else if (typeof profileData.bondCount === 'number') {
    bondCount = profileData.bondCount;
  }

  // sigchainTip, chainDepth, lastUpdated sourced from opts when caller has walked the chain.
  const sigchainTip   = opts.sigchainTip   || profileData.sigchainTip   || null;
  const chainDepth    = opts.chainDepth    != null ? opts.chainDepth    :
                        (opts.chainEntries ? opts.chainEntries.length : (profileData.chainDepth || 0));
  const lastUpdated   = opts.lastUpdated   || profileData.lastUpdated   || null;

  // kingdoms is included at the top level alongside the profile fields.
  // Muse's profile-full.html references {{#if kingdoms.length}} / {{#each kingdoms}}
  // at the template data root (not nested under profile). When kingdomsPerspective is
  // absent, kingdoms is omitted entirely — {{#if kingdoms.length}} guards prevent rendering.
  const kingdoms = Array.isArray(opts.kingdomsPerspective)
    ? opts.kingdomsPerspective
    : undefined;

  const result = {
    name: profileData.name || opts.entity || 'Unknown',
    bio: profileData.bio || '',
    avatar: profileData.avatar || null,
    socialProofs: (profileData.socialProofs || []).map(proof => ({
      platform: proof.platform,
      handle: proof.handle,
      url: proof.url,
      // TODO: verify social proof signatures when proof format is spec'd
      verified: false,
    })),
    verified: opts.verified === true,
    entity: opts.entity || null,
    bondCount,
    sigchainTip,
    chainDepth,
    lastUpdated,
  };

  if (kingdoms !== undefined) result.kingdoms = kingdoms;

  return result;
};

// ── Attach to koad global ─────────────────────────────────────────────────────

if (typeof koad !== 'undefined') {
  koad.sovereign = koad.sovereign || {};
  // Merge viewer methods onto same object as builder
  Object.assign(koad.sovereign.profile || {}, SovereignProfile);
  koad.sovereign.profile = koad.sovereign.profile || SovereignProfile;
}

// SovereignProfile is also exported as a named export and via package.js api.export
// Profile builder and viewer share the same object — builder.js exports first,
// viewer.js extends it. Import order in package.js enforces this.
export { SovereignProfile };
