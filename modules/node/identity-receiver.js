// identity-receiver.js — Sigchain head submission receiver (ESM)
//
// Implements VESTA-SPEC-150 v1.1 receiver side:
//   §6  — verifier behavior (all checks, order enforced)
//   §7  — conflict resolution (chain walk depth; tiebreakers)
//   §8  — idempotency + replay protection
//   §9  — bootstrapping (first publication)
//   §10 — error codes + response shapes
//   §11 — storage effects (file writes to ~/.vesta/entities/<handle>/sigchain/)
//   §5.3 — bulk-fetch endpoint logic (query + pagination)
//
// Design:
//   - Pure Node ESM — no Meteor globals, no HTTP, no WebApp.
//   - The IPFS chain walk is caller-provided via an `ipfsFetch(cid)` async fn.
//     The daemon injects a real Kubo gateway client; tests inject a mock.
//   - Storage is filesystem (per §11). Path base is configurable via opts.vestaEntitiesDir.
//   - Exports two async functions:
//       receiveHeadSubmission(submission, opts) → Promise<{ httpStatus, body }>
//       queryIdentityHeads(params, opts) → Promise<{ httpStatus, body }>
//
// IPFS walk stub:
//   When ipfsFetch is not provided (or returns null), the receiver falls back
//   to checking its local entry cache at <entities>/<handle>/sigchain/entries/<cid>.json.
//   If neither is available, returns ERR_CHAIN_INVALID with a "IPFS unavailable" message.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { verifyChain, verifyEntry } from './sigchain.js';
import { verifyHeadSubmission } from './identity-submission.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOCOL_V1 = 'koad.identity.head.v1';
const DEFAULT_VESTA_ENTITIES_DIR = path.join(os.homedir(), '.vesta', 'entities');
const DEFAULT_BULK_PAGE_SIZE = 1000;
const MAX_BULK_PAGE_SIZE = 10000;

// ---------------------------------------------------------------------------
// Error response shapes per §10
// ---------------------------------------------------------------------------

const ERR = {
  UNKNOWN_PROTOCOL:    { code: 'ERR_UNKNOWN_PROTOCOL',    httpStatus: 400 },
  UNKNOWN_HANDLE:      { code: 'ERR_UNKNOWN_HANDLE',       httpStatus: 404 },
  STALE_HEAD:          { code: 'ERR_STALE_HEAD',           httpStatus: 409 },
  KNOWN_TIP:           { code: 'ERR_KNOWN_TIP',            httpStatus: 200 },
  INVALID_SIGNATURE:   { code: 'ERR_INVALID_SIGNATURE',    httpStatus: 422 },
  CHAIN_INVALID:       { code: 'ERR_CHAIN_INVALID',        httpStatus: 422 },
  UNAUTHORIZED_SIGNER: { code: 'ERR_UNAUTHORIZED_SIGNER',  httpStatus: 403 },
  GENESIS_REPLAY:      { code: 'ERR_GENESIS_REPLAY',       httpStatus: 409 },
  UNRESOLVABLE_FORK:   { code: 'ERR_UNRESOLVABLE_FORK',    httpStatus: 409 },
  FUTURE_TIMESTAMP:    { code: 'ERR_FUTURE_TIMESTAMP',     httpStatus: 422 },
  INTERNAL:            { code: 'ERR_INTERNAL',             httpStatus: 500 },
};

function errResponse(errDef, message, extra = {}) {
  return {
    httpStatus: errDef.httpStatus,
    body: { ok: false, error: errDef.code, message, ...extra },
  };
}

function okResponse(body) {
  return { httpStatus: 200, body: { ok: true, ...body } };
}

// ---------------------------------------------------------------------------
// Filesystem helpers — per §11 storage layout
// ---------------------------------------------------------------------------

function entitySigchainDir(entitiesDir, handle) {
  return path.join(entitiesDir, handle, 'sigchain');
}

function metadataPath(entitiesDir, handle) {
  return path.join(entitySigchainDir(entitiesDir, handle), 'metadata.json');
}

function sigchainHeadTxtPath(entitiesDir, handle) {
  return path.join(entitySigchainDir(entitiesDir, handle), 'sigchain-head.txt');
}

function masterPubPath(entitiesDir, handle) {
  return path.join(entitySigchainDir(entitiesDir, handle), 'master.pub.asc');
}

function entryCachePath(entitiesDir, handle, cid) {
  return path.join(entitySigchainDir(entitiesDir, handle), 'entries', `${cid}.json`);
}

/**
 * Read the stored metadata for an entity. Returns null if not found.
 */
function readMetadata(entitiesDir, handle) {
  const mp = metadataPath(entitiesDir, handle);
  try {
    return JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Write §11 storage files atomically (best-effort; individual writes are not transactional).
 * On first submission (genesis), also writes master.pub.asc.
 * On key-succession entries in the chain walk, updates master.pub.asc.
 */
function writeStorageEffects({
  entitiesDir,
  handle,
  newHeadCID,
  submittedAt,
  masterFingerprint,
  masterPublicKey,
  isFirstSubmission,
  chainResult,
}) {
  const sigDir = entitySigchainDir(entitiesDir, handle);
  fs.mkdirSync(sigDir, { recursive: true });

  // metadata.json
  const existingMeta = readMetadata(entitiesDir, handle);
  const created = (existingMeta && existingMeta.created) ? existingMeta.created : submittedAt;

  const metadata = {
    handle,
    masterFingerprint,
    sigchainHeadCID: newHeadCID,
    status: 'active',
    created,
    sigchainHeadUpdated: submittedAt,
  };
  fs.writeFileSync(metadataPath(entitiesDir, handle), JSON.stringify(metadata, null, 2), 'utf8');

  // sigchain-head.txt — plain CID, no trailing newline (per §11)
  fs.writeFileSync(sigchainHeadTxtPath(entitiesDir, handle), newHeadCID, 'utf8');

  // master.pub.asc — written on first submission only, or on key-succession
  const masterPub = masterPubPath(entitiesDir, handle);
  if (isFirstSubmission && masterPublicKey) {
    fs.writeFileSync(masterPub, masterPublicKey, 'utf8');
  } else if (!isFirstSubmission && chainResult && chainResult.masterPublicKey) {
    // Check for key-succession: if the master public key changed, update it
    const storedPub = fs.existsSync(masterPub) ? fs.readFileSync(masterPub, 'utf8') : null;
    if (storedPub !== chainResult.masterPublicKey) {
      fs.writeFileSync(masterPub, chainResult.masterPublicKey, 'utf8');
      console.log(`[identity-receiver] key-succession detected for ${handle} — updated master.pub.asc`);
    }
  }
}

/**
 * Write an optional entry cache file per §11.
 */
function writeEntryCache(entitiesDir, handle, cid, entryJson) {
  try {
    const cacheDir = path.join(entitySigchainDir(entitiesDir, handle), 'entries');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(entryCachePath(entitiesDir, handle, cid), JSON.stringify(entryJson, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal — cache miss just falls back to IPFS
    console.warn(`[identity-receiver] entry cache write failed for ${handle}/${cid}: ${err.message}`);
  }
}

/**
 * Read an entry from the local cache. Returns null on miss.
 */
function readEntryCache(entitiesDir, handle, cid) {
  const cachePath = entryCachePath(entitiesDir, handle, cid);
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// IPFS chain entry fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch a chain entry from IPFS (via caller-provided ipfsFetch) or local cache.
 * Returns { entry, cid } or null on miss.
 *
 * @param {string} cid
 * @param {string} handle — for cache path
 * @param {string} entitiesDir
 * @param {Function|null} ipfsFetch — async (cid) => object|null
 */
async function fetchEntry(cid, handle, entitiesDir, ipfsFetch) {
  // Try local cache first (fast path)
  const cached = readEntryCache(entitiesDir, handle, cid);
  if (cached) return cached;

  // Try IPFS
  if (typeof ipfsFetch === 'function') {
    try {
      const fetched = await ipfsFetch(cid);
      if (fetched) {
        writeEntryCache(entitiesDir, handle, cid, fetched);
        return fetched;
      }
    } catch (err) {
      console.warn(`[identity-receiver] IPFS fetch failed for ${cid}: ${err.message}`);
    }
  }

  return null;
}

/**
 * Normalize a raw fetched entry into { entry, cid } shape for verifyChain.
 *
 * ipfsFetch may return either:
 *   (a) { entry: { type, previous, ... }, cid } — signEntry result shape (from tests / entry cache)
 *   (b) The bare entry object { type, previous, ... } — from a real IPFS fetch returning raw JSON
 *
 * verifyChain expects shape (a). We normalize here so walkChainToAnchor always has consistent input.
 */
function normalizeEntry(raw, cid) {
  if (!raw) return null;
  // If it has an 'entry' key that looks like a sigchain entry, use it directly
  if (raw.entry && typeof raw.entry === 'object' && raw.entry.type) {
    return { entry: raw.entry, cid: raw.cid || cid };
  }
  // Otherwise treat raw itself as the entry body
  if (raw.type) {
    return { entry: raw, cid };
  }
  return null;
}

/**
 * Walk the chain from newHeadCID back to anchorCID (inclusive) or all the way to genesis.
 * Returns entries in genesis-to-tip order (as verifyChain expects: Array<{ entry, cid }>).
 * Throws { ipfsMiss: true, cid } on IPFS miss.
 *
 * When anchorCID is non-null (known prior head exists), we walk from newHeadCID backward
 * until we reach anchorCID (inclusive — we include the anchor so verifyChain has the
 * full context starting from a verified point). The anchor is the last known-valid entry;
 * verifyChain needs it as the starting point for the walk.
 *
 * maxDepth caps the walk per §6.5.
 */
async function walkChainToAnchor({
  newHeadCID,
  anchorCID,   // Vesta's known current head (inclusive stop), or null for full genesis walk
  handle,
  entitiesDir,
  ipfsFetch,
  maxDepth = 100,
}) {
  const collected = [];
  let currentCID = newHeadCID;

  for (let depth = 0; depth < maxDepth; depth++) {
    const raw = await fetchEntry(currentCID, handle, entitiesDir, ipfsFetch);
    if (!raw) {
      throw { ipfsMiss: true, cid: currentCID };
    }

    const normalized = normalizeEntry(raw, currentCID);
    if (!normalized) {
      throw { ipfsMiss: true, cid: currentCID };
    }

    // Prepend to build genesis-to-tip order
    collected.unshift(normalized);

    const entryBody = normalized.entry;
    const prevCID = entryBody.previous;

    // Reached anchor — stop (anchor is included in collected)
    if (anchorCID !== null && currentCID === anchorCID) {
      break;
    }

    // Reached genesis (previous is null) — stop
    if (prevCID === null || prevCID === undefined) {
      break;
    }

    // If next entry IS the anchor, fetch it too (include anchor in collected) then stop
    if (anchorCID !== null && prevCID === anchorCID) {
      const anchorRaw = await fetchEntry(anchorCID, handle, entitiesDir, ipfsFetch);
      if (anchorRaw) {
        const anchorNormalized = normalizeEntry(anchorRaw, anchorCID);
        if (anchorNormalized) {
          collected.unshift(anchorNormalized);
        }
      }
      break;
    }

    currentCID = prevCID;
  }

  return collected;
}

// ---------------------------------------------------------------------------
// Conflict resolution per §7
// ---------------------------------------------------------------------------

/**
 * Walk depth from genesis to headCID.
 * Returns integer depth, or -1 on IPFS miss or invalid chain.
 */
async function walkDepth(headCID, handle, entitiesDir, ipfsFetch) {
  let depth = 0;
  let currentCID = headCID;
  for (let i = 0; i < 10000; i++) {
    const raw = await fetchEntry(currentCID, handle, entitiesDir, ipfsFetch);
    if (!raw) return -1;
    const normalized = normalizeEntry(raw, currentCID);
    if (!normalized) return -1;
    depth++;
    const prevCID = normalized.entry.previous;
    if (prevCID === null || prevCID === undefined) break;
    currentCID = prevCID;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Main receiver — §6 verifier behavior
// ---------------------------------------------------------------------------

/**
 * Receive and validate a sigchain head submission per VESTA-SPEC-150.
 *
 * @param {object} submission — raw JSON body from POST /api/identity/head/submit
 * @param {object} opts
 * @param {string} [opts.vestaEntitiesDir] — defaults to ~/.vesta/entities/
 * @param {Function|null} [opts.ipfsFetch] — async (cid) => entry object | null
 * @param {boolean} [opts.skipGitCommit=true] — git commit is optional per §11; skip by default
 * @returns {Promise<{ httpStatus: number, body: object }>}
 */
export async function receiveHeadSubmission(submission, {
  vestaEntitiesDir = DEFAULT_VESTA_ENTITIES_DIR,
  ipfsFetch = null,
  skipGitCommit = true,
} = {}) {
  try {
    // -------------------------------------------------------------------
    // §6.1 — Protocol version check
    // -------------------------------------------------------------------
    if (!submission || typeof submission !== 'object') {
      return errResponse(ERR.UNKNOWN_PROTOCOL, 'submission must be a JSON object');
    }
    if (submission.protocol !== PROTOCOL_V1) {
      return errResponse(
        ERR.UNKNOWN_PROTOCOL,
        `unknown protocol "${submission.protocol || '(missing)'}" — expected ${PROTOCOL_V1}`,
      );
    }

    // -------------------------------------------------------------------
    // §8.3 — Timestamp window (replay protection)
    // -------------------------------------------------------------------
    if (!submission.submitted_at) {
      return errResponse(ERR.INVALID_SIGNATURE, 'submitted_at is required');
    }
    const submittedAtMs = new Date(submission.submitted_at).getTime();
    if (isNaN(submittedAtMs)) {
      return errResponse(ERR.INVALID_SIGNATURE, `submitted_at is not a valid ISO 8601 timestamp: ${submission.submitted_at}`);
    }
    const nowMs = Date.now();
    if (nowMs - submittedAtMs > 24 * 60 * 60 * 1000) {
      return errResponse(
        ERR.INVALID_SIGNATURE,
        `submitted_at ${submission.submitted_at} is more than 24 hours in the past`,
      );
    }
    if (submittedAtMs - nowMs > 5 * 60 * 1000) {
      return errResponse(
        ERR.FUTURE_TIMESTAMP,
        `submitted_at ${submission.submitted_at} is more than 5 minutes in the future`,
      );
    }

    // -------------------------------------------------------------------
    // §6.2 — Handle resolution
    // -------------------------------------------------------------------
    const handle = submission.entity_handle;
    if (!handle || typeof handle !== 'string') {
      return errResponse(ERR.UNKNOWN_HANDLE, 'entity_handle is required');
    }

    const storedMeta = readMetadata(vestaEntitiesDir, handle);
    const priorKnownHead = storedMeta ? storedMeta.sigchainHeadCID : null;
    const isFirstSubmission = (priorKnownHead === null);

    // Unknown handle + non-genesis submission → ERR_UNKNOWN_HANDLE per §10
    if (isFirstSubmission && submission.previous_head_cid !== null && submission.previous_head_cid !== undefined) {
      return errResponse(
        ERR.UNKNOWN_HANDLE,
        `no record for entity "${handle}" and previous_head_cid is not null — cannot accept non-genesis submission for unknown entity`,
      );
    }

    // -------------------------------------------------------------------
    // §8.1 + §9 — Idempotency check (MUST come before genesis-replay per §8.1)
    // Same new_head_cid already stored → success no-op regardless of other fields.
    // -------------------------------------------------------------------
    if (!isFirstSubmission && submission.new_head_cid === priorKnownHead) {
      return {
        httpStatus: 200,
        body: {
          ok: true,
          handle,
          accepted_cid: priorKnownHead,
          already_current: true,
          error: 'ERR_KNOWN_TIP',
        },
      };
    }

    // -------------------------------------------------------------------
    // §9 — Genesis replay check
    // -------------------------------------------------------------------
    if (!isFirstSubmission) {
      if (submission.previous_head_cid === null || submission.previous_head_cid === undefined) {
        return errResponse(
          ERR.GENESIS_REPLAY,
          `entity "${handle}" already has a known head — cannot re-submit with previous_head_cid=null`,
          { current_head: priorKnownHead },
        );
      }
    }

    // -------------------------------------------------------------------
    // §6.3 + §8.2 — Staleness check (and fork detection → §7)
    //
    // Two stale patterns:
    //   (a) previous_head_cid ≠ priorKnownHead AND previous_head_cid is an ancestor
    //       of priorKnownHead — submission is building on an old fork point
    //   (b) previous_head_cid === priorKnownHead (normal extension) BUT new_head_cid
    //       is an ancestor of priorKnownHead — submission is re-announcing an old tip
    //       (§8.2 replay protection: new_head_cid is ancestor of known head)
    // -------------------------------------------------------------------
    let isFork = false;
    if (!isFirstSubmission) {
      // §8.2 — Check if new_head_cid is an ancestor of the currently-known head (replay).
      // Walk the known chain to see if new_head_cid appears as a prior entry.
      let newCidIsAncestor = false;
      if (submission.new_head_cid !== priorKnownHead) {
        let currentCID = priorKnownHead;
        for (let depth = 0; depth < 200; depth++) {
          const raw = await fetchEntry(currentCID, handle, vestaEntitiesDir, ipfsFetch);
          if (!raw) break;
          const normalized = normalizeEntry(raw, currentCID);
          if (!normalized) break;
          const prevCID = normalized.entry.previous;
          if (prevCID === submission.new_head_cid || currentCID === submission.new_head_cid) {
            newCidIsAncestor = true;
            break;
          }
          if (!prevCID) break;
          currentCID = prevCID;
          if (currentCID === submission.new_head_cid) {
            newCidIsAncestor = true;
            break;
          }
        }
      }

      if (newCidIsAncestor) {
        return errResponse(
          ERR.STALE_HEAD,
          `new_head_cid ${submission.new_head_cid} is an ancestor of the current known head ${priorKnownHead} — replay rejected`,
          { current_head: priorKnownHead },
        );
      }

      if (submission.previous_head_cid !== priorKnownHead) {
        // previous_head_cid doesn't match known — check if it's an ancestor (stale fork point) or a true fork
        let ancestor = false;
        let currentCID = priorKnownHead;
        for (let depth = 0; depth < 200; depth++) {
          if (currentCID === submission.previous_head_cid) {
            ancestor = true;
            break;
          }
          const raw = await fetchEntry(currentCID, handle, vestaEntitiesDir, ipfsFetch);
          if (!raw) break;
          const normalized = normalizeEntry(raw, currentCID);
          if (!normalized) break;
          const prevCID = normalized.entry.previous;
          if (prevCID === null || prevCID === undefined) break;
          currentCID = prevCID;
        }

        if (ancestor) {
          // Submission's previous_head_cid is an ancestor of the known head — stale
          return errResponse(
            ERR.STALE_HEAD,
            `submission tip is an ancestor of the current known head ${priorKnownHead}`,
            { current_head: priorKnownHead },
          );
        }
        // Not an ancestor → fork candidate
        isFork = true;
      }
    }

    // -------------------------------------------------------------------
    // §6.5 — Chain walk (IPFS fetch or local cache)
    // Fetch entries from new_head_cid back to priorKnownHead (or genesis).
    // -------------------------------------------------------------------
    let entries;
    try {
      entries = await walkChainToAnchor({
        newHeadCID: submission.new_head_cid,
        anchorCID: priorKnownHead,
        handle,
        entitiesDir: vestaEntitiesDir,
        ipfsFetch,
      });
    } catch (err) {
      if (err && err.ipfsMiss) {
        return errResponse(
          ERR.CHAIN_INVALID,
          `chain validation deferred — IPFS unavailable or missing entry for CID ${err.cid}; retry when IPFS is reachable`,
        );
      }
      return errResponse(ERR.CHAIN_INVALID, `chain walk failed: ${err.message || err}`);
    }

    if (!entries || entries.length === 0) {
      return errResponse(
        ERR.CHAIN_INVALID,
        `no entries returned for chain walk from ${submission.new_head_cid} — IPFS unavailable or entry missing`,
      );
    }

    // -------------------------------------------------------------------
    // §6.4 + §6.5 + §6.6 — Delegate to verifyHeadSubmission from identity-submission.js
    // That module handles: timestamp, protocol, chain walk, signature, authorization.
    // We pass the fetched entries; IPFS fetch is already done above.
    // -------------------------------------------------------------------
    const verifyResult = await verifyHeadSubmission(submission, {
      priorKnownHead,
      entries,
    });

    if (!verifyResult.valid) {
      // Map reason to SPEC-150 error codes
      const reasonMap = {
        'wrong-protocol':      ERR.UNKNOWN_PROTOCOL,
        'expired-timestamp':   ERR.INVALID_SIGNATURE,
        'future-timestamp':    ERR.FUTURE_TIMESTAMP,
        'genesis-replay':      ERR.GENESIS_REPLAY,
        'previous-mismatch':   ERR.STALE_HEAD,
        'chain-invalid':       ERR.CHAIN_INVALID,
        'fp-not-authorized':   ERR.UNAUTHORIZED_SIGNER,
        'invalid-signature':   ERR.INVALID_SIGNATURE,
        'invalid-input':       ERR.CHAIN_INVALID,
      };
      const errDef = reasonMap[verifyResult.reason] || ERR.INTERNAL;
      const extra = verifyResult.currentHead ? { current_head: verifyResult.currentHead } : {};
      return errResponse(errDef, verifyResult.error || 'verification failed', extra);
    }

    // alreadyCurrent is handled above before chain walk, so this shouldn't fire here,
    // but guard defensively.
    if (verifyResult.alreadyCurrent) {
      return okResponse({ handle, accepted_cid: submission.new_head_cid, already_current: true });
    }

    // -------------------------------------------------------------------
    // §7 — Fork resolution (if isFork, compare walk depths)
    // -------------------------------------------------------------------
    if (isFork) {
      const [newDepth, knownDepth] = await Promise.all([
        walkDepth(submission.new_head_cid, handle, vestaEntitiesDir, ipfsFetch),
        walkDepth(priorKnownHead, handle, vestaEntitiesDir, ipfsFetch),
      ]);

      if (newDepth < 0 || knownDepth < 0) {
        return errResponse(
          ERR.CHAIN_INVALID,
          `fork resolution requires chain walk but IPFS is unavailable for one or both candidates`,
          { current_head: priorKnownHead },
        );
      }

      if (newDepth < knownDepth) {
        // Known chain is deeper → new submission loses → treat as stale
        return errResponse(
          ERR.STALE_HEAD,
          `fork resolution: incoming chain depth ${newDepth} < known chain depth ${knownDepth} — incoming rejected`,
          { current_head: priorKnownHead },
        );
      }

      if (newDepth === knownDepth) {
        // Tiebreaker 1: master-signed wins
        const isMasterSigned = verifyResult.masterFingerprint === submission.submitted_by_fingerprint;
        if (!isMasterSigned) {
          // Need to know if known head is master-signed — for now escalate to operator
          return errResponse(
            ERR.UNRESOLVABLE_FORK,
            `fork resolution: equal depth (${newDepth}) — operator intervention required`,
            { current_head: priorKnownHead },
          );
        }
        // Master-signed, equal depth — accept the incoming (master takes precedence)
      }
      // newDepth > knownDepth → incoming chain is deeper → accept it (fall through to §11)
      console.log(`[identity-receiver] fork resolved for ${handle}: depth ${newDepth} > ${knownDepth} — accepting new chain`);
    }

    // -------------------------------------------------------------------
    // §11 — Storage effects
    // -------------------------------------------------------------------
    writeStorageEffects({
      entitiesDir: vestaEntitiesDir,
      handle,
      newHeadCID: submission.new_head_cid,
      submittedAt: submission.submitted_at,
      masterFingerprint: verifyResult.masterFingerprint,
      masterPublicKey: verifyResult.masterPublicKey,
      isFirstSubmission,
      chainResult: verifyResult,
    });

    // Cache the new head entry itself
    if (entries.length > 0) {
      const headEntry = entries[entries.length - 1];
      writeEntryCache(vestaEntitiesDir, handle, submission.new_head_cid, headEntry);
    }

    // §11 git commit (optional — skipped by default in automated paths)
    if (!skipGitCommit) {
      // Caller responsible for git integration — flagged for future wiring
      console.log(`[identity-receiver] git commit deferred — skipGitCommit=false but git integration not yet wired`);
    }

    console.log(`[identity-receiver] accepted: ${handle} → ${submission.new_head_cid.slice(0, 16)}... (${isFirstSubmission ? 'first-submission' : 'update'})`);

    // -------------------------------------------------------------------
    // §5.1 success response
    // -------------------------------------------------------------------
    return okResponse({
      handle,
      accepted_cid: submission.new_head_cid,
      previous_head_cid: priorKnownHead,
    });

  } catch (err) {
    console.error('[identity-receiver] internal error:', err.message || err, err.stack || '');
    return errResponse(ERR.INTERNAL, `internal error: ${err.message || 'unknown'}`);
  }
}

// ---------------------------------------------------------------------------
// §5.3 — Bulk-fetch endpoint: GET /api/identity/heads
// ---------------------------------------------------------------------------

/**
 * Query stored identity heads, optionally filtered by `since` timestamp.
 * Returns paginated list per §5.3.
 *
 * @param {object} params — query params parsed from URL
 * @param {string|undefined} params.since — ISO 8601 timestamp
 * @param {string|number|undefined} params.limit — page size (default 1000, max 10000)
 * @param {string|undefined} params.after — opaque pagination cursor (index-based)
 * @param {object} opts
 * @param {string} [opts.vestaEntitiesDir]
 * @returns {Promise<{ httpStatus: number, body: object }>}
 */
export async function queryIdentityHeads(params = {}, {
  vestaEntitiesDir = DEFAULT_VESTA_ENTITIES_DIR,
} = {}) {
  try {
    const sinceParam = params.since || null;
    const sinceMs = sinceParam ? new Date(sinceParam).getTime() : null;

    let limit = parseInt(params.limit, 10) || DEFAULT_BULK_PAGE_SIZE;
    if (isNaN(limit) || limit < 1) limit = DEFAULT_BULK_PAGE_SIZE;
    if (limit > MAX_BULK_PAGE_SIZE) limit = MAX_BULK_PAGE_SIZE;

    const afterCursor = params.after ? parseInt(params.after, 10) : 0;

    // Scan ~/.vesta/entities/<handle>/sigchain/metadata.json for all known handles
    let allUpdates = [];

    if (fs.existsSync(vestaEntitiesDir)) {
      let handles;
      try {
        handles = fs.readdirSync(vestaEntitiesDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      } catch {
        handles = [];
      }

      for (const handle of handles) {
        const meta = readMetadata(vestaEntitiesDir, handle);
        if (!meta || !meta.sigchainHeadCID) continue;

        const updatedAt = meta.sigchainHeadUpdated || meta.created || null;
        const updatedMs = updatedAt ? new Date(updatedAt).getTime() : 0;

        if (sinceMs !== null && updatedMs <= sinceMs) continue;

        allUpdates.push({
          handle,
          sigchain_head: meta.sigchainHeadCID,
          updated_at: updatedAt,
          _sortKey: updatedMs,
        });
      }
    }

    // Sort by updated_at ascending (oldest first — lighthous sync friendly)
    allUpdates.sort((a, b) => a._sortKey - b._sortKey);

    // Pagination: cursor is an index offset into the sorted array
    const offset = (isNaN(afterCursor) || afterCursor < 0) ? 0 : afterCursor;
    const page = allUpdates.slice(offset, offset + limit);
    const hasMore = (offset + limit) < allUpdates.length;

    const updates = page.map(({ handle, sigchain_head, updated_at }) => ({
      handle,
      sigchain_head,
      updated_at,
    }));

    const responseBody = {
      ok: true,
      since: sinceParam || null,
      count: updates.length,
      updates,
    };

    if (hasMore) {
      responseBody.has_more = true;
      responseBody.next_cursor = String(offset + limit);
    }

    return { httpStatus: 200, body: responseBody };

  } catch (err) {
    console.error('[identity-receiver] queryIdentityHeads error:', err.message || err);
    return errResponse(ERR.INTERNAL, `internal error: ${err.message || 'unknown'}`);
  }
}
